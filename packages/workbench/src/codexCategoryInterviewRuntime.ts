import { copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  captureTaskMaterializationSchema,
  categoryInterviewRuntimeOutputSchema,
  type CaptureTaskMaterialization,
  type CategoryInterviewRuntimeOutput,
} from "@domain-analysis/shared";
import type {
  CategoryInterviewMaterializationInput,
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
  reasoningEffort: string;
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
    materialize: (input) => materializeCaptureTask(options, client, runtimeSkillPath, input),
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
  await prepareRuntimeSkill(options.repositoryRoot, runtimeSkillPath);
  let result: CodexAppServerResult | undefined;
  let eventSequence = 0;
  let finalizingStarted = false;
  // WHY：同一运行时复用官方 stdio 连接，但每轮仍新建 ephemeral thread；Workbench 继续独占业务会话事实。
  for await (const item of client.run(
    interviewPrompt(input), input.signal, undefined, undefined, input.session.session.modelSelection,
  )) {
    if (item.type === "text_delta") {
      yield { type: "text_delta", delta: item.delta };
      continue;
    }
    if (item.type === "event") {
      eventSequence += 1;
      const activity = projectCodexAppServerActivity(item, eventSequence, {
        lifecycle: "启动商品采访 Agent",
        analysis: "理解用户输入并更新采访记录",
        finalizing: "整理并校验采访记录",
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
    yield { type: "activity", activity: finalizingActivity("整理并校验采访记录", "running") };
  }
  yield { type: "activity", activity: finalizingActivity("整理并校验采访记录", "completed") };
  yield { type: "completed", output };
}

async function materializeCaptureTask(
  options: CodexCategoryInterviewRuntimeOptions,
  client: CodexAppServerClient,
  runtimeSkillPath: string,
  input: CategoryInterviewMaterializationInput,
): Promise<CaptureTaskMaterialization> {
  await prepareRuntimeSkill(options.repositoryRoot, runtimeSkillPath);
  let result: CodexAppServerResult | undefined;
  for await (const item of client.run(
    materializationPrompt(input), undefined, undefined, undefined, input.session.session.modelSelection,
  )) {
    if (item.type === "result") result = item.result;
  }
  if (!result) throw new Error("Codex 结构化执行流未返回结果");
  if (result.interrupted) throw new Error("Codex 结构化执行被中断");
  if (result.observedItemTypes.includes("web_search")) {
    // WHY：确认后的步骤只能忠实转换已确认范围；继续调查会在用户不知情时改变任务事实。
    throw new Error("确认后的结构化步骤不得继续搜索或补充新事实");
  }
  return parseCodexStructuredOutput({
    text: result.outputText ?? "",
    schema: captureTaskMaterializationSchema,
    label: "Codex 返回的正式抓取任务",
    observedEvents: result.observedEvents,
  });
}

async function prepareRuntimeSkill(repositoryRoot: string, runtimeSkillPath: string) {
  await mkdir(path.dirname(runtimeSkillPath), { recursive: true });
  await copyFile(
    path.join(repositoryRoot, ".agents", "skills", "interview-product-category", "SKILL.md"),
    runtimeSkillPath,
  );
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
  if (!requiresInitialCategoryResearch(input)) return;
  if (!observedItemTypes.includes("web_search")) {
    // WHY：URL 字符串本身不能证明 Agent 做过调查；App Server 的 webSearch item 是当前运行 seam 可审计的最小真实行为证据。
    throw new Error("采访范围草案缺少本轮主动来源调查证据（未观察到已完成的 web_search item）");
  }
  if (!output.proposedDecision && !output.draftMarkdown) {
    throw new Error("新品类首轮调查后既未提出真实负责人问题，也未形成采访范围草案");
  }
}

function interviewPrompt(input: CategoryInterviewRuntimeInput) {
  const initialResearchInstruction = requiresInitialCategoryResearch(input)
    ? "这是新品类首轮或其重试：必须先调用 web search 主动调查品类范围与真实候选来源；调查本身不授权生成草稿，随后必须按范围依据纪律决定提出一个负责人问题或形成草稿。不得先询问 Skill 已定义默认值的市场或品类。"
    : "先完整理解本轮用户原文，再按已持久化的消息、决定、未决项和草稿继续推进；不要把当前问题当成限制输入的表单，也不要丢掉回答之外的纠正、补充事实或追问。";
  return [
    "$interview-product-category 请严格执行该 Skill。Skill 已由 Workbench 通过本轮 skill input 注入；不要通过本地命令查找或读取 Skill、AGENTS.md、开发文档或 Git 状态，也不要声称 Skill 缺失。首条用户消息已经是抓取需求，不要再次确认品类。",
    "下面的 Workbench typed state 是唯一业务事实；本轮是无持久 Session 的独立执行。",
    initialResearchInstruction,
    "执行期间必须通过 commentary agent message 用正常中文持续汇报真实进展；commentary 会直接流式展示给用户，绝对不能输出 JSON。",
    "只有 final_answer 是机器协议：最终只返回一份符合下方 JSON Schema 的 JSON 对象，不要使用 Markdown 代码块或添加解释。",
    "每轮 final_answer 表达的是你对本轮原始输入的理解和由此产生的增量，不要重报 Workbench 已持有的全部状态。普通解释写入 assistantText；用户提供或纠正的相关事实要在 assistantText 中明确记录。纯解释可以只返回 assistantText。",
    "若当前存在 proposed Decision，先判断用户原文如何处理它。只有语义明确回答时才返回 decisionResolution：decisionId 必须引用现有 proposal；序号、‘按推荐’等表达规范化成对应 option label；自定义答案提炼成准确选择；rationale 说明如何理解整条原文。用户若纠正或否定问题前提，且该问题确实不应由负责人决定，则改用 decisionWithdrawal 引用并撤回现有 proposal，rationale 记录原因；两者不能同时返回。用户同时补充的范围、排除项、来源或事实不能丢弃。若语义不明确或只是在追问原因，则两者都省略，先正常回应或只追问一个必要澄清。",
    "decisionResolution 与 decisionWithdrawal 都不是单独回合。处理当前问题后必须在同一个 final_answer 继续推进：仍有下一个真实负责人取舍就提出一个新的 proposedDecision；没有则完成必要调查并形成 draftMarkdown。不要只回复‘已记录’后等待用户再说‘继续’。",
    "需要负责人决定时，assistantText 只写背景，不得抄写问题、选项或编号；只用 proposedDecision 表达唯一问题、2–3 个建议、推荐选择与理由。owner=user 未决项必须与这个 proposal 使用同一个 key，resolvedUnresolvedKeys 只能独立解决系统负责的未决事实。界面会把问题确定性编号后合成为普通对话，用户可以直接输入建议之外的答案。",
    "来源平台、网站与渠道是系统调查事实，不能提出给负责人选择；采访确认品类、市场、内容、排除边界、品牌筛选策略、品牌批次、每轮型号量和每品牌型号上限。若用户没有修改，按 Skill 把‘来源品牌排行榜综合评分大于 0、最多 20 个品牌；每批 3 个品牌；每品牌每轮 10 个型号；每品牌最多 20 个型号’完整写入草案，由负责人随草案一次确认，不要为四个默认值制造四轮问题。实际榜单、入选品牌和品牌目录由确认后的 Planning Run 调查。来源只有在公开、可审计并能由当前 Provider 执行时才进入计划。若本轮把当前品类切换为另一品类，必须先调用 web search 完成新调查，再提出该品类的负责人问题或形成草案。只要本轮仍有新的 proposedDecision 或 user unresolved item，就必须省略 draftMarkdown；本轮 decisionResolution 已明确解决最后一个旧问题时可以同时形成草案。",
    "生成 draftMarkdown 前，必须逐项检查会改变纳入商品集合、市场范围或观察时间范围的边界依据。只有用户当前或历史原文、confirmed Interview Decision、Skill 明确批准的系统默认，或不包含负责人选择的客观调查事实，才能直接成为草案边界。其余会改变结果的边界必须选择影响最大的一个形成 proposedDecision，并省略 draftMarkdown；推荐答案只是 proposal，不等于用户确认。这不是最低问题数要求，用户已完整给出必要范围时允许零问题生成草案。",
    "draftMarkdown 是给人审阅的采访范围草案，不是 CaptureTask 数据结构。它只能使用普通 Markdown，总结用户原始要求、已确认范围、纳入/排除项、采访回答和调查事实；来源可以用自然语言和链接记录。严禁在这里输出 JSON、taskCandidate、sourceCandidates、observedAt、decisionIds 或正式 Crawl Plan。",
    "生成 draftMarkdown 时必须同时返回 draftCoverage.scopeEvidenceUrls：列出用于判断品类边界、市场口径或负责人取舍背景的全部关键网页搜索证据。每个 URL 必须来自本会话时间线里已完成的 web_search，并原样写进 draftMarkdown，且不能重复。它只证明采访范围经过调查，不是品牌清单、执行来源或 Crawl Plan；品牌官网、参数说明书、标准监管和技术原理由 Planning Run 在任务确认后调查。不生成草案时必须省略 draftCoverage。",
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

function parseOutput(text: string, observedEvents: string[]): CategoryInterviewRuntimeOutput {
  const output = parseCodexStructuredOutput({
    text,
    schema: categoryInterviewRuntimeOutputSchema,
    label: "Codex 返回的抓取规划结果",
    observedEvents,
  });
  return output;
}

function materializationPrompt(input: CategoryInterviewMaterializationInput) {
  return [
    "把用户已经确认的 Markdown 采访范围草案忠实转换成正式 Capture Task。",
    "这是确认后的纯结构化步骤：不得调用 web search、不得提出问题、不得补充草案中不存在的事实、不得改变范围。",
    "sourceCandidates 只收录草案中已经明确出现且具有有效 http/https URL 的调查种子；没有精确 URL 就省略，不得为了凑品牌、平台、标准或技术四类入口现场编造。sourceKind 必须按发布者身份判断：只有品牌自己发布的官网入口才是 brand_official；ZOL 等第三方商品数据库、聚合目录或媒体平台不是品牌官网，当前无法归入其他明确角色时使用 other。完整来源清单由后续 Planning Run 调查。草案若明确纳入产品图集、型号图片、商品原图或来源原图，必须把这项作为 generalTopics 或 categoryTopics 中的正向采集内容保留，不能只写在 sourceCandidates 的 expectedContents、role 或链接说明里。",
    "originalRequest 使用最初用户要求；category.code 使用稳定的小写英文 slug。brandSelectionPolicy、executionCadencePolicy 和 modelCoveragePolicy 必须忠实转换草案中的确认值。当前默认策略对应 source_brand_ranking/comprehensive_score/minimumScoreExclusive=0/maxBrands=20、fixed/brandBatchSize=3/modelsPerBrandPerRound=10、max_models_per_brand/maxModelsPerBrand=20；不得用兼容默认代替草案事实。来源候选只忠实转换草案中已经确认的公开入口，不增加平台专用字段。",
    "最终只返回符合下方 JSON Schema 的 JSON 对象，不要使用 Markdown 代码块或添加解释。",
    `Final answer JSON Schema: ${JSON.stringify(zodSchemaToCodexJsonSchema(captureTaskMaterializationSchema))}`,
    `Initial request: ${JSON.stringify(input.session.session.initialRequest)}`,
    `Confirmed decisions: ${JSON.stringify(input.session.decisions.filter((item) => item.status === "confirmed"))}`,
    `Confirmed Markdown draft:\n${input.draftMarkdown}`,
  ].join("\n\n");
}
