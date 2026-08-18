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
  let result: CodexAppServerResult | undefined;
  let eventSequence = 0;
  let finalizingStarted = false;
  for await (const item of streamCodexAppServer({
    cwd: options.repositoryRoot,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    executable: options.executable,
    webSearch: true,
  }, interviewPrompt(input), input.signal)) {
    if (item.type === "text_delta") {
      yield { type: "text_delta", delta: item.delta };
      continue;
    }
    if (item.type === "event") {
      eventSequence += 1;
      const activity = activityForEvent(item, input, eventSequence);
      if (activity?.id === "turn-finalizing") finalizingStarted = true;
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
  requireInvestigatedTask(output, result.observedItemTypes);
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
    return { id: "agent-starting", kind: "agent", label: "启动抓取规划 Agent", status: "running" };
  }
  if (event.eventType === "turn.started") {
    return {
      id: "turn-analysis",
      kind: "analysis",
      label: input.trigger.type === "decision_confirmed"
        ? "根据已确认选择更新抓取范围"
        : "分析需求与当前抓取范围",
      status: "running",
    };
  }
  if (event.eventType === "turn.completed") return finalizingActivity("running");
  if (!event.eventType.startsWith("item.") || !event.itemType) return undefined;
  const id = event.itemId || `${event.itemType}-${eventSequence}`;
  const common = {
    id,
    detail: event.detail,
    status: event.itemStatus ?? "running",
  } as const;
  if (event.itemType === "web_search") {
    return { ...common, kind: "web_search", label: "搜索网页" };
  }
  if (event.itemType === "command_execution") {
    return { ...common, kind: "tool", label: "执行本地只读命令" };
  }
  if (event.itemType === "mcp_tool_call") {
    return { ...common, kind: "tool", label: "调用工具" };
  }
  // WHY：reasoning/agent_message 只是同一轮内部阶段，不能在真实搜索后把界面倒退成“正在分析”。
  return undefined;
}

function finalizingActivity(status: InterviewTurnActivity["status"]): InterviewTurnActivity {
  return { id: "turn-finalizing", kind: "finalizing", label: "校验并生成本轮结果", status };
}

function makeQuestionVisible(output: CategoryInterviewRuntimeOutput): CategoryInterviewRuntimeOutput {
  if (!output.question || output.assistantText.includes(output.question.text)) return output;
  return {
    ...output,
    // WHY：选项由结构化按钮承担，消息只补问题本身，避免同一组选项在文字和确认卡里重复出现。
    assistantText: `${output.assistantText}\n\n${output.question.text}`,
  };
}

function requireInvestigatedTask(
  output: CategoryInterviewRuntimeOutput,
  observedItemTypes: string[],
) {
  if (!output.taskCandidate) return;
  if (!observedItemTypes.includes("web_search")) {
    // WHY：URL 字符串本身不能证明 Agent 做过调查；App Server 的 webSearch item 是当前运行 seam 可审计的最小真实行为证据。
    throw new Error("抓取任务草稿缺少本轮主动来源调查证据（未观察到 web_search item）");
  }
}

function interviewPrompt(input: CategoryInterviewRuntimeInput) {
  return [
    "$interview-product-category 请严格执行该 Skill，首条用户消息已经是抓取需求，不要再次确认品类。",
    "下面的 Workbench typed state 是唯一业务事实；本轮是无持久 Session 的独立执行。",
    "执行期间必须通过 commentary agent message 用正常中文持续汇报真实进展；commentary 会直接流式展示给用户，绝对不能输出 JSON。",
    "只有 final_answer 是机器协议：最终只返回一份符合下方 JSON Schema 的 JSON 对象，不要使用 Markdown 代码块或添加解释。",
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
