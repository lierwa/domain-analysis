import {
  applyDefaultJdSourcePolicy,
  captureTaskContentSchema,
  interviewDecisionSchema,
  type CaptureTaskMaterialization,
  type CategoryInterviewRuntimeOutput,
  type CategoryInterviewView,
  type InterviewDecision,
} from "@domain-analysis/shared";

import { CategoryInterviewError } from "./categoryInterviewRecords";

export interface InterviewDecisionChange {
  proposed: InterviewDecision;
  confirmed?: InterviewDecision;
  withdrawalRationale?: string;
}

export function prepareInterviewTurn(
  view: CategoryInterviewView,
  rawOutput: CategoryInterviewRuntimeOutput,
  timestamp: string,
  createId: (kind: string) => string,
  sourceUserMessageId: string,
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
  requireDraftReady(view, rawOutput, decisionChange);
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
  return applyDefaultJdSourcePolicy(captureTaskContentSchema.parse({
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
  }));
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
}

function resolveSelectedOption(options: InterviewDecision["options"], answer: string) {
  const ordinal = /^\d+$/.test(answer) ? Number(answer) : Number.NaN;
  if (Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= options.length) return options[ordinal - 1];
  return options.find((option) => option.label === answer);
}

function invalidState(message: string) {
  return new CategoryInterviewError("invalid_state", message);
}
