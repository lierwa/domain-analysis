import { createHash } from "node:crypto";

import {
  crawlPlanningRuntimeOutputSchema,
  sourceKinds,
  type CaptureTask,
  type CrawlPlan,
  type CrawlPlanSource,
  type CrawlPlanningRuntimeOutput,
} from "@domain-analysis/shared";
import { z } from "zod";

import { isExcludedPlanningUrl } from "./crawlPlanningResearchAudit";
import { isDirectDocumentEntry } from "./crawlPlanningDocumentPolicy";
import {
  projectLandscapePasses,
  type BrandLandscapeStage,
} from "./crawlPlanningBrandDiscovery";

const boundedText = z.string().trim().min(1).max(2_000);
const urlSchema = z.string().url().max(2_048);
const urlListSchema = z.array(urlSchema).min(1).max(30);
const rawFormatSchema = z.enum(["html", "source_json", "document", "image", "text"]);

const evidencePassFields = {
  query: boundedText, evidenceUrls: urlListSchema, finding: boundedText,
};

const brandEvidencePassSchema = z.object(evidencePassFields).strict();

const knowledgeResearchPassSchema = z.object({
  area: z.literal("standards_and_principles"), ...evidencePassFields,
}).strict();

const stageTargetSchema = z.object({
  name: z.string().trim().min(1).max(300), url: urlSchema,
  taskTopics: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  captureUnit: z.string().trim().min(1).max(500),
  rawFormats: z.array(rawFormatSchema).min(1).max(5),
  denominator: z.string().trim().min(1).max(1_000), rationale: boundedText,
}).strict();

const stageSourceSchema = z.object({
  name: z.string().trim().min(1).max(500), publisher: z.string().trim().min(1).max(500),
  sourceKind: z.enum(sourceKinds), role: z.string().trim().min(1).max(1_000),
  targets: z.array(stageTargetSchema).min(1).max(20),
}).strict();

const additionalBrandSchema = z.object({
  name: z.string().trim().min(1).max(300),
  aliases: z.array(z.string().trim().min(1).max(300)).max(30),
  evidenceUrls: urlListSchema,
  query: boundedText, finding: boundedText,
}).strict();

const brandMappingStageBaseSchema = z.object({
  assistantText: z.string().trim().min(1).max(20_000),
  brands: z.array(z.discriminatedUnion("status", [
    z.object({
      name: z.string().trim().min(1).max(300), status: z.literal("planned"), note: boundedText,
      officialSourceUrls: z.array(urlSchema).min(1).max(30),
      officialMappingPasses: z.array(brandEvidencePassSchema).min(1).max(10),
      parameterAndManualPasses: z.array(brandEvidencePassSchema).min(1).max(10),
    }).strict(),
    z.object({
      name: z.string().trim().min(1).max(300), status: z.literal("unresolved"), note: boundedText,
      officialSourceUrls: z.array(urlSchema).length(0),
      officialMappingPasses: z.array(brandEvidencePassSchema).min(2).max(10),
      parameterAndManualPasses: z.array(brandEvidencePassSchema).max(10),
    }).strict(),
  ])).min(1).max(20),
  sources: z.array(stageSourceSchema.extend({ sourceKind: z.literal("brand_official") }).strict()).max(60),
  additionalBrands: z.array(additionalBrandSchema).max(30),
}).strict();
export const brandMappingStageSchema = brandMappingStageBaseSchema.superRefine(addBrandMappingIssues);

const knowledgeSourcesStageBaseSchema = z.object({
  assistantText: z.string().trim().min(1).max(20_000),
  passes: z.array(knowledgeResearchPassSchema).min(1).max(40),
  sources: z.array(stageSourceSchema).min(2).max(60),
}).strict();
export const knowledgeSourcesStageSchema = knowledgeSourcesStageBaseSchema.superRefine(addStageSourceIssues);

const marketCatalogStageBaseSchema = z.object({
  assistantText: z.string().trim().min(1).max(20_000),
  sources: z.array(stageSourceSchema.extend({
    sourceKind: z.enum(["other", "retailer"]),
    targets: z.array(stageTargetSchema).length(1),
  }).strict()).min(1).max(10),
}).strict();
export const marketCatalogStageSchema = marketCatalogStageBaseSchema.superRefine(addStageSourceIssues);

export type BrandMappingStage = z.infer<typeof brandMappingStageSchema>;
export type KnowledgeSourcesStage = z.infer<typeof knowledgeSourcesStageSchema>;
export type MarketCatalogStage = z.infer<typeof marketCatalogStageSchema>;
type StageSource = z.infer<typeof stageSourceSchema>;
type StageTarget = z.infer<typeof stageTargetSchema>;
type SourceCandidate = CaptureTask["content"]["sourceCandidates"][number];

export function brandStageCandidates(
  task: CaptureTask,
  brands: BrandLandscapeStage["brands"],
) {
  const identities = new Set(brands.flatMap((brand) => [brand.name, ...brand.aliases])
    .map(candidateIdentity).filter((value) => value.length >= 2));
  return task.content.sourceCandidates.filter((candidate) => {
    if (candidate.sourceKind !== "brand_official" || isExcludedPlanningUrl(candidate.entryUrl)) return false;
    const values = [candidate.publisher, candidate.name].map(candidateIdentity);
    return [...identities].some((identity) => values.some((value) =>
      value === identity || value.includes(identity) || identity.includes(value)));
  });
}

export function knowledgeStageCandidates(task: CaptureTask) {
  return task.content.sourceCandidates.filter((candidate) =>
    candidate.sourceKind !== "brand_official" && !isExcludedPlanningUrl(candidate.entryUrl));
}

export function requireBrandBatch(stage: BrandMappingStage, requestedBrands: BrandLandscapeStage["brands"]) {
  const expected = new Set(requestedBrands.map((brand) => normalized(brand.name)));
  const actual = new Set(stage.brands.map((brand) => normalized(brand.name)));
  if (stage.brands.length !== expected.size || expected.size !== actual.size
    || [...expected].some((name) => !actual.has(name))) {
    throw new Error("品牌批次结果必须逐项返回本批次全部品牌，且不能混入其他既有品牌");
  }
}

export function requireStageSources(stage: { sources: StageSource[] }, task: CaptureTask) {
  const topics = new Set([...task.content.generalTopics, ...task.content.categoryTopics]);
  const targetUrls = new Set<string>();
  for (const source of stage.sources) {
    for (const target of source.targets) {
      if (isExcludedPlanningUrl(target.url)) throw new Error(`当前规划禁止京东 URL：${target.url}`);
      if (targetUrls.has(target.url)) throw new Error(`阶段来源重复使用同一精确 URL：${target.url}`);
      targetUrls.add(target.url);
      const unknown = target.taskTopics.find((topic) => !topics.has(topic));
      if (unknown) throw new Error(`来源 ${source.name} 引用了任务中不存在的内容方向：${unknown}`);
    }
  }
}

export function requireStageCandidateSources(
  stage: { sources: StageSource[] },
  candidates: SourceCandidate[],
) {
  const missing = candidates.filter((candidate) => !stage.sources.some((source) =>
    source.sourceKind === candidate.sourceKind
      && source.targets.some((target) => target.url === candidate.entryUrl)));
  if (missing.length > 0) {
    throw new Error(`当前任务已确认的来源候选未在本阶段形成实际抓取项：${missing.map((item) => item.name).join("、")}`);
  }
}

export function requireKnowledgeSources(stage: KnowledgeSourcesStage) {
  if (!stage.sources.some((source) => source.sourceKind === "regulator" || source.sourceKind === "standards_body")) {
    throw new Error("标准与原理阶段缺少标准或监管来源");
  }
  if (!stage.sources.some((source) => source.sourceKind === "technical_publisher"
    || source.sourceKind === "industry_organization")) {
    throw new Error("标准与原理阶段缺少权威技术原理来源");
  }
}

export function requireMarketCatalogSources(stage: MarketCatalogStage, landscape: BrandLandscapeStage) {
  const catalogEvidence = new Set(landscape.passes
    .filter((pass) => pass.lens === "authoritative_directory" || pass.lens === "broad_market_catalog")
    .flatMap((pass) => pass.evidenceUrls));
  const missing = stage.sources.flatMap((source) => source.targets)
    .filter((target) => !catalogEvidence.has(target.url));
  if (missing.length > 0) {
    throw new Error(`市场目录必须来自本轮品牌发现证据：${missing.map((target) => target.url).join("、")}`);
  }
}

function addBrandMappingIssues(
  stage: z.infer<typeof brandMappingStageBaseSchema>,
  context: z.RefinementCtx,
) {
  addStageSourceIssues(stage, context);
  const sourceUrls = new Set(stage.sources.flatMap((source) => source.targets.map((target) => target.url)));
  const ownedUrls = new Set(stage.brands.filter((brand) => brand.status === "planned")
    .flatMap((brand) => brand.officialSourceUrls));
  for (const [index, brand] of stage.brands.entries()) {
    if (brand.status !== "planned") continue;
    for (const url of brand.officialSourceUrls) {
      if (!sourceUrls.has(url)) context.addIssue({ code: "custom", path: ["brands", index, "officialSourceUrls"],
        message: `品牌 ${brand.name} 没有引用本批次可组装的官网 URL：${url}` });
    }
  }
  for (const url of sourceUrls) {
    if (!ownedUrls.has(url)) context.addIssue({ code: "custom", path: ["sources"],
      message: `官网来源 URL 没有归属到本批次已规划品牌：${url}` });
  }
  const batchNames = new Set(stage.brands.map((brand) => normalized(brand.name)));
  const additionalNames = stage.additionalBrands.map((brand) => normalized(brand.name));
  if (new Set(additionalNames).size !== additionalNames.length
    || additionalNames.some((name) => batchNames.has(name))) {
    context.addIssue({ code: "custom", path: ["additionalBrands"],
      message: "新增品牌必须去重，且不能重复本批次品牌" });
  }
}

function addStageSourceIssues(
  stage: { sources: StageSource[] },
  context: z.RefinementCtx,
) {
  const seen = new Set<string>();
  for (const [sourceIndex, source] of stage.sources.entries()) {
    for (const [targetIndex, target] of source.targets.entries()) {
      const path = ["sources", sourceIndex, "targets", targetIndex, "url"];
      if (isExcludedPlanningUrl(target.url)) {
        context.addIssue({ code: "custom", path, message: `当前规划禁止京东 URL：${target.url}` });
      }
      if (seen.has(target.url)) {
        context.addIssue({ code: "custom", path, message: `阶段来源重复使用同一精确 URL：${target.url}` });
      }
      seen.add(target.url);
    }
  }
}

export function assembleStagedCrawlPlan(input: {
  task: CaptureTask;
  previousPlans: CrawlPlan[];
  landscape: BrandLandscapeStage;
  market: MarketCatalogStage;
  mappings: BrandMappingStage[];
  knowledge: KnowledgeSourcesStage;
}): CrawlPlanningRuntimeOutput {
  const sources: CrawlPlanSource[] = [];
  for (const source of input.market.sources) mergeSource(sources, source, input.task, true);
  for (const source of input.mappings.flatMap((stage) => stage.sources)) {
    mergeSource(sources, source, input.task, true);
  }
  for (const source of input.knowledge.sources) mergeSource(sources, source, input.task, false);
  requireCandidateContinuity(sources, input.task);
  const mappingByBrand = new Map(input.mappings.flatMap((stage) => stage.brands)
    .map((brand) => [normalized(brand.name), brand]));
  const brands = input.landscape.brands.map((brand) => {
    const mapping = mappingByBrand.get(normalized(brand.name));
    if (!mapping) throw new Error(`品牌没有完成批次官网核对：${brand.name}`);
    const officialSourceKeys = mapping.officialSourceUrls.map((url) => sourceKeyForUrl(sources, url, "brand_official"));
    return { ...brand, officialSourceKeys: [...new Set(officialSourceKeys)],
      status: mapping.status, note: mapping.note };
  });
  requireOfficialSourceOwnership(sources, brands);
  const topicCoverage = buildTopicCoverage(sources, input.task);
  const unresolvedCount = brands.filter((brand) => brand.status === "unresolved").length;
  const output = {
    assistantText: `已冻结 ${brands.length} 个品牌的调查分母，按批次完成官网核对；${unresolvedCount} 个品牌仍待解决。`,
    planCandidate: {
      executionChecklistVersion: 4 as const,
      summary: `${input.task.content.category.label}品牌地图、官网参数、标准与技术原理抓取计划`,
      excludedContent: [...new Set([...input.task.content.excludedContent, "当前正式计划排除京东来源"])],
      sources,
      researchAudit: {
        strategyVersion: 3 as const, marketScope: input.landscape.marketScope,
        passes: [...projectLandscapePasses(input.landscape.passes, input.landscape.brands),
          ...input.mappings.flatMap((stage) => stage.brands.flatMap(projectBrandPasses)),
          ...input.knowledge.passes],
        denominator: input.landscape.denominator, brands, topicCoverage,
        completeness: unresolvedCount > 0 ? "partial" as const : "complete" as const,
        stopReason: `品牌分母 ${brands.length} 个；分批官网核对完成，${unresolvedCount} 个 unresolved；品牌发现以两个不同查询连续零新增停止。`,
      },
    },
  };
  return crawlPlanningRuntimeOutputSchema.parse(output);
}

function projectBrandPasses(brand: BrandMappingStage["brands"][number]) {
  const project = (area: "official_source_mapping" | "parameters_and_manuals") =>
    (pass: z.infer<typeof brandEvidencePassSchema>) => ({ area, ...pass });
  return [...brand.officialMappingPasses.map(project("official_source_mapping")),
    ...brand.parameterAndManualPasses.map(project("parameters_and_manuals"))];
}

function mergeSource(
  sources: CrawlPlanSource[],
  stage: StageSource,
  task: CaptureTask,
  siteDiscovery: boolean,
) {
  const targetUrls = new Set(stage.targets.map((target) => target.url));
  let source = sources.find((item) => item.sourceKind === stage.sourceKind
    && item.entryUrls.some((url) => targetUrls.has(url)));
  if (!source) {
    source = buildSource(stage, task, siteDiscovery);
    sources.push(source);
    return;
  }
  for (const target of stage.targets) mergeTarget(source, target);
  source.sourceCandidateIds = candidateIdsFor(source, task);
  normalizeDirectDocumentCandidates(source, task);
  normalizeSourcePolicy(source, task, siteDiscovery);
}

function buildSource(stage: StageSource, task: CaptureTask, siteDiscovery: boolean): CrawlPlanSource {
  const source: CrawlPlanSource = {
    key: sourceKey(stage.sourceKind, stage.targets[0]!.url), name: stage.name, publisher: stage.publisher,
    sourceKind: stage.sourceKind, role: stage.role, entryUrls: [], sourceCandidateIds: [],
    provider: { key: "public.web-resource", version: "2.0.0", configuration: [
      { key: "mode", value: "planned_routes" }, { key: "maximum_bytes", value: 25_000_000 },
      { key: "maximum_pages_per_target", value: 40 },
    ] },
    accessPolicy: { kind: "paced_http", version: "public-web-resource-low-frequency-v3",
      maxRequestsPerMinute: 6, minimumIntervalMs: 10_000, maximumRunMs: 1_800_000 },
    stopPolicy: { requestBudget: 1, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
    rawOutputPolicy: { formats: ["html"], retainAssets: false },
    observationLevel: "search_discovered", accessState: "unknown", observedAt: task.updatedAt,
    targets: [], executionBlockers: [],
  };
  for (const target of stage.targets) mergeTarget(source, target);
  source.sourceCandidateIds = candidateIdsFor(source, task);
  normalizeDirectDocumentCandidates(source, task);
  normalizeSourcePolicy(source, task, siteDiscovery);
  return source;
}

function mergeTarget(source: CrawlPlanSource, stage: StageTarget) {
  const existing = source.targets.find((target) => target.providerConfiguration.some(
    (item) => item.key === "url" && item.value === stage.url,
  ));
  if (existing) {
    existing.taskTopics = [...new Set([...existing.taskTopics, ...stage.taskTopics])];
    existing.rawFormats = [...new Set([...existing.rawFormats, ...stage.rawFormats])];
    return;
  }
  source.entryUrls.push(stage.url);
  source.targets.push({
    key: targetKey(stage.url), name: stage.name, taskTopics: stage.taskTopics,
    providerConfiguration: [{ key: "route", value: "exact" }, { key: "url", value: stage.url }],
    captureUnit: stage.captureUnit,
    rawFormats: stage.rawFormats,
    quantity: { mode: "target_count", targetCount: 1, unit: "份",
      denominator: stage.denominator, rationale: stage.rationale },
    uniqueKey: "规范化 URL", traversal: "只请求计划冻结的精确公开 URL",
    stopCondition: "保存一份源站响应，或在首次访问限制时停止",
  });
}

function normalizeSourcePolicy(source: CrawlPlanSource, task: CaptureTask, siteDiscovery: boolean) {
  source.entryUrls = [...new Set(source.entryUrls)];
  source.provider = { key: "public.web-resource", version: "2.0.0", configuration: [
    { key: "mode", value: "planned_routes" }, { key: "maximum_bytes", value: 25_000_000 },
    { key: "maximum_pages_per_target", value: 40 },
  ] };
  source.accessPolicy = { kind: "paced_http", version: "public-web-resource-low-frequency-v3",
    maxRequestsPerMinute: 6, minimumIntervalMs: 10_000, maximumRunMs: 1_800_000 };
  const siteTarget = siteDiscovery
    ? source.targets.find((target) => !target.rawFormats.includes("document") && !target.rawFormats.includes("image"))
    : undefined;
  for (const target of source.targets) {
    const url = String(target.providerConfiguration.find((item) => item.key === "url")?.value ?? "");
    if (target === siteTarget) {
      target.providerConfiguration = [
        { key: "route", value: "site" }, { key: "url", value: url },
        { key: "required_terms", value: contentSignals(source, target, task) },
        { key: "maximum_depth", value: 2 }, { key: "minimum_accepted_pages", value: 2 },
      ];
      target.quantity = { mode: "all_available", unit: "个通过内容验收的原始页面或公开 JSON",
        denominator: `${target.quantity.denominator}；在已确认同源边界内最多 40 页`,
        rationale: `${target.quantity.rationale}；目录页必须发现并保存至少 2 个内容相关页面` };
      target.traversal = "先读 robots 与 sitemap，再用 Crawlee 持久队列遍历计划入口的同源链接；只保留计划信号命中的原始内容";
      target.stopCondition = "队列耗尽、40 页、深度 2、30 分钟、请求预算或首次访问限制任一先到；至少 2 页通过内容验收";
    } else {
      target.providerConfiguration = [{ key: "route", value: "exact" }, { key: "url", value: url }];
    }
  }
  const exactUrls = source.targets.flatMap((target) => target.providerConfiguration
    .filter((item) => item.key === "url" && typeof item.value === "string").map((item) => String(item.value)));
  const origins = new Set(exactUrls.map((url) => new URL(url).origin));
  // WHY：Crawlee 只允许每个 robots/target 一个同源规范化跳转；计划必须把最坏请求数显式冻结，
  // 否则真实 redirect attempt 会在最后一个 target 前耗尽预算。
  const siteTargetCount = siteTarget ? 1 : 0;
  source.stopPolicy.requestBudget = Math.max(source.stopPolicy.requestBudget,
    (source.targets.length + origins.size + siteTargetCount * 44) * 2);
  source.stopPolicy.noNewUniqueKeysLimit = siteTarget ? 20 : 1;
  const formats = new Set(source.targets.flatMap((target) => target.rawFormats));
  if (siteTarget) {
    formats.add("text");
    formats.add("source_json");
  }
  source.rawOutputPolicy.formats = [...formats] as CrawlPlanSource["rawOutputPolicy"]["formats"];
  source.rawOutputPolicy.retainAssets = formats.has("document") || formats.has("image");
  source.executionBlockers = [];
}

function contentSignals(source: CrawlPlanSource, target: CrawlPlanSource["targets"][number], task: CaptureTask) {
  const values = [task.content.category.label, task.content.category.code, source.publisher,
    ...target.taskTopics, target.name, target.captureUnit]
    .flatMap((value) => String(value).split(/[\s/|,，、:：()（）]+/u))
    .map((value) => value.trim()).filter((value) => value.length >= 2 && value.length <= 80);
  return [...new Set(values)].slice(0, 30);
}

function candidateIdsFor(source: CrawlPlanSource, task: CaptureTask) {
  const existing = new Set(source.sourceCandidateIds);
  for (const candidate of task.content.sourceCandidates) {
    if (!isExcludedPlanningUrl(candidate.entryUrl) && candidate.sourceKind === source.sourceKind
      && source.entryUrls.includes(candidate.entryUrl)) existing.add(candidate.id);
  }
  return [...existing];
}

function normalizeDirectDocumentCandidates(source: CrawlPlanSource, task: CaptureTask) {
  for (const candidate of task.content.sourceCandidates) {
    if (candidate.sourceKind !== source.sourceKind || !isDirectDocumentEntry(candidate.entryUrl)) continue;
    const target = source.targets.find((item) => item.providerConfiguration.some(
      (configuration) => configuration.key === "url" && configuration.value === candidate.entryUrl,
    ));
    if (!target) continue;
    // WHY：精确文档 URL 是已确认任务事实；在 Workbench 组装 seam 收窄，避免模型把 PDF 当 HTML。
    target.rawFormats = target.rawFormats.filter((format) => format !== "html");
    if (!target.rawFormats.includes("document")) target.rawFormats.push("document");
  }
}

function requireCandidateContinuity(sources: CrawlPlanSource[], task: CaptureTask) {
  const used = new Set(sources.flatMap((source) => source.sourceCandidateIds));
  const missing = task.content.sourceCandidates.filter((candidate) => !isExcludedPlanningUrl(candidate.entryUrl)
    && !used.has(candidate.id));
  if (missing.length > 0) throw new Error(`分阶段规划遗漏采访来源：${missing.map((item) => item.name).join("、")}`);
}

function sourceKeyForUrl(sources: CrawlPlanSource[], url: string, kind: CrawlPlanSource["sourceKind"]) {
  const source = sources.find((item) => item.sourceKind === kind && item.entryUrls.includes(url));
  if (!source) throw new Error(`品牌引用的官网 URL 没有组装为来源：${url}`);
  return source.key;
}

function requireOfficialSourceOwnership(
  sources: CrawlPlanSource[],
  brands: Array<{ name: string; status: "planned" | "unresolved"; officialSourceKeys: string[] }>,
) {
  const owned = new Set(brands.filter((brand) => brand.status === "planned")
    .flatMap((brand) => brand.officialSourceKeys));
  const orphan = sources.find((source) => source.sourceKind === "brand_official" && !owned.has(source.key));
  if (orphan) throw new Error(`官网来源没有归属到任何已规划品牌：${orphan.name}`);
}

function buildTopicCoverage(sources: CrawlPlanSource[], task: CaptureTask) {
  return [...task.content.generalTopics, ...task.content.categoryTopics].map((topic) => {
    const sourceKeys = sources.filter((source) => source.targets.some((target) => target.taskTopics.includes(topic)))
      .map((source) => source.key);
    if (sourceKeys.length === 0) throw new Error(`分阶段规划没有来源覆盖任务内容：${topic}`);
    return { topic, sourceKeys, rationale: "由实际计划 target 的 taskTopics 确定性对账" };
  });
}

function sourceKey(kind: string, url: string) {
  return `${kind.replaceAll("_", "-")}-${digest(url)}`;
}

function targetKey(url: string) {
  return `target-${digest(url)}`;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function candidateIdentity(value: string) {
  return normalized(value).replace(/[\s\p{P}\p{S}]+/gu, "");
}
