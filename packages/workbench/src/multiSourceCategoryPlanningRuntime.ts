import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  crawlPlanContentSchema,
  completedSourceReferenceSchema,
  multiSourcePlanningAuditSchema,
  publicSourceResearchSchema,
  sourceCoverageFamilyKinds,
  type CaptureTask,
  type CompletedSourceReference,
  type CrawlPlanContent,
  type PublicSourceResearch,
  type SourceCoverageAssessment,
} from "@domain-analysis/shared";

import {
  createCodexAppServerClient,
  type CodexAppServerClient,
  type CodexAppServerResult,
} from "./codexAppServerClient";
import { projectCodexAppServerActivity } from "./codexAppServerActivity";
import { parseCodexStructuredOutput, zodSchemaToCodexOutputSchema } from "./codexStructuredOutput";
import type { CrawlPlanningRuntime, CrawlPlanningRuntimeEvent } from "./crawlPlanningModule";

const publicProviderVersion = "2.0.0";

export type PublicSourcePlanningResearchEvent =
  | Exclude<CrawlPlanningRuntimeEvent, { type: "completed" }>
  | { type: "completed"; research: PublicSourceResearch };

interface PublicSourcePlanningResearchInput {
  task: CaptureTask;
  coverage: SourceCoverageAssessment;
  correction?: {
    previousResearch: PublicSourceResearch;
    validationErrors: string[];
  };
  signal?: AbortSignal;
}

export interface PublicSourcePlanningResearcher {
  run(input: PublicSourcePlanningResearchInput): AsyncIterable<PublicSourcePlanningResearchEvent>;
  close?(): Promise<void>;
}

export function createCodexPublicSourcePlanningResearcher(options: {
  repositoryRoot: string;
  model: string;
  reasoningEffort: string;
  executable?: string;
}): PublicSourcePlanningResearcher {
  const runtimeCwd = path.join(tmpdir(), "domain-analysis-public-source-planning");
  const client = createCodexAppServerClient({
    cwd: runtimeCwd,
    packageRoot: options.repositoryRoot,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    executable: options.executable,
    // WHY：公开来源研究会同时返回多族、多主题 exact URL，真实微波炉规划已证明 180 秒不足。
    // TRADE-OFF：只放宽该研究 turn 到 5 分钟，仍由现有中断机制有界终止，不改变访谈或其他 Codex 调用。
    timeoutMs: 300_000,
    webSearch: true,
  });
  return {
    run: async function* (input) {
      // WHY：launchd 下不能依赖临时目录曾被其他流程创建；为每次真实研究准备独立且可预测的运行目录。
      await mkdir(runtimeCwd, { recursive: true });
      yield* runPublicSourceResearch(client, input);
    },
    close: () => client.close(),
  };
}

export function createMultiSourceCategoryPlanningRuntime(options: {
  catalogRuntime: CrawlPlanningRuntime;
  publicSourceResearcher: PublicSourcePlanningResearcher;
  now?: () => Date;
}): CrawlPlanningRuntime {
  return {
    run: (input) => runMultiSourcePlanning(options, input),
    close: async () => {
      await options.catalogRuntime.close?.();
      await options.publicSourceResearcher.close?.();
    },
  };
}

async function* runMultiSourcePlanning(
  options: Parameters<typeof createMultiSourceCategoryPlanningRuntime>[0],
  input: Parameters<CrawlPlanningRuntime["run"]>[0],
): AsyncIterable<CrawlPlanningRuntimeEvent> {
  const completedCatalog = input.coverage.productCatalog.status === "satisfied"
    ? input.coverage.productCatalog.reference : undefined;
  let catalogResult: Extract<CrawlPlanningRuntimeEvent, { type: "completed" }> | undefined;
  if (!completedCatalog) {
    for await (const event of options.catalogRuntime.run(input)) {
      if (event.type === "completed") {
        catalogResult = event;
        continue;
      }
      // WHY：商品目录子阶段不能提前宣告整个多来源计划完成；最终确认活动由研究子阶段统一给出。
      if (event.type === "activity" && event.activity.kind === "finalizing") continue;
      yield event;
    }
    if (!catalogResult) throw new Error("商品目录规划没有返回 Crawl Plan 内容");
  } else {
    yield { type: "activity", activity: { id: "catalog-reused", kind: "analysis",
      label: "引用已完成的 ZOL 原始数据", status: "completed" } };
  }

  let research: PublicSourceResearch | undefined;
  let correction: PublicSourcePlanningResearchInput["correction"];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    research = undefined;
    for await (const event of options.publicSourceResearcher.run({
      task: input.task, coverage: input.coverage, correction, signal: input.signal,
    })) {
      if (event.type === "completed") {
        research = event.research;
        continue;
      }
      yield event;
    }
    if (!research) throw new Error("公开专业来源研究没有返回结构化结果");
    const validationErrors = coveragePlanningBlockers(input.coverage, research);
    if (attempt === 0 && validationErrors.length > 0) {
      // WHY：覆盖门只能在完整结构化结果上校验；把原样错误反馈一次，可补齐搜索方向，同时避免无界模型循环。
      correction = { previousResearch: research, validationErrors };
      continue;
    }
    break;
  }
  if (!research) throw new Error("公开专业来源研究没有返回结构化结果");

  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const content = mergePublicSources(input.task, catalogResult?.content ?? completedCatalog!,
    research, observedAt, input.coverage);
  yield {
    type: "completed",
    assistantText: `${catalogResult?.assistantText ?? "ZOL 原始数据已完成，本次不重复规划或抓取。"} 已按当前缺口形成 ${content.sources.filter((source) => source.provider.key === "public.web-resource").length} 个公开原始来源入口。`,
    content,
  };
}

async function* runPublicSourceResearch(
  client: CodexAppServerClient,
  input: PublicSourcePlanningResearchInput,
): AsyncIterable<PublicSourcePlanningResearchEvent> {
  let result: CodexAppServerResult | undefined;
  let eventSequence = 0;
  for await (const item of client.run(publicSourceResearchPrompt(input), input.signal, undefined,
    zodSchemaToCodexOutputSchema(publicSourceResearchSchema))) {
    if (item.type === "text_delta") {
      yield { type: "text_delta", delta: item.delta };
      continue;
    }
    if (item.type === "event") {
      eventSequence += 1;
      const activity = projectCodexAppServerActivity(item, eventSequence, {
        lifecycle: "启动多来源规划研究",
        analysis: "拆解专业主题并调查公开来源",
        finalizing: "整理并校验多来源计划",
      });
      if (activity) yield { type: "activity", activity };
      continue;
    }
    result = item.result;
  }
  if (!result) throw new Error("公开专业来源研究没有返回 Codex 结果");
  if (result.interrupted) {
    yield { type: "interrupted" };
    return;
  }
  if (!result.observedItemTypes.includes("web_search")) {
    throw new Error("公开专业来源研究必须实际执行网页搜索");
  }
  const research = parseCodexStructuredOutput({
    text: result.outputText ?? "",
    schema: publicSourceResearchSchema,
    label: "公开专业来源研究结果",
    observedEvents: result.observedEvents,
  });
  yield { type: "completed", research };
}

function publicSourceResearchPrompt(input: PublicSourcePlanningResearchInput) {
  const { task, coverage, correction } = input;
  const scope = {
    category: task.content.category,
    marketScope: task.content.marketScope,
    includedTopics: [...task.content.generalTopics, ...task.content.categoryTopics],
    excludedContent: task.content.excludedContent,
    confirmedSourceCandidates: task.content.sourceCandidates,
  };
  const coverageInput = {
    policyVersion: coverage.policyVersion,
    families: coverage.families,
    facets: coverage.facets,
    gaps: coverage.gaps.filter((gap) => gap.kind !== "product_catalog"),
    attemptedUrls: coverage.attemptedUrls,
  };
  return [
    "你正在执行通用品类抓取系统的 Planning 研究阶段，不是在撰写知识报告。不要读取本地 Skill、AGENTS、仓库或 Git；本提示就是完整协议。",
    `已确认 Capture Task 范围：${JSON.stringify(scope)}`,
    "阶段 1 只保存原始网页、PDF、附件与来源血缘，不清洗，不生成结论，也不判断资料是否足以支撑导购。",
    "先按当前品类拆解可搜索的专业知识主题。必须覆盖：底层工作原理、核心部件及其原理、安全与监管、性能与测试、使用与维护；品类特有主题可追加。facet 使用协议枚举，不能把当前品类词写成跨品类固定模板。",
    `当前 Source Dataset 覆盖与缺口：${JSON.stringify(coverageInput)}`,
    "只调查当前 family/facet 缺口，不重复已接受或已尝试的 exact URL。每个缺口的 sources 数量和不同 URL origin 数量必须分别达到 targetCandidateCount 与 targetOriginCount；这些额外入口是失败备选。一个查询或来源失败时记录 blocked 并继续其余调查。",
    "每个候选对应一个 exact URL，只能声明该 URL 自身实际返回的一种 rawFormat。HTML 页面里即使链接 PDF，也只能标 HTML；要抓 PDF 必须把 PDF 直达 URL 作为另一个候选。",
    "只返回公开、可审计、无需绕过登录/验证码/许可/访问控制的 HTTPS 直达网页或 PDF。排除 ZOL、电商、搜索结果列表、聚合下载站和占位 URL。标准监管优先目标市场官方原文；专业原理优先政府、大学、学术或行业机构；品牌资料只选品牌官方说明书、白皮书或技术资料。",
    "每个来源只说明对应主题和原始抓取价值，不能声称已充分覆盖。sources 与 blocked 共同表达广撒网结果；不得因局部失败停止整个研究。",
    ...(correction ? [
      `上一轮完整研究结果：${JSON.stringify(correction.previousResearch)}`,
      `现有覆盖校验返回的错误：${JSON.stringify(correction.validationErrors)}`,
      "这是唯一一次覆盖修正。保留上一轮仍符合条件的 topics、sources 和 blocked，针对上述原样错误继续网页搜索；final 必须返回合并后的完整替换结果，不能只返回新增项，也不能自行改变覆盖标准。",
    ] : []),
    "执行期间用正常中文 commentary 汇报搜索进展，不要在 commentary 输出 JSON。只有 final_answer 返回符合 output schema 的 JSON，不要 Markdown 或解释。",
  ].join("\n\n");
}

export function mergePublicSources(
  task: CaptureTask,
  catalogInput: CrawlPlanContent | CompletedSourceReference,
  researchInput: PublicSourceResearch,
  observedAt: string,
  priorCoverage: SourceCoverageAssessment,
) {
  const parsedResearch = publicSourceResearchSchema.parse(researchInput);
  const attempted = new Set(priorCoverage.attemptedUrls.map(normalizeUrl));
  const repeated = parsedResearch.sources.filter((source) => attempted.has(normalizeUrl(source.url)));
  const ambiguousFormats = parsedResearch.sources.filter((source) => source.rawFormats.length !== 1);
  const research = publicSourceResearchSchema.parse({ ...parsedResearch,
    sources: parsedResearch.sources.filter((source) => !attempted.has(normalizeUrl(source.url))
      && source.rawFormats.length === 1) });
  const publicSources = research.sources.map((source) => createPublicSource(task, research, source, observedAt));
  const completedCatalog = completedSourceReferenceSchema.safeParse(catalogInput);
  const catalogContent = completedCatalog.success ? undefined : crawlPlanContentSchema.parse(catalogInput);
  const planningBlockers = [
    ...(catalogContent?.planningBlockers ?? []),
    ...repeated.map((source) => `公开来源已经尝试过，不能重复规划：${source.url}`),
    ...ambiguousFormats.map((source) => `exact URL 只能声明一种实际响应格式：${source.url}`),
    ...coveragePlanningBlockers(priorCoverage, research),
  ];
  const audit = multiSourcePlanningAuditSchema.parse({
    kind: "multi_source_planning",
    productCatalog: completedCatalog.success
      ? { kind: "completed_source_reference", ...completedCatalog.data, observedAt }
      : catalogContent!.researchAudit,
    publicSourceResearch: research,
    priorCoverage,
    observedAt,
  });
  return crawlPlanContentSchema.parse({
    summary: catalogContent
      ? `${catalogContent.summary}；另规划 ${publicSources.length} 个标准、专业技术与品牌公开原始入口。`
      : `ZOL 引用已完成 Source Dataset；本次仅规划 ${publicSources.length} 个标准、专业技术与品牌公开原始入口。`,
    excludedContent: catalogContent?.excludedContent ?? task.content.excludedContent,
    sources: [...(catalogContent?.sources ?? []), ...publicSources],
    planningBlockers,
    researchAudit: audit,
    executionChecklistVersion: 7,
    taskId: task.id,
    taskRevision: task.revision,
  });
}

function coveragePlanningBlockers(coverage: SourceCoverageAssessment, research: PublicSourceResearch) {
  const topicFacets = new Map(research.topics.map((topic) => [topic.key, topic.facet]));
  return coverage.gaps.filter((gap) => gap.kind !== "product_catalog").flatMap((gap) => {
    const candidates = research.sources.filter((source) => gap.kind === "family"
      ? sourceCoverageFamilyKinds[gap.key as keyof typeof sourceCoverageFamilyKinds]
        ?.includes(source.sourceKind as never)
      : source.topics.some((topic) => topicFacets.get(topic) === gap.key));
    const origins = new Set(candidates.map((source) => new URL(source.url).origin));
    const blockers = [];
    if (candidates.length < gap.targetCandidateCount) {
      blockers.push(`${gap.kind} ${gap.key} 需要至少 ${gap.targetCandidateCount} 个新候选，当前 ${candidates.length} 个`);
    }
    if (origins.size < gap.targetOriginCount) {
      blockers.push(`${gap.kind} ${gap.key} 需要至少 ${gap.targetOriginCount} 个独立网站，当前 ${origins.size} 个`);
    }
    return blockers;
  });
}

function normalizeUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function createPublicSource(
  task: CaptureTask,
  research: PublicSourceResearch,
  source: PublicSourceResearch["sources"][number],
  observedAt: string,
) {
  const sourceKey = `public.${source.key}`;
  const topicMap = new Map(research.topics.map((topic) => [topic.key, topic]));
  const topics = source.topics.flatMap((key) => {
    const topic = topicMap.get(key);
    return topic ? [topic.label, ...topic.searchTerms] : [];
  });
  const taskTopics = [...new Set([task.content.category.label, ...topics])].slice(0, 100);
  const outputFormats = source.rawFormats.map((format) => ({
    HTML: "html" as const,
    PDF: "document" as const,
    TEXT: "text" as const,
  })[format]);
  const sourceCandidateIds = task.content.sourceCandidates
    .filter((candidate) => new URL(candidate.entryUrl).href === new URL(source.url).href)
    .map((candidate) => candidate.id);
  return {
    key: sourceKey,
    name: source.name,
    publisher: source.publisher,
    sourceKind: source.sourceKind,
    sourceCandidateIds,
    role: source.reason.slice(0, 1_000),
    entryUrls: [source.url],
    provider: { key: "public.web-resource", version: publicProviderVersion, configuration: [
      { key: "mode", value: "planned_routes" },
      { key: "maximum_bytes", value: 25_000_000 },
      { key: "maximum_pages_per_target", value: 1 },
    ] },
    accessPolicy: { kind: "paced_http" as const, version: "public-exact-v2",
      maxRequestsPerMinute: 6, minimumIntervalMs: 10_000, maximumRunMs: 300_000 },
    stopPolicy: { requestBudget: 8, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true as const },
    rawOutputPolicy: { formats: [...new Set(outputFormats)], retainAssets: source.rawFormats.includes("PDF") },
    observationLevel: "search_discovered" as const,
    accessState: "public" as const,
    observedAt,
    targets: [{
      key: `${sourceKey}.resource`,
      name: source.name.slice(0, 300),
      taskTopics,
      captureUnit: "一个 Planning 搜索发现的公开原始网页或附件",
      rawFormats: source.rawFormats,
      quantity: { mode: "target_count" as const, targetCount: 1, unit: "公开入口",
        denominator: "1 个 Planning 搜索发现并经负责人确认的 HTTPS 直达入口",
        rationale: "该目标只负责保存一份原始响应及来源血缘，不推断资料充分性" },
      uniqueKey: "规范化请求 URL + 最终 URL + 原始内容哈希",
      traversal: "仅访问计划内 exact URL，不自动扩展到站内其他页面",
      stopCondition: "记录成功、缺失、源站错误或访问限制后结束本来源；不得绕过登录、验证码或许可要求",
      providerConfiguration: [{ key: "route", value: "exact" }, { key: "url", value: source.url }],
    }],
    executionBlockers: [],
  };
}
