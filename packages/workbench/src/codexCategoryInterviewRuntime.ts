import {
  categoryInterviewRuntimeOutputSchema,
  type CategoryInterviewRuntimeOutput,
} from "@domain-analysis/shared";
import { zodToJsonSchema } from "zod-to-json-schema";

import type {
  CategoryInterviewRuntime,
  CategoryInterviewRuntimeEvent,
  CategoryInterviewRuntimeInput,
} from "./categoryInterviewModule";
import { runCodexExec } from "./codexExecClient";

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
  const result = await runCodexExec({
    cwd: options.repositoryRoot,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    executable: options.executable,
    webSearch: true,
    outputSchema: zodToJsonSchema(categoryInterviewRuntimeOutputSchema, {
      target: "openAi",
      $refStrategy: "none",
    }),
  }, interviewPrompt(input), input.signal);
  if (result.interrupted) {
    yield { type: "interrupted" };
    return;
  }
  const output = makeQuestionVisible(parseOutput(result.outputText ?? "", result.observedEvents));
  requireInvestigatedBrief(output, result.observedItemTypes);
  yield { type: "text_delta", delta: output.assistantText };
  yield { type: "completed", output };
}

function requireInvestigatedBrief(
  output: CategoryInterviewRuntimeOutput,
  observedItemTypes: string[],
) {
  if (!output.briefCandidate) return;
  if (!observedItemTypes.includes("web_search")) {
    // WHY：URL 字符串本身不能证明 Agent 做过调查；官方 JSONL 的 web_search item 是当前 exec seam 可审计的最小真实行为证据。
    throw new Error("采访任务书缺少本轮主动事实调查证据（未观察到 web_search item）");
  }
}

function makeQuestionVisible(output: CategoryInterviewRuntimeOutput): CategoryInterviewRuntimeOutput {
  if (!output.question || output.assistantText.includes(output.question.text)) return output;
  // WHY：question 是 adapter 的 typed 输出，但 Workbench 时间线只持久化 assistantText；在 seam 处投影可避免 UI 猜测状态或丢失用户真正要回答的问句。
  return { ...output, assistantText: `${output.assistantText}\n\n${output.question.text}` };
}

function interviewPrompt(input: CategoryInterviewRuntimeInput) {
  return [
    "$interview-product-category 请严格执行该 Skill。",
    "下面的 Workbench typed state 是唯一业务事实；本轮是无持久 Session 的独立执行。",
    "只返回 output schema 要求的 JSON，不要使用 Markdown 代码块。",
    `Workbench state: ${JSON.stringify(input.session)}`,
    "Current turn trigger 是 typed action：user_message 表示负责人回答；decision_confirmed 表示界面刚完成显式确认，直接按已确认 state 推进下一分支，不得要求负责人再输入“继续”。",
    `Current turn trigger: ${JSON.stringify(input.trigger)}`,
  ].join("\n\n");
}

function parseOutput(text: string, observedEvents: string[]): CategoryInterviewRuntimeOutput {
  try {
    return categoryInterviewRuntimeOutputSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new Error(
      `采访结构化输出无效（text=${text.length}, events=${observedEvents.join(",")}）：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
