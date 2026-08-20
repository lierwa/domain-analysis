import { copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  crawlPlanningRuntimeOutputSchema,
  type CrawlPlanningRuntimeOutput,
} from "@domain-analysis/shared";

import type {
  CrawlPlanningRuntime,
  CrawlPlanningRuntimeEvent,
} from "./crawlPlanningModule";
import { isDirectDocumentEntry } from "./crawlPlanningDocumentPolicy";
import { finalizingActivity, projectCodexAppServerActivity } from "./codexAppServerActivity";
import {
  CodexAppServerError,
  createCodexAppServerClient,
  type CodexAppServerClient,
  type CodexAppServerResult,
} from "./codexAppServerClient";
import {
  parseCodexStructuredOutput,
  zodSchemaToCodexJsonSchema,
  zodSchemaToCodexOutputSchema,
} from "./codexStructuredOutput";

export interface CodexCrawlPlanningRuntimeOptions {
  repositoryRoot: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  executable?: string;
  timeoutMs?: number;
}

export function createCodexCrawlPlanningRuntime(
  options: CodexCrawlPlanningRuntimeOptions,
): CrawlPlanningRuntime {
  const runtimeCwd = path.join(tmpdir(), "domain-analysis-crawl-planning");
  const skillPath = path.join(runtimeCwd, ".agents", "skills", "plan-product-crawl", "SKILL.md");
  const client = createCodexAppServerClient({
    cwd: runtimeCwd,
    packageRoot: options.repositoryRoot,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    executable: options.executable,
    // WHY：完整抓取清单需要逐一核对候选来源和技术资料；保留硬上限，但不再沿用采访单轮的 180 秒预算。
    timeoutMs: options.timeoutMs ?? 600_000,
    webSearch: true,
    skill: { name: "plan-product-crawl", path: skillPath },
    // WHY：官方 outputSchema 约束当前 turn 的最终消息；本地 Zod 仍负责领域 contract 的最终验收。
    outputSchema: zodSchemaToCodexOutputSchema(crawlPlanningRuntimeOutputSchema),
  });
  return {
    run: (input) => runPlanning(options, client, runtimeCwd, skillPath, input),
    close: () => client.close(),
  };
}

async function* runPlanning(
  options: CodexCrawlPlanningRuntimeOptions,
  client: CodexAppServerClient,
  runtimeCwd: string,
  skillPath: string,
  input: Parameters<CrawlPlanningRuntime["run"]>[0],
): AsyncIterable<CrawlPlanningRuntimeEvent> {
  await mkdir(path.dirname(skillPath), { recursive: true });
  await copyFile(path.join(options.repositoryRoot, ".agents", "skills", "plan-product-crawl", "SKILL.md"), skillPath);
  let result: CodexAppServerResult | undefined;
  let eventSequence = 0;
  let finalizingStarted = false;
  const commentaryProjection: PlanningCommentaryProjection = { mode: "new", buffer: "", messageCount: 0 };
  let prompt = planningPrompt(input);
  let threadId: string | undefined;
  let hasWebResearch = false;
  // WHY：大结构化结果只把既有校验错误回填一次；同一 ephemeral thread 保留首轮搜索，不引入新校验或新会话事实。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = undefined;
    for await (const item of client.run(prompt, input.signal, threadId)) {
      if (item.type === "text_delta") {
        const delta = projectPlanningCommentaryDelta(commentaryProjection, item.delta);
        if (delta) yield { type: "text_delta", delta };
        continue;
      }
      if (item.type === "event") {
        eventSequence += 1;
        const activity = projectCodexAppServerActivity(item, eventSequence, {
          lifecycle: "启动抓取计划 Agent",
          analysis: "核对任务范围并规划来源",
          finalizing: "整理并校验抓取计划",
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
    if (!result) throw new Error("Codex 抓取规划流未返回结果");
    if (result.interrupted) {
      yield { type: "interrupted" };
      return;
    }
    hasWebResearch ||= result.observedItemTypes.includes("web_search");
    try {
      if (!hasWebResearch) requireWebResearch(result);
      const output = parseOutput(result.outputText ?? "", result.observedEvents);
      normalizeDirectDocumentCandidates(output, input.task);
      await input.validateOutput?.(output);
      if (!finalizingStarted) {
        yield { type: "activity", activity: finalizingActivity("整理并校验抓取计划", "running") };
      }
      yield { type: "activity", activity: finalizingActivity("整理并校验抓取计划", "completed") };
      yield { type: "completed", output };
      return;
    } catch (error) {
      if (attempt === 1 || !result.threadId) throw error;
      const message = existingValidationMessage(error);
      yield { type: "text_delta",
        delta: `第一次计划未通过现有校验，已回填错误并修正一次：${message}` };
      threadId = result.threadId;
      prompt = repairPrompt(message);
      commentaryProjection.mode = "new";
      commentaryProjection.buffer = "";
    }
  }
}

interface PlanningCommentaryProjection {
  mode: "new" | "plain" | "structured" | "structured_done";
  buffer: string;
  messageCount: number;
}

function projectPlanningCommentaryDelta(state: PlanningCommentaryProjection, delta: string) {
  let body = delta;
  if (body.startsWith("\n\n")) {
    body = body.slice(2);
    state.mode = "new";
    state.buffer = "";
  }
  if (state.mode === "new") {
    state.mode = body.trimStart().startsWith("{") ? "structured" : "plain";
    if (state.mode === "plain") {
      const separator = state.messageCount > 0 ? "\n\n" : "";
      state.messageCount += 1;
      return separator + body;
    }
  }
  if (state.mode === "plain") return body;
  if (state.mode === "structured_done") return undefined;
  state.buffer += body;
  try {
    const parsed = JSON.parse(state.buffer) as { assistantText?: unknown };
    state.mode = "structured_done";
    if (typeof parsed.assistantText !== "string" || !parsed.assistantText.trim()) return undefined;
    const separator = state.messageCount > 0 ? "\n\n" : "";
    state.messageCount += 1;
    // WHY：outputSchema 会让部分模型把 commentary 也包成最终 JSON；这里只投影人读说明，不泄漏计划候选外壳。
    return separator + parsed.assistantText.trim();
  } catch {
    return undefined;
  }
}

function planningPrompt(input: Parameters<CrawlPlanningRuntime["run"]>[0]) {
  const topics = [...input.task.content.generalTopics, ...input.task.content.categoryTopics];
  const candidateChecklist = input.task.content.sourceCandidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    sourceKind: candidate.sourceKind,
    exactEntryUrl: candidate.entryUrl,
    // WHY：模型不能凭“京东”发布者名称猜 Provider；search.jd.com 与 www.jd.com 的生产能力边界不同。
    requiredProvider: candidate.sourceKind === "retailer" && new URL(candidate.entryUrl).hostname === "www.jd.com"
      ? "jd.catalog-product@1.0.0; keep this candidate in its own source with one entry URL and exactly catalog + first_matching_product targets"
      : "public.web-resource@1.0.0; one exact target whose url equals exactEntryUrl",
  }));
  return [
    "$plan-product-crawl 请严格执行该 Skill。Skill 已由 Workbench 显式注入；不要通过本地命令读取 Skill、仓库、AGENTS.md 或 Git 状态。",
    "你只制定计划，不运行批量抓取、不登录、不下载文件、不访问 Cookie/Profile，也不生成 Source Run。",
    "必须使用 web search 核实具体发布者和入口。当前 contract 只允许把来源标为 search_discovered、accessState 写 unknown；搜索发现不能冒充真实访问。Provider 绑定、执行 blocker 与运行时停止条件必须严格遵守已注入 Skill，observedAt 会由 Workbench 覆盖为真实完成时间。",
    "计划必须是 executionChecklistVersion=2 的完整执行清单，直接决定来源、内容和数量。每个采访 source candidate 必须恰好归入一个实际抓取来源并保留原始入口与类型；不得只复制 topic 文本来伪造证据覆盖。每个任务 topic 必须按下面完全一致的原文至少出现在一个确实会返回该类原始事实的 target.taskTopics 中，不能改写或新增 topic。",
    `Required task topics: ${JSON.stringify(topics)}`,
    "quantity.mode 只能是 all_available、target_count 或 sample。target_count/sample 必须给正整数；all_available 也必须写清可审核分母和停止口径。不得使用‘尽量多’。",
    "Provider key/version/configuration、访问频率、请求预算和原始输出必须逐项遵守已注入 Skill。所有来源都必须绑定当前两个生产 Provider 之一，严禁 provider_missing、workbench.unconfigured 或任何占位 Provider；不能安全匿名请求的资源不得放进本轮完整清单，必须改用搜索核实到的可执行精确公开 URL。除符合 Skill 固定结构的京东来源外，所有公网 HTTPS 来源（包括其他零售入口、品牌官网、标准/监管、说明书和技术资料）都绑定 public.web-resource@1.0.0。",
    "执行期间只用 commentary 普通中文持续解释搜索与判断；commentary 不能输出 JSON。final_answer 只返回符合 JSON Schema 的对象，不加 Markdown 代码块。",
    `Final answer local validation JSON Schema: ${JSON.stringify(zodSchemaToCodexJsonSchema(crawlPlanningRuntimeOutputSchema))}`,
    `Capture Task: ${JSON.stringify(input.task)}`,
    `Previous plan versions: ${JSON.stringify(input.previousPlans.slice(0, 3))}`,
    `User revision instruction: ${JSON.stringify(input.instruction ?? "首次制定计划")}`,
    // WHY：把精确 URL 核对表放在提示末尾，避免长 JSON Schema 掩盖“列出来源不等于执行该入口”的硬约束。
    `Candidate execution checklist: ${JSON.stringify(candidateChecklist)}. requiredProvider is authoritative for each candidate; never infer Provider from publisher/name, never merge multiple candidates into one source, and never attach one candidate id to another candidate's source. Before final_answer, verify every id appears exactly once, keeps sourceKind and exactEntryUrl, and exactEntryUrl is an actual Provider target. A more precise discovered URL must be an additional source/target, never a replacement for the candidate URL.`,
    `Topic coverage checklist: ${JSON.stringify(topics)}. Before final_answer, verify every target.taskTopics is non-empty and the union of all target.taskTopics equals this exact list; do not omit, rewrite, or invent any topic.`,
    "Provider binding checklist: follow Candidate execution checklist.requiredProvider exactly and leave every executionBlockers array empty. In particular, search.jd.com is public.web-resource and MUST NOT use jd.catalog-product. jd.catalog-product only accepts one www.jd.com HTTPS entry per source; each such candidate stays in its own source with exactly two targets whose sole configurations are operation=catalog and operation=first_matching_product, each target_count=1, source requestBudget=2, source raw formats=[html], and source configuration keys mode=cdp/include_text/exclude_text. mall.jd.com and every other non-www.jd.com exact HTTPS entry use public.web-resource@1.0.0. A public source configuration is exactly mode=exact_https plus integer maximum_bytes (no url key there). Every exact public target configuration url MUST appear in that same source.entryUrls, and every source.entryUrls value has exactly one exact target; never borrow or duplicate another candidate's URL as a target in this source. When an expected manual/table attachment URL is only present in the entry HTML, add a later linked target whose configuration is exactly from_target=<earlier target key> plus link_text=<complete unique anchor text>; it may follow only once and same-origin. Every public target is target_count=1, and requestBudget is at least total target count plus unique exact-entry origin count for robots.txt. Never emit provider_missing.",
    "Attachment completeness checklist: inspect every source candidate expectedContents, observedFormats and exactEntryUrl. If the exactEntryUrl itself is a PDF or another binary document, that exact target must declare document in rawFormats, and its source must declare document in rawOutputPolicy.formats with retainAssets=true; never represent a PDF URL as an HTML target. If expectedContents or observedFormats include 说明书、PDF or 附件表格 while the entry is HTML, an entry HTML target alone is insufficient: add an exact child target or the controlled same-origin linked target. An H5 manual remains html and need not enable asset retention; PDF or table attachments must enable retainAssets and declare document output. For GB 12021.2—2025, keep the official current-standard metadata entry and, if only an official 编制说明/征求意见稿 PDF is publicly discoverable, add it with that exact label and never call it the final normative text.",
  ].join("\n\n");
}

function repairPrompt(message: string) {
  return [
    "上一轮抓取计划没有通过 Workbench 现有校验。保留同一 thread 已完成的搜索和上一轮输出，只修正计划 JSON。",
    `现有校验错误：${message}`,
    "不要改变 Capture Task，不要增加新的解释层或校验规则。final_answer 仍只返回符合本轮 outputSchema 的完整对象。",
  ].join("\n\n");
}

function existingValidationMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").trim().slice(0, 2_000);
}

function requireWebResearch(result: CodexAppServerResult) {
  if (!result.observedItemTypes.includes("web_search")) {
    throw new CodexAppServerError(
      "invalid_output",
      "抓取计划缺少本轮真实网页搜索记录，请重试。",
      `events=${result.observedEvents.join(",")} itemTypes=${result.observedItemTypes.join(",")}`,
    );
  }
}

function parseOutput(text: string, observedEvents: string[]): CrawlPlanningRuntimeOutput {
  return parseCodexStructuredOutput({
    text,
    schema: crawlPlanningRuntimeOutputSchema,
    label: "Codex 返回的抓取计划",
    observedEvents,
  });
}

function normalizeDirectDocumentCandidates(
  output: CrawlPlanningRuntimeOutput,
  task: Parameters<CrawlPlanningRuntime["run"]>[0]["task"],
) {
  for (const candidate of task.content.sourceCandidates) {
    if (!isDirectDocumentEntry(candidate.entryUrl)) continue;
    const source = output.planCandidate.sources.find((item) => item.sourceCandidateIds.includes(candidate.id));
    if (!source || !isPublicPlanningSource(source)) continue;
    const target = source.targets.find((item) => item.providerConfiguration.some(
      (configuration) => configuration.key === "url" && configuration.value === candidate.entryUrl,
    ));
    if (!target) continue;
    // WHY：精确 PDF URL 的媒体类型是已确认输入，不是模型判断；在外部协议 seam 收窄可避免把二进制正文误存成 HTML。
    target.rawFormats = target.rawFormats.filter((format) => format !== "html");
    if (!target.rawFormats.includes("document")) target.rawFormats.push("document");
    if (!source.rawOutputPolicy.formats.includes("document")) source.rawOutputPolicy.formats.push("document");
    source.rawOutputPolicy.retainAssets = true;
  }
  return output;
}

type PlanningSource = CrawlPlanningRuntimeOutput["planCandidate"]["sources"][number];

function isPublicPlanningSource(
  source: PlanningSource,
): source is Extract<PlanningSource, { provider: { key: "public.web-resource" } }> {
  return source.provider.key === "public.web-resource";
}
