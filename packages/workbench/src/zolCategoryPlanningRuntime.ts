import {
  brandRankingPlanningAuditSchema,
  captureTaskRequiresImages,
  crawlPlanContentSchema,
  type CaptureTask,
} from "@domain-analysis/shared";
import { z } from "zod";

import type { CrawlPlanningRuntime, CrawlPlanningRuntimeEvent } from "./crawlPlanningModule";
import { finalizingActivity } from "./codexAppServerActivity";

const zolProviderVersion = "1.2.0";
const keySchema = z.string().regex(/^[a-z][a-z0-9_-]+$/);
const rankingRowSchema = z.object({
  rank: z.number().int().positive(),
  name: z.string().trim().min(1).max(300),
  comprehensiveScore: z.number().finite(),
  key: keySchema,
  catalogUrl: z.string().url().max(2_048),
}).strict();
const rankingObservationSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("verified"),
    rankingUrl: z.string().url().max(2_048),
    rows: z.array(rankingRowSchema).min(1).max(500),
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    evidenceUrls: z.array(z.string().url().max(2_048)).min(1).max(100),
    reason: z.string().trim().min(1).max(2_000),
  }).strict(),
]);
const planningResearchFields = {
  assistantText: z.string().trim().min(1).max(40_000),
  categoryUrl: z.string().url().max(2_048),
  categorySlug: keySchema,
  evidenceUrls: z.array(z.string().url().max(2_048)).min(1).max(100),
  budgetRationale: z.string().trim().min(1).max(2_000),
};
const planningResearchSchema = z.object({
  ...planningResearchFields,
  ranking: rankingObservationSchema,
}).strict();

export interface ZolBrandRankingReader {
  discoverAndRead(input: { categorySlug?: string; rankingUrl?: string; signal?: AbortSignal }): Promise<{
    categoryUrl: string;
    categorySlug: string;
    rankingUrl: string;
    evidenceUrls: string[];
    title: string;
    rows: Array<{ rank: number; name: string; comprehensiveScore: number;
      key: string; catalogUrl: string }>;
  }>;
}

export interface ZolCategoryPlanningRuntimeOptions {
  rankingReader: ZolBrandRankingReader;
  now?: () => Date;
}

export function createZolCategoryPlanningRuntime(
  options: ZolCategoryPlanningRuntimeOptions,
): CrawlPlanningRuntime {
  return {
    run: (input) => runPlanning(options, input),
  };
}

async function* runPlanning(
  options: ZolCategoryPlanningRuntimeOptions,
  input: Parameters<CrawlPlanningRuntime["run"]>[0],
): AsyncIterable<CrawlPlanningRuntimeEvent> {
  requireSupportedTask(input.task);
  if (input.instruction?.trim()) {
    throw new Error("Planning Run 的范围与批次必须先进入已确认 Capture Task，不能用临时指令改写");
  }
  const seed = zolPlanningSeed(input.task);
  const fallbackSlug = seed.categorySlug ?? keySchema.parse(input.task.content.category.code);
  const categoryUrl = `https://detail.zol.com.cn/${fallbackSlug}/`;
  yield { type: "activity", activity: { id: "zol-brand-ranking", kind: "analysis",
    label: `核验 ZOL ${input.task.content.category.label}品牌排行榜`, status: "running" } };
  const research = await resolveRanking(options, input.task, seed, fallbackSlug, categoryUrl, input.signal);
  yield { type: "activity", activity: { id: "zol-brand-ranking", kind: "analysis",
    label: `核验 ZOL ${input.task.content.category.label}品牌排行榜`, status: "completed",
    detail: research.ranking.status === "verified"
      ? `${research.ranking.rows.length} 行 · ${research.ranking.rankingUrl}`
      : research.ranking.reason } };
  validateResearch(research);
  yield { type: "activity", activity: finalizingActivity("整理并校验 Crawl Plan Draft", "running") };
  const content = buildZolCategoryPlanContent(input.task, research,
    (options.now ?? (() => new Date()))().toISOString());
  yield { type: "activity", activity: finalizingActivity("整理并校验 Crawl Plan Draft", "completed") };
  yield { type: "completed", assistantText: planningAssistantText(input.task, research), content };
}

function zolPlanningSeed(task: CaptureTask) {
  const rankingUrls = task.content.sourceCandidates.flatMap((candidate) => {
    try {
      const url = new URL(candidate.entryUrl);
      return url.origin === "https://top.zol.com.cn"
        && /^\/compositor\/\d+\/manu_attention\.html$/.test(url.pathname)
        && !url.search && !url.hash ? [url.href] : [];
    } catch { return []; }
  });
  const uniqueRankingUrls = [...new Set(rankingUrls)];
  if (uniqueRankingUrls.length > 1) throw new Error("Capture Task 包含多个 ZOL 品牌排行榜候选入口");
  if (uniqueRankingUrls[0]) return { rankingUrl: uniqueRankingUrls[0] };
  const slugs = task.content.sourceCandidates.flatMap((candidate) => {
    try {
      const url = new URL(candidate.entryUrl);
      const match = url.origin === "https://detail.zol.com.cn"
        ? url.pathname.match(/^\/([a-z][a-z0-9_-]*)(?:\/|$)/) : null;
      return match?.[1] && match[1] !== "category" ? [match[1]] : [];
    } catch { return []; }
  });
  const uniqueSlugs = [...new Set(slugs)];
  if (uniqueSlugs.length > 1) throw new Error("Capture Task 包含多个 ZOL 门类 slug 候选");
  return { categorySlug: uniqueSlugs[0] ?? keySchema.parse(task.content.category.code) };
}

function validationMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n]+/g, " ").trim().slice(0, 1_500);
}

function requireSupportedTask(task: CaptureTask) {
  if (task.status !== "ready" || !task.confirmedAt) {
    throw new Error("当前 Planning Run 只接受已确认的 Capture Task");
  }
  if (!captureTaskRequiresImages(task.content)) {
    throw new Error("当前任务没有包含产品图集与来源原图，不能生成 ZOL 图集计划");
  }
  if (task.content.unresolvedItems.length > 0) {
    throw new Error("Capture Task 仍有未决项，不能启动 Planning Run");
  }
  if (task.content.brandSelectionPolicy.mode !== "source_brand_ranking"
    || task.content.executionCadencePolicy.mode !== "fixed"
    || task.content.modelCoveragePolicy.mode !== "max_models_per_brand") {
    throw new Error("Capture Task 必须显式确认品牌排行榜筛选、执行批次和每品牌型号上限");
  }
  if (task.content.executionCadencePolicy.modelsPerBrandPerRound
    > task.content.modelCoveragePolicy.maxModelsPerBrand) {
    throw new Error("每品牌每轮型号量不能大于每品牌型号上限");
  }
  return {
    selection: task.content.brandSelectionPolicy,
    cadence: task.content.executionCadencePolicy,
    maxModelsPerBrand: task.content.modelCoveragePolicy.maxModelsPerBrand,
  };
}

function validateResearch(research: z.infer<typeof planningResearchSchema>) {
  const categoryUrl = new URL(research.categoryUrl);
  if (categoryUrl.origin !== "https://detail.zol.com.cn"
    || categoryUrl.pathname !== `/${research.categorySlug}/` || categoryUrl.search || categoryUrl.hash) {
    throw new Error("ZOL 门类入口与 categorySlug 不一致");
  }
  if (!research.evidenceUrls.some((url) => new URL(url).href === categoryUrl.href)) {
    throw new Error("网页证据必须直接包含 ZOL 门类入口");
  }
  if (research.ranking.status === "unavailable") return;
  const rankingUrl = new URL(research.ranking.rankingUrl);
  if (rankingUrl.protocol !== "https:" || rankingUrl.hostname !== "top.zol.com.cn"
    || !rankingUrl.pathname.startsWith("/compositor/")) {
    throw new Error("品牌排行榜必须来自 ZOL compositor 入口");
  }
  if (!research.evidenceUrls.some((url) => new URL(url).href === rankingUrl.href)) {
    throw new Error("网页证据必须包含实际核验的品牌排行榜 URL");
  }
  const ranks = research.ranking.rows.map((row) => row.rank);
  if (new Set(ranks).size !== ranks.length || ranks.some((rank, index) => index > 0 && rank <= ranks[index - 1]!)) {
    throw new Error("榜单行必须按唯一名次升序返回");
  }
  for (const row of research.ranking.rows) {
    validateCatalogUrl(row, research.categorySlug);
  }
}

async function resolveRanking(
  options: ZolCategoryPlanningRuntimeOptions,
  task: CaptureTask,
  seed: { categorySlug?: string; rankingUrl?: string },
  fallbackSlug: string,
  categoryUrl: string,
  signal: AbortSignal | undefined,
) : Promise<z.infer<typeof planningResearchSchema>> {
  const budgetRationale = "预算由已确认的品牌上限、品牌批次、每轮型号量和每品牌型号上限确定性计算。";
  try {
    // WHY：ZOL 门类页和榜单当前使用 GBK；来源 adapter 沿官方链接发现同门类榜单并读取结构，
    // 避免通用 Agent 的网页解码、工具选择或超时改变执行品牌这一业务事实。
    const result = await options.rankingReader.discoverAndRead({ ...seed, signal });
    validateRankingTitle(result.title, task.content.category.label);
    return planningResearchSchema.parse({
      assistantText: `已核验 ZOL ${task.content.category.label}品牌排行榜并形成 Crawl Plan Draft。`,
      categoryUrl: result.categoryUrl,
      categorySlug: result.categorySlug,
      evidenceUrls: result.evidenceUrls,
      budgetRationale,
      ranking: { status: "verified", rankingUrl: result.rankingUrl, rows: result.rows },
    });
  } catch (error) {
    const reason = validationMessage(error);
    return planningResearchSchema.parse({
      assistantText: `ZOL ${task.content.category.label}品牌排行榜当前不可验证，计划保持在确认门。`,
      categoryUrl,
      categorySlug: fallbackSlug,
      evidenceUrls: [categoryUrl],
      budgetRationale,
      ranking: { status: "unavailable", evidenceUrls: [categoryUrl], reason },
    });
  }
}

function validateRankingTitle(title: string, categoryLabel: string) {
  const categoryToken = categoryLabel.replace(/^家用/u, "").replace(/(?:产品|品类)$/u, "").trim();
  if (!categoryToken || !title.includes(categoryToken) || !title.endsWith("品牌排行榜")) {
    throw new Error("ZOL 品牌排行榜标题与 Capture Task 门类不一致");
  }
}

function planningAssistantText(task: CaptureTask, research: z.infer<typeof planningResearchSchema>) {
  return research.ranking.status === "verified"
    ? `已核验 ZOL ${task.content.category.label}品牌排行榜并形成 Crawl Plan Draft。`
    : `ZOL ${task.content.category.label}品牌排行榜当前不可验证，计划保持在确认门。`;
}

function validateCatalogUrl(brand: { key: string; catalogUrl: string }, categorySlug: string) {
  const url = new URL(brand.catalogUrl);
  if (url.origin !== "https://detail.zol.com.cn"
    || url.pathname !== `/${categorySlug}/${brand.key}/` || url.search || url.hash) {
    throw new Error(`品牌 ${brand.key} 的目录 URL 与门类 slug 不一致`);
  }
}

export function buildZolCategoryPlanContent(
  task: CaptureTask,
  researchInput: z.input<typeof planningResearchSchema>,
  observedAt: string,
) {
  const research = planningResearchSchema.parse(researchInput);
  validateResearch(research);
  const policy = requireSupportedTask(task);
  const commonAudit = {
    kind: "brand_ranking_selection" as const,
    categoryUrl: research.categoryUrl,
    categorySlug: research.categorySlug,
    evidenceUrls: research.evidenceUrls,
    observedAt,
    selectionPolicy: {
      scoreField: policy.selection.scoreField,
      minimumScoreExclusive: policy.selection.minimumScoreExclusive,
      maxBrands: policy.selection.maxBrands,
    },
  };
  if (research.ranking.status === "unavailable") {
    const audit = brandRankingPlanningAuditSchema.parse({
      ...commonAudit,
      rankingStatus: "unavailable",
      rankingEvidenceUrls: research.ranking.evidenceUrls,
      rankingReason: research.ranking.reason,
    });
    return crawlPlanContentSchema.parse({
      taskId: task.id,
      taskRevision: task.revision,
      summary: `ZOL ${task.content.category.label}品牌范围已审计；排行榜需要核实，计划保持在确认门。`,
      excludedContent: task.content.excludedContent,
      researchAudit: audit,
      executionChecklistVersion: 5,
      sources: [],
      planningBlockers: [`ZOL ${task.content.category.label}品牌排行榜尚不可验证：${research.ranking.reason}`],
    });
  }

  const selectedRows = research.ranking.rows
    .filter((row) => row.comprehensiveScore > policy.selection.minimumScoreExclusive)
    .slice(0, policy.selection.maxBrands);
  const executionBrands = selectedRows
    .map((row) => ({ key: row.key, name: row.name, catalogUrl: row.catalogUrl }));
  const estimatedModelCapacity = executionBrands.length * policy.maxModelsPerBrand;
  const requestBudget = Math.max(5_000, estimatedModelCapacity * 25);
  // WHY：Timeout 不能超过 Node 计时器安全上限；长计划依靠现有 Resume 延续。
  const maximumRunMs = Math.min(2_000_000_000,
    Math.max(43_200_000, Math.ceil(Math.max(1, estimatedModelCapacity) / 40) * 43_200_000));
  const audit = brandRankingPlanningAuditSchema.parse({
    ...commonAudit,
    rankingStatus: "verified",
    rankingUrl: research.ranking.rankingUrl,
    rankingRows: research.ranking.rows,
    executionBrands,
    blockedSelectedBrands: [],
    brandBatchSize: policy.cadence.brandBatchSize,
    modelsPerBrandPerRound: policy.cadence.modelsPerBrandPerRound,
    maxModelsPerBrand: policy.maxModelsPerBrand,
    estimatedModelCapacity,
    requestBudget,
    maximumRunMs,
    budgetRationale: research.budgetRationale,
  });
  if (audit.rankingStatus !== "verified") throw new Error("榜单审计类型错误");
  const planningBlockers = audit.executionBrands.length === 0
    ? ["当前榜单没有符合已确认评分阈值的可执行品牌"]
    : [];
  const sources = planningBlockers.length === 0
    ? [createZolSource(task, audit, observedAt)]
    : [];
  return crawlPlanContentSchema.parse({
    taskId: task.id,
    taskRevision: task.revision,
    summary: `ZOL ${task.content.category.label}榜单品牌计划：按综合评分筛选 ${selectedRows.length} 个，当前执行品牌 ${audit.executionBrands.length} 个。`,
    excludedContent: task.content.excludedContent,
    researchAudit: audit,
    executionChecklistVersion: 5,
    sources,
    planningBlockers,
  });
}

function createZolSource(
  task: CaptureTask,
  audit: Extract<z.infer<typeof brandRankingPlanningAuditSchema>, { rankingStatus: "verified" }>,
  observedAt: string,
) {
  const brandUrls = audit.executionBrands.map((brand) => brand.catalogUrl);
  const sourceCandidateIds = task.content.sourceCandidates.filter((candidate) => {
    try {
      const url = new URL(candidate.entryUrl);
      return url.href === audit.rankingUrl
        || (url.origin === "https://detail.zol.com.cn"
          && url.pathname.startsWith(`/${audit.categorySlug}/`));
    } catch { return false; }
  }).map((candidate) => candidate.id);
  const taskTopics = [...new Set([...task.content.generalTopics, ...task.content.categoryTopics])].slice(0, 100);
  const sourceKey = `zol.${audit.categorySlug}.ranked-brands`;
  return {
    key: sourceKey,
    name: `ZOL ${task.content.category.label}榜单品牌参数与图集`,
    publisher: "ZOL 中关村在线",
    sourceKind: "other" as const,
    sourceCandidateIds,
    role: "榜单入选品牌的型号参数、产品图集与来源原图",
    entryUrls: brandUrls,
    provider: { key: "zol.catalog-gallery", version: zolProviderVersion, configuration: [
      { key: "mode", value: "zol_catalog_batch" },
      { key: "category_slug", value: audit.categorySlug },
      { key: "brand_catalog_urls", value: brandUrls },
      { key: "brand_batch_size", value: audit.brandBatchSize },
      { key: "model_batch_size", value: audit.modelsPerBrandPerRound },
      { key: "target_models_per_brand", value: audit.maxModelsPerBrand },
      { key: "maximum_catalog_pages", value: 30 },
      { key: "maximum_html_bytes", value: 25_000_000 },
      { key: "maximum_image_bytes", value: 10_000_000 },
    ] },
    accessPolicy: { kind: "paced_http" as const, version: "zol-catalog-gallery-v2",
      maxRequestsPerMinute: 12, minimumIntervalMs: 5_000, maximumRunMs: audit.maximumRunMs,
      assetPolicy: { maxRequestsPerMinute: 30, minimumIntervalMs: 2_000,
        concurrency: 2, queueCapacity: 100 } },
    stopPolicy: { requestBudget: audit.requestBudget, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true as const },
    rawOutputPolicy: { formats: ["html", "text", "image"] as Array<"html" | "text" | "image">, retainAssets: true },
    observationLevel: "search_discovered" as const,
    accessState: "public" as const,
    observedAt,
    targets: [{
      key: `${sourceKey}.models`,
      name: `${audit.executionBrands.length} 个榜单品牌各最多 ${audit.maxModelsPerBrand} 个型号`,
      taskTopics,
      captureUnit: "一个 ZOL 型号的参数页、图集页及图集全部不同商品图片",
      rawFormats: ["HTML", "IMAGE", "TEXT"],
      quantity: { mode: "target_count" as const, targetCount: audit.estimatedModelCapacity, unit: "型号",
        denominator: `${audit.executionBrands.length} 个榜单入选品牌 × 每品牌最多 ${audit.maxModelsPerBrand} 个不同 ZOL 产品 ID`,
        rationale: "执行品牌由已确认榜单规则确定；品牌目录不足上限时按来源穷尽记录" },
      uniqueKey: "品牌 key + ZOL 产品 ID；图片使用来源 URL 与内容哈希去重",
      traversal: `按榜单顺序每 ${audit.brandBatchSize} 个品牌一组 → 每品牌每轮 ${audit.modelsPerBrandPerRound} 个型号 → 达到每品牌 ${audit.maxModelsPerBrand} 个或目录穷尽 → 自动进入下一组`,
      stopCondition: "遇到 robots、401/403/429、登录、验证码、风控、计划外 origin、结构异常或预算耗尽时停止并保留恢复事实",
      providerConfiguration: [{ key: "route", value: "zol_catalog_batch" }],
    }],
    executionBlockers: [],
  };
}
