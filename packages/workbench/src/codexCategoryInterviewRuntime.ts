import { copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  categoryInterviewRuntimeOutputSchema,
  type CategoryInterviewRuntimeOutput,
} from "@domain-analysis/shared";
import type {
  CategoryInterviewRuntime,
  CategoryInterviewRuntimeEvent,
  CategoryInterviewRuntimeInput,
} from "./categoryInterviewModule";
import {
  createCodexAppServerClient,
  type CodexAppServerClient,
  type CodexAppServerResult,
} from "./codexAppServerClient";
import { finalizingActivity, projectCodexAppServerActivity } from "./codexAppServerActivity";
import { parseCodexStructuredOutput, zodSchemaToCodexJsonSchema } from "./codexStructuredOutput";

export interface CodexCategoryInterviewRuntimeOptions {
  repositoryRoot: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  executable?: string;
}

export function createCodexCategoryInterviewRuntime(
  options: CodexCategoryInterviewRuntimeOptions,
): CategoryInterviewRuntime {
  const runtimeCwd = path.join(tmpdir(), "domain-analysis-category-interview");
  const runtimeSkillPath = path.join(runtimeCwd, ".agents", "skills", "interview-product-category", "SKILL.md");
  const client = createCodexAppServerClient({
    cwd: runtimeCwd,
    packageRoot: options.repositoryRoot,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    executable: options.executable,
    webSearch: true,
    skill: { name: "interview-product-category", path: runtimeSkillPath },
  });
  return {
    run: (input) => runInterviewTurn(options, client, runtimeCwd, runtimeSkillPath, input),
    close: () => client.close(),
  };
}

async function* runInterviewTurn(
  options: CodexCategoryInterviewRuntimeOptions,
  client: CodexAppServerClient,
  runtimeCwd: string,
  runtimeSkillPath: string,
  input: CategoryInterviewRuntimeInput,
): AsyncIterable<CategoryInterviewRuntimeEvent> {
  await mkdir(path.dirname(runtimeSkillPath), { recursive: true });
  await copyFile(
    path.join(options.repositoryRoot, ".agents", "skills", "interview-product-category", "SKILL.md"),
    runtimeSkillPath,
  );
  let result: CodexAppServerResult | undefined;
  let eventSequence = 0;
  let finalizingStarted = false;
  // WHY：同一运行时复用官方 stdio 连接，但每轮仍新建 ephemeral thread；Workbench 继续独占业务会话事实。
  for await (const item of client.run(interviewPrompt(input), input.signal)) {
    if (item.type === "text_delta") {
      yield { type: "text_delta", delta: item.delta };
      continue;
    }
    if (item.type === "event") {
      eventSequence += 1;
      const activity = projectCodexAppServerActivity(item, eventSequence, {
        lifecycle: "启动抓取规划 Agent",
        analysis: "理解用户输入并更新抓取范围",
        finalizing: "整理并校验本轮结果",
      });
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
    yield { type: "activity", activity: finalizingActivity("整理并校验本轮结果", "running") };
  }
  yield { type: "activity", activity: finalizingActivity("整理并校验本轮结果", "completed") };
  yield { type: "completed", output };
}

function codexOutputSchema() {
  return zodSchemaToCodexJsonSchema(categoryInterviewRuntimeOutputSchema);
}

export function makeQuestionVisible(output: CategoryInterviewRuntimeOutput): CategoryInterviewRuntimeOutput {
  const normalizedOutput = {
    ...output,
    assistantText: output.assistantText.replaceAll("（推荐）（推荐）", "（推荐）"),
  };
  const question = normalizedOutput.proposedDecision;
  if (!question) return normalizedOutput;
  const questionStart = normalizedOutput.assistantText.indexOf(question.question);
  const background = questionStart >= 0
    ? normalizedOutput.assistantText.slice(0, questionStart).trimEnd()
    : normalizedOutput.assistantText;
  const questionBlock = [question.question];
  for (const [index, option] of question.options.entries()) {
    const recommendation = option.recommended && !option.label.includes("推荐") ? "（推荐）" : "";
    questionBlock.push(`${index + 1}. ${option.label}${recommendation}：${option.description}`);
  }
  const answerHint = "可以回答、补充、纠正或追问，也可以输入不同于以上建议的方案。";
  questionBlock.push(answerHint);
  return {
    ...normalizedOutput,
    // WHY：问题仍以 typed Decision 保存；由 Workbench 确定性编号，避免模型正文漏项后出现“1、3”且序号无法回答。
    assistantText: `${background}\n\n${questionBlock.join("\n")}`,
  };
}

function requireInvestigatedTask(
  output: CategoryInterviewRuntimeOutput,
  observedItemTypes: string[],
  input: CategoryInterviewRuntimeInput,
) {
  if (!requiresCategoryResearch(input, output)) return;
  if (!observedItemTypes.includes("web_search")) {
    // WHY：URL 字符串本身不能证明 Agent 做过调查；App Server 的 webSearch item 是当前运行 seam 可审计的最小真实行为证据。
    throw new Error("抓取任务草稿缺少本轮主动来源调查证据（未观察到已完成的 web_search item）");
  }
  if (!output.proposedDecision && !output.taskCandidate) {
    throw new Error("新品类首轮调查后既未提出真实负责人问题，也未形成抓取任务草稿");
  }
}

function interviewPrompt(input: CategoryInterviewRuntimeInput) {
  const initialResearchInstruction = requiresInitialCategoryResearch(input)
    ? "这是新品类首轮或其重试：必须先调用 web search 主动调查品类范围与真实候选来源，再提出负责人问题或生成草稿；不得先询问 Skill 已定义默认值的市场或品类。"
    : "先完整理解本轮用户原文，再按已持久化的消息、决定、未决项和草稿继续推进；不要把当前问题当成限制输入的表单，也不要丢掉回答之外的纠正、补充事实或追问。";
  return [
    "$interview-product-category 请严格执行该 Skill。Skill 已由 Workbench 通过本轮 skill input 注入；不要通过本地命令查找或读取 Skill、AGENTS.md、开发文档或 Git 状态，也不要声称 Skill 缺失。首条用户消息已经是抓取需求，不要再次确认品类。",
    "下面的 Workbench typed state 是唯一业务事实；本轮是无持久 Session 的独立执行。",
    initialResearchInstruction,
    "执行期间必须通过 commentary agent message 用正常中文持续汇报真实进展；commentary 会直接流式展示给用户，绝对不能输出 JSON。",
    "只有 final_answer 是机器协议：最终只返回一份符合下方 JSON Schema 的 JSON 对象，不要使用 Markdown 代码块或添加解释。",
    "每轮 final_answer 表达的是你对本轮原始输入的理解和由此产生的增量，不要重报 Workbench 已持有的全部状态。普通解释写入 assistantText；用户提供或纠正的相关事实要在 assistantText 中明确记录。输入改变任务范围时形成新的完整 taskCandidate；纯解释可以只返回 assistantText。",
    "若当前存在 proposed Decision，先判断用户原文如何处理它。只有语义明确回答时才返回 decisionResolution：decisionId 必须引用现有 proposal；序号、‘按推荐’等表达规范化成对应 option label；自定义答案提炼成准确选择；rationale 说明如何理解整条原文。用户若纠正或否定问题前提，且该问题确实不应由负责人决定，则改用 decisionWithdrawal 引用并撤回现有 proposal，rationale 记录原因；两者不能同时返回。用户同时补充的范围、排除项、来源或事实不能丢弃。若语义不明确或只是在追问原因，则两者都省略，先正常回应或只追问一个必要澄清。",
    "decisionResolution 与 decisionWithdrawal 都不是单独回合。处理当前问题后必须在同一个 final_answer 继续推进：仍有下一个真实负责人取舍就提出一个新的 proposedDecision；没有则完成必要调查并形成 taskCandidate。不要只回复‘已记录’后等待用户再说‘继续’。",
    "需要负责人决定时，assistantText 只写背景，不得抄写问题、选项或编号；只用 proposedDecision 表达唯一问题、2–3 个建议、推荐选择与理由。owner=user 未决项必须与这个 proposal 使用同一个 key，resolvedUnresolvedKeys 只能独立解决系统负责的未决事实。界面会把问题确定性编号后合成为普通对话，用户可以直接输入建议之外的答案。",
    "来源平台、网站与渠道是系统调查事实，不能提出给负责人选择；京东适用时按 Skill 默认覆盖，淘宝等平台只能按当前真实能力记录为后续候选。不得把默认采集内容改写成采集深度问题。若本轮把当前品类切换为另一品类，必须先调用 web search 完成新调查，再提出该品类的负责人问题或形成草稿。只要本轮仍有新的 proposedDecision 或 user unresolved item，就必须省略 taskCandidate；本轮 decisionResolution 已明确解决最后一个旧问题时可以同时形成草稿。",
    "taskCandidate 不重复填写未决项；只通过本轮顶层未决事实增量打开、更新或解决未决事实，Workbench 会把唯一的当前未决集合投影进草稿。",
    `Final answer JSON Schema: ${JSON.stringify(codexOutputSchema())}`,
    `Workbench state: ${JSON.stringify(input.session)}`,
    "Current turn 始终是未经预先解释的用户原文，可能同时包含回答、事实补充、纠正、否定或问题；必须逐项承接后再决定本轮状态增量。",
    `Current turn trigger: ${JSON.stringify(input.trigger)}`,
  ].join("\n\n");
}

export function requiresInitialCategoryResearch(input: CategoryInterviewRuntimeInput) {
  const hasPersistedSearchEvidence = input.session.messages.some((message) => message.role === "assistant"
    && message.timelineParts?.some((part) => part.type === "activity"
      && part.activity.kind === "web_search" && part.activity.status === "completed"));
  return input.trigger.type === "user_message"
    && input.session.decisions.length === 0
    && input.session.taskDrafts.length === 0
    && !hasPersistedSearchEvidence;
}

export function requiresCategoryResearch(
  input: CategoryInterviewRuntimeInput,
  output: CategoryInterviewRuntimeOutput,
) {
  if (requiresInitialCategoryResearch(input)) return true;
  const target = output.taskCandidate?.category;
  if (!target) return false;
  const current = [...input.session.taskDrafts].reverse().find((item) => item.status === "draft"
    || item.status === "confirmed");
  return Boolean(current && !sameCategory(current.content.category, target));
}

function sameCategory(
  left: { code: string; label: string },
  right: { code: string; label: string },
) {
  return left.code === right.code && normalizeCategoryLabel(left.label) === normalizeCategoryLabel(right.label);
}

function normalizeCategoryLabel(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s_，。！？、；：,.!?;:-]/g, "");
}

function parseOutput(text: string, observedEvents: string[]): CategoryInterviewRuntimeOutput {
  const output = parseCodexStructuredOutput({
    text,
    schema: categoryInterviewRuntimeOutputSchema,
    label: "Codex 返回的抓取规划结果",
    observedEvents,
  });
  return output;
}
