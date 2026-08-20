import {
  applyDefaultJdSourcePolicy,
  captureTaskContentSchema,
  interviewDecisionSchema,
  type CaptureTaskMaterialization,
  type CategoryInterviewRuntimeOutput,
  type CategoryInterviewView,
  type InterviewDecision,
  type InterviewMessageTimelinePart,
} from "@domain-analysis/shared";

import { CategoryInterviewError } from "./categoryInterviewRecords";
import {
  applyProfessionalShoppingGuideDefaults,
  findCaptureTaskReadinessGaps,
} from "./captureTaskReadiness";

export interface InterviewDecisionChange {
  proposed: InterviewDecision;
  confirmed?: InterviewDecision;
  withdrawalRationale?: string;
}

const draftCoverageGroups = [
  { key: "retailMarketUrls", label: "核心零售/市场平台" },
  { key: "brandOfficialUrls", label: "品牌官方资料" },
  { key: "standardsRegulationUrls", label: "国家标准/监管" },
  { key: "technicalPrincipleUrls", label: "技术原理" },
] as const;

export function prepareInterviewTurn(
  view: CategoryInterviewView,
  rawOutput: CategoryInterviewRuntimeOutput,
  timestamp: string,
  createId: (kind: string) => string,
  sourceUserMessageId: string,
  currentTimelineParts: InterviewMessageTimelinePart[],
): {
  output: CategoryInterviewRuntimeOutput;
  decisionChange: InterviewDecisionChange | undefined;
  nextPhase: "active" | "task_ready" | "confirmed";
} {
  const decisionChange = buildDecisionChange(
    view, sourceUserMessageId, rawOutput, timestamp, createId,
  );
  requireResolvedItemsValid(view, rawOutput, decisionChange);
  requireSingleOwnerQuestion(view, rawOutput.proposedDecision, decisionChange);
  requireDraftReady(view, rawOutput, decisionChange, currentTimelineParts);
  const nextPhase = rawOutput.draftMarkdown ? "task_ready" as const : "active" as const;
  return { output: rawOutput, decisionChange, nextPhase };
}

function buildDecisionChange(
  view: CategoryInterviewView,
  sourceUserMessageId: string,
  output: CategoryInterviewRuntimeOutput,
  timestamp: string,
  createId: (kind: string) => string,
): InterviewDecisionChange | undefined {
  const change = output.decisionResolution ?? output.decisionWithdrawal;
  if (!change) return undefined;
  const proposed = view.decisions.find((item) => item.id === change.decisionId && item.status === "proposed");
  if (!proposed) throw invalidState("本轮解释引用的待回答问题不存在或已处理");
  const userMessage = view.messages.find((item) => item.id === sourceUserMessageId);
  if (!userMessage || userMessage.role !== "user") throw invalidState("本轮解释找不到对应的用户原始消息");
  if (output.decisionWithdrawal) {
    return { proposed, withdrawalRationale: output.decisionWithdrawal.rationale };
  }
  if (!output.decisionResolution) throw invalidState("本轮负责人问题处理结果无效");
  const selected = resolveSelectedOption(proposed.options, output.decisionResolution.selection);
  const confirmed = interviewDecisionSchema.parse({
    ...proposed,
    id: createId("interview-decision"),
    selection: selected?.label ?? output.decisionResolution.selection,
    rationale: output.decisionResolution.rationale,
    status: "confirmed",
    sourceMessageId: userMessage.id,
    supersedesDecisionId: proposed.id,
    createdAt: timestamp,
    confirmedAt: timestamp,
  });
  return { proposed, confirmed };
}

export function materializeCaptureTaskContent(
  view: CategoryInterviewView,
  materialization: CaptureTaskMaterialization,
  timestamp: string,
) {
  const content = applyProfessionalShoppingGuideDefaults(applyDefaultJdSourcePolicy(captureTaskContentSchema.parse({
    ...materialization,
    unresolvedItems: view.unresolvedItems.filter((item) => item.status === "open").map((item) => ({
      key: item.key,
      description: item.description,
      owner: item.owner,
    })),
    decisionIds: view.decisions.filter((item) => item.status === "confirmed").map((item) => item.id),
    sourceCandidates: materialization.sourceCandidates.map((candidate) => ({
      ...candidate,
      // WHY：只有确认后的正式结构化阶段才创建候选来源，观察时间仍只能由 Workbench 盖章。
      observedAt: timestamp,
    })),
  })));
  const gaps = findCaptureTaskReadinessGaps(content);
  if (gaps.length > 0) {
    throw invalidState(`抓取范围尚不足以服务专业导购 Agent，请继续调查并补齐：${gaps.join("、")}`);
  }
  return content;
}

function requireResolvedItemsValid(
  view: CategoryInterviewView,
  output: CategoryInterviewRuntimeOutput,
  decisionChange: InterviewDecisionChange | undefined,
) {
  const resolvedKeys = new Set([
    ...output.resolvedUnresolvedKeys,
    ...(decisionChange ? [decisionChange.proposed.key] : []),
  ]);
  for (const item of output.unresolvedItems) {
    if (resolvedKeys.has(item.key)) {
      throw invalidState(`同一未决项不能在一轮内同时打开和解决：${item.key}`);
    }
    const existing = view.unresolvedItems.find((candidate) => candidate.key === item.key);
    if (existing?.owner === "system" && item.owner === "user") {
      throw invalidState(`系统负责调查的未决事实不能转交负责人：${item.key}`);
    }
  }
  for (const key of output.resolvedUnresolvedKeys) {
    const item = view.unresolvedItems.find((candidate) => candidate.key === key && candidate.status === "open");
    if (!item) throw invalidState(`本轮试图解决不存在或已关闭的未决项：${key}`);
    if (item.owner === "user" && item.key !== decisionChange?.proposed.key) {
      throw invalidState(`负责人未决项必须通过 Decision 确认或撤回：${key}`);
    }
  }
}

function requireSingleOwnerQuestion(
  view: CategoryInterviewView,
  proposedDecision: CategoryInterviewRuntimeOutput["proposedDecision"],
  decisionChange: InterviewDecisionChange | undefined,
) {
  if (!proposedDecision) return;
  if (view.unresolvedItems.some((item) => item.key === proposedDecision.key && item.owner === "system")) {
    throw invalidState(`系统负责调查的未决事实不能改成负责人问题：${proposedDecision.key}`);
  }
  const stillOpen = view.decisions.some((item) => item.status === "proposed"
    && item.id !== decisionChange?.proposed.id);
  if (stillOpen) throw invalidState("当前负责人问题尚未解决，不能同时提出下一问题");
}

function requireDraftReady(
  view: CategoryInterviewView,
  output: CategoryInterviewRuntimeOutput,
  decisionChange: InterviewDecisionChange | undefined,
  currentTimelineParts: InterviewMessageTimelinePart[],
) {
  if (!output.draftMarkdown) return;
  const resolvedKeys = new Set([
    ...output.resolvedUnresolvedKeys,
    ...(decisionChange ? [decisionChange.proposed.key] : []),
  ]);
  const hasOpenOwnerDecision = Boolean(output.proposedDecision)
    || view.decisions.some((item) => item.status === "proposed" && item.id !== decisionChange?.proposed.id)
    || view.unresolvedItems.some((item) => item.owner === "user" && item.status === "open"
      && !resolvedKeys.has(item.key))
    || output.unresolvedItems.some((item) => item.owner === "user");
  if (hasOpenOwnerDecision) throw invalidState("负责人取舍尚未确认，不能生成抓取范围草案");
  const hasOpenSystemInvestigation = view.unresolvedItems.some((item) => item.owner === "system"
    && item.status === "open" && !resolvedKeys.has(item.key))
    || output.unresolvedItems.some((item) => item.owner === "system");
  if (hasOpenSystemInvestigation) throw invalidState("系统负责的来源与内容调查尚未完成，不能生成抓取范围草案");
  requireDraftCoverage(view, output, currentTimelineParts);
}

function requireDraftCoverage(
  view: CategoryInterviewView,
  output: CategoryInterviewRuntimeOutput,
  currentTimelineParts: InterviewMessageTimelinePart[],
) {
  if (!output.draftMarkdown) return;
  const coverage = output.draftCoverage;
  if (!coverage) {
    throw invalidState("草案来源覆盖尚未完成：缺少核心零售/市场平台、至少两个品牌官方站点、国家标准/监管或技术原理入口");
  }
  const entries = draftCoverageGroups.flatMap((group) => coverage[group.key]
    .map((url) => ({ role: group.label, url, canonicalUrl: canonicalizeUrl(url) })));
  if (new Set(entries.map((entry) => entry.canonicalUrl)).size !== entries.length) {
    throw invalidState("草案来源覆盖尚未完成：同一入口不能重复或同时充当多个来源角色");
  }
  const brandOrigins = new Set(coverage.brandOfficialUrls.map((url) => new URL(url).origin));
  if (brandOrigins.size < 2) {
    throw invalidState("草案来源覆盖尚未完成：品牌官方资料至少需要两个独立官方站点，才能支持多品牌对比");
  }
  const searchedUrls = collectCompletedSearchUrls(view, currentTimelineParts);
  const unsearched = entries.filter((entry) => !searchedUrls.has(entry.canonicalUrl));
  if (unsearched.length > 0) {
    throw invalidState(`草案覆盖凭证必须来自本会话已完成的网页搜索：${formatCoverageEntries(unsearched)}`);
  }
  const absentFromDraft = entries.filter((entry) => !output.draftMarkdown?.includes(entry.url));
  if (absentFromDraft.length > 0) {
    throw invalidState(`草案覆盖凭证必须真实写入 Markdown：${formatCoverageEntries(absentFromDraft)}`);
  }
}

function collectCompletedSearchUrls(
  view: CategoryInterviewView,
  currentTimelineParts: InterviewMessageTimelinePart[],
) {
  const priorParts = view.messages.flatMap((message) => message.timelineParts ?? []);
  const urls = [...priorParts, ...currentTimelineParts].flatMap((part) => part.type === "activity"
    && part.activity.kind === "web_search" && part.activity.status === "completed"
    ? part.activity.urls ?? [] : []);
  return new Set(urls.map(canonicalizeUrl));
}

function canonicalizeUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function formatCoverageEntries(entries: Array<{ role: string; url: string }>) {
  return entries.map((entry) => `${entry.role}：${entry.url}`).join("、");
}

function resolveSelectedOption(options: InterviewDecision["options"], answer: string) {
  const ordinal = /^\d+$/.test(answer) ? Number(answer) : Number.NaN;
  if (Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= options.length) return options[ordinal - 1];
  return options.find((option) => option.label === answer);
}

function invalidState(message: string) {
  return new CategoryInterviewError("invalid_state", message);
}
