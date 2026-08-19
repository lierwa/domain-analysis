import { copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  categoryInterviewRuntimeOutputSchema,
  type CategoryInterviewRuntimeOutput,
  type InterviewTurnActivity,
} from "@domain-analysis/shared";
import { zodToJsonSchema } from "zod-to-json-schema";

import type {
  CategoryInterviewRuntime,
  CategoryInterviewRuntimeEvent,
  CategoryInterviewRuntimeInput,
} from "./categoryInterviewModule";
import {
  CodexAppServerError,
  streamCodexAppServer,
  type CodexAppServerResult,
  type CodexAppServerStreamItem,
} from "./codexAppServerClient";

export interface CodexCategoryInterviewRuntimeOptions {
  repositoryRoot: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  executable?: string;
}

export function createCodexCategoryInterviewRuntime(
  options: CodexCategoryInterviewRuntimeOptions,
): CategoryInterviewRuntime {
  return { run: (input) => runInterviewTurn(options, input) };
}

async function* runInterviewTurn(
  options: CodexCategoryInterviewRuntimeOptions,
  input: CategoryInterviewRuntimeInput,
): AsyncIterable<CategoryInterviewRuntimeEvent> {
  const runtimeCwd = path.join(tmpdir(), "domain-analysis-category-interview");
  const runtimeSkillPath = path.join(runtimeCwd, ".agents", "skills", "interview-product-category", "SKILL.md");
  await mkdir(path.dirname(runtimeSkillPath), { recursive: true });
  await copyFile(
    path.join(options.repositoryRoot, ".agents", "skills", "interview-product-category", "SKILL.md"),
    runtimeSkillPath,
  );
  let result: CodexAppServerResult | undefined;
  let eventSequence = 0;
  let finalizingStarted = false;
  for await (const item of streamCodexAppServer({
    // WHY：产品采访不应继承仓库工程 AGENTS.md；空白工作目录配合显式 Skill，只暴露采访规则、typed state 与网页搜索。
    cwd: runtimeCwd,
    packageRoot: options.repositoryRoot,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    executable: options.executable,
    webSearch: true,
    skill: {
      name: "interview-product-category",
      path: runtimeSkillPath,
    },
  }, interviewPrompt(input), input.signal)) {
    if (item.type === "text_delta") {
      yield { type: "text_delta", delta: item.delta };
      continue;
    }
    if (item.type === "event") {
      eventSequence += 1;
      const activity = activityForEvent(item, input, eventSequence);
      if (activity?.id === "turn-finalizing") {
        if (finalizingStarted && activity.status === "running") continue;
        finalizingStarted = true;
      }
      if (activity) yield { type: "activity", activity };
      continue;
    }
    result = item.result;
  }
  if (!result) throw new Error("Codex 执行流未返回结果");
  if (result.interrupted) {
    yield { type: "interrupted" };
    return;
  }
  const output = makeQuestionVisible(parseOutput(result.outputText ?? "", result.observedEvents));
  requireInvestigatedTask(output, result.observedItemTypes, input);
  if (!finalizingStarted) {
    yield { type: "activity", activity: finalizingActivity("running") };
  }
  yield { type: "activity", activity: finalizingActivity("completed") };
  yield { type: "completed", output };
}

function codexOutputSchema() {
  return zodToJsonSchema(categoryInterviewRuntimeOutputSchema, {
    target: "openAi",
    $refStrategy: "none",
    postProcess: (jsonSchema) => {
      if (!jsonSchema || !("format" in jsonSchema)) return jsonSchema;
      // WHY：Codex strict schema 不接受 uri 等 format；这里只收窄模型输入提示，最终结果仍由原始 Zod URL/日期规则完整校验。
      const { format: _unsupportedFormat, ...supportedSchema } = jsonSchema;
      return supportedSchema;
    },
  });
}

type CodexEvent = Extract<CodexAppServerStreamItem, { type: "event" }>;

function activityForEvent(
  event: CodexEvent,
  input: CategoryInterviewRuntimeInput,
  eventSequence: number,
): InterviewTurnActivity | undefined {
  if (event.eventType === "thread.started") {
    return { id: "turn-lifecycle", kind: "agent", label: "启动抓取规划 Agent", status: "running" };
  }
  if (event.eventType === "turn.started") {
    return {
      id: "turn-lifecycle",
      kind: "analysis",
      label: input.trigger.type === "decision_confirmed"
        ? "根据已确认选择更新抓取范围"
        : "分析需求与当前抓取范围",
      status: "running",
    };
  }
  if (event.eventType === "turn.completed") return finalizingActivity("running");
  if (!event.eventType.startsWith("item.") || !event.itemType) return undefined;
  if (event.itemType === "agent_message" && event.phase === "final_answer"
    && event.eventType === "item.started") {
    return finalizingActivity("running");
  }
  const id = event.itemId || `${event.itemType}-${eventSequence}`;
  const common = {
    id,
    ...(event.detail ? { detail: event.detail } : {}),
    ...(event.urls?.length ? { urls: event.urls } : {}),
    status: event.itemStatus ?? "running",
  } as const;
  if (event.itemType === "web_search") {
    return { ...common, kind: "web_search", label: "搜索网页" };
  }
  // WHY：本地命令是 Codex 运行时内部行为，不是抓取任务的业务活动；产品时间线只保留来源访问和显式工具调用。
  if (event.itemType === "command_execution") return undefined;
  if (event.itemType === "mcp_tool_call") {
    return { ...common, kind: "tool", label: "调用工具" };
  }
  // WHY：reasoning/agent_message 只是同一轮内部阶段，不能在真实搜索后把界面倒退成“正在分析”。
  return undefined;
}

function finalizingActivity(status: InterviewTurnActivity["status"]): InterviewTurnActivity {
  return { id: "turn-finalizing", kind: "finalizing", label: "整理并校验本轮结果", status };
}

function makeQuestionVisible(output: CategoryInterviewRuntimeOutput): CategoryInterviewRuntimeOutput {
  const normalizedOutput = {
    ...output,
    assistantText: output.assistantText.replaceAll("（推荐）（推荐）", "（推荐）"),
  };
  const question = normalizedOutput.question ?? (normalizedOutput.proposedDecision ? {
    text: normalizedOutput.proposedDecision.question,
    options: normalizedOutput.proposedDecision.options,
  } : undefined);
  if (!question) return normalizedOutput;
  const additions: string[] = [];
  if (!normalizedOutput.assistantText.includes(question.text)) additions.push(question.text);
  for (const [index, option] of question.options.entries()) {
    if (normalizedOutput.assistantText.includes(option.label)) continue;
    const recommendation = option.recommended && !option.label.includes("推荐") ? "（推荐）" : "";
    additions.push(`${index + 1}. ${option.label}${recommendation}：${option.description}`);
  }
  const answerHint = "直接回答，也可以输入不同于以上建议的方案。";
  if (!normalizedOutput.assistantText.includes(answerHint)) additions.push(answerHint);
  if (additions.length === 0) return normalizedOutput;
  return {
    ...normalizedOutput,
    // WHY：问题仍以 typed Decision 保存，但用户表面只呈现普通对话；Composer 可提交建议之外的真实负责人答案。
    assistantText: `${normalizedOutput.assistantText}\n\n${additions.join("\n")}`,
  };
}

function requireInvestigatedTask(
  output: CategoryInterviewRuntimeOutput,
  observedItemTypes: string[],
  input: CategoryInterviewRuntimeInput,
) {
  const initialResearchTurn = input.trigger.type === "user_message"
    && input.session.decisions.length === 0
    && input.session.taskDrafts.length === 0
    && input.session.messages.filter((message) => message.role === "user").length === 1;
  if (!initialResearchTurn && !output.taskCandidate) return;
  if (!observedItemTypes.includes("web_search")) {
    // WHY：URL 字符串本身不能证明 Agent 做过调查；App Server 的 webSearch item 是当前运行 seam 可审计的最小真实行为证据。
    throw new Error("抓取任务草稿缺少本轮主动来源调查证据（未观察到 web_search item）");
  }
}

function interviewPrompt(input: CategoryInterviewRuntimeInput) {
  const initialResearchInstruction = input.trigger.type === "user_message"
    && input.session.decisions.length === 0
    && input.session.taskDrafts.length === 0
    && input.session.messages.filter((message) => message.role === "user").length === 1
    ? "这是新品类首轮或其重试：必须先调用 web search 主动调查品类范围与真实候选来源，再提出负责人问题或生成草稿；不得先询问 Skill 已定义默认值的市场或品类。"
    : "按已持久化的决定、未决项和草稿继续推进，不要重复已解决的问题。";
  return [
    "$interview-product-category 请严格执行该 Skill。Skill 已由 Workbench 通过本轮 skill input 注入；不要通过本地命令查找或读取 Skill、AGENTS.md、开发文档或 Git 状态，也不要声称 Skill 缺失。首条用户消息已经是抓取需求，不要再次确认品类。",
    "下面的 Workbench typed state 是唯一业务事实；本轮是无持久 Session 的独立执行。",
    initialResearchInstruction,
    "执行期间必须通过 commentary agent message 用正常中文持续汇报真实进展；commentary 会直接流式展示给用户，绝对不能输出 JSON。",
    "只有 final_answer 是机器协议：最终只返回一份符合下方 JSON Schema 的 JSON 对象，不要使用 Markdown 代码块或添加解释。",
    "需要负责人决定时，把背景写入 assistantText，把问题和 2–3 个建议写入 question/proposedDecision；界面会将它们合成为普通对话，用户可以直接输入建议之外的答案。",
    "首轮若品类适用于京东，唯一允许的负责人问题是京东抓取意向与范围；不得把默认采集内容改写成采集深度问题。只要仍有 question、proposedDecision 或 user unresolved item，就必须省略 taskCandidate。",
    `Final answer JSON Schema: ${JSON.stringify(codexOutputSchema())}`,
    `Workbench state: ${JSON.stringify(input.session)}`,
    "Current turn trigger 是 typed action：user_message 表示用户需求或负责人回答；decision_confirmed 表示界面刚完成显式确认，直接推进，不得要求再输入‘继续’。",
    `Current turn trigger: ${JSON.stringify(input.trigger)}`,
  ].join("\n\n");
}

function parseOutput(text: string, observedEvents: string[]): CategoryInterviewRuntimeOutput {
  try {
    return categoryInterviewRuntimeOutputSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new CodexAppServerError(
      "invalid_output",
      "Codex 返回的抓取规划结果不符合协议，请重试。",
      `textLength=${text.length} events=${observedEvents.join(",")} error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
