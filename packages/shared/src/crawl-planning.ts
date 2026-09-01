import { z } from "zod";

import { sourceAccessStates, sourceKinds } from "./capture-task";
import { interviewMessageTimelinePartSchema, interviewTurnActivitySchema } from "./category-interview";
import {
  completedSourceReferenceSchema,
  publicResearchFacets,
  publicResearchSourceKinds,
  sourceCoverageAssessmentSchema,
} from "./source-coverage";

const idSchema = z.string().min(1).max(240);
const keySchema = z.string().regex(/^[a-z][a-z0-9_.-]+$/);
const isoDateSchema = z.string().datetime({ offset: true });
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const boundedText = z.string().trim().min(1).max(2_000);
const quantityBase = {
  unit: z.string().trim().min(1).max(120),
  denominator: z.string().trim().min(1).max(1_000),
  rationale: z.string().trim().min(1).max(2_000),
};

export const captureQuantitySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all_available"), ...quantityBase }).strict(),
  z.object({ mode: z.literal("target_count"), targetCount: z.number().int().positive(), ...quantityBase }).strict(),
  z.object({ mode: z.literal("sample"), targetCount: z.number().int().positive(), ...quantityBase }).strict(),
]);

const providerConfigurationSchema = z.array(z.object({
  key: keySchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(boundedText).max(500)]),
}).strict()).max(50);

const assetAccessPolicySchema = z.object({
  maxRequestsPerMinute: z.number().int().positive(),
  minimumIntervalMs: z.number().int().positive(),
  concurrency: z.number().int().positive().max(32),
  queueCapacity: z.number().int().positive().max(10_000),
}).strict().refine((policy) => policy.queueCapacity >= policy.concurrency, {
  message: "附件队列容量不能小于并发数", path: ["queueCapacity"],
});

export const crawlPlanTargetSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(300),
  taskTopics: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  captureUnit: z.string().trim().min(1).max(500),
  rawFormats: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  quantity: captureQuantitySchema,
  uniqueKey: z.string().trim().min(1).max(1_000),
  traversal: z.string().trim().min(1).max(2_000),
  stopCondition: z.string().trim().min(1).max(2_000),
  providerConfiguration: providerConfigurationSchema.default([]),
}).strict();

export const crawlPlanSourceSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(500),
  publisher: z.string().trim().min(1).max(500),
  sourceKind: z.enum(sourceKinds),
  sourceCandidateIds: z.array(idSchema).max(100).default([]),
  role: z.string().trim().min(1).max(1_000),
  entryUrls: z.array(z.string().url().max(2_048)).min(1).max(500),
  provider: z.object({
    key: keySchema,
    version: idSchema,
    configuration: providerConfigurationSchema,
  }).strict(),
  accessPolicy: z.object({
    kind: z.literal("paced_http"),
    version: idSchema,
    maxRequestsPerMinute: z.number().int().positive(),
    minimumIntervalMs: z.number().int().positive(),
    maximumRunMs: z.number().int().positive(),
    assetPolicy: assetAccessPolicySchema.optional(),
  }).strict(),
  stopPolicy: z.object({
    requestBudget: z.number().int().positive(),
    noNewUniqueKeysLimit: z.number().int().positive(),
    stopOnAccessRestriction: z.literal(true),
  }).strict(),
  rawOutputPolicy: z.object({
    formats: z.array(z.enum(["html", "source_json", "document", "image", "text"])).min(1),
    retainAssets: z.boolean(),
  }).strict(),
  observationLevel: z.literal("search_discovered"),
  accessState: z.enum(sourceAccessStates),
  observedAt: z.string().min(1).max(100),
  targets: z.array(crawlPlanTargetSchema).min(1).max(100),
  executionBlockers: z.array(boundedText).max(100),
}).strict();

// WHY：这份结构只负责读取历史计划并给非活动来源底座提供稳定类型；它不定义下一版计划生成 contract。
export const crawlPlanContentSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  excludedContent: z.array(boundedText).max(100),
  // WHY：规划必须能够持久化“榜单不可验证”的受阻草稿；空来源只允许与明确的计划级阻塞同时存在。
  sources: z.array(crawlPlanSourceSchema).max(100),
  planningBlockers: z.array(boundedText).max(100).default([]),
  researchAudit: z.unknown().optional(),
  executionChecklistVersion: z.number().int().positive().optional(),
  taskId: idSchema,
  taskRevision: z.number().int().positive(),
}).strict().superRefine((content, context) => {
  if (content.sources.length === 0 && content.planningBlockers.length === 0) {
    context.addIssue({ code: "custom", path: ["sources"], message: "没有执行来源的计划必须记录计划级阻塞" });
  }
});

export const crawlPlanSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  taskRevision: z.number().int().positive(),
  // WHY：确定性来源计划可以由负责人在 Workbench 直接确认，不需要伪造一次 LLM planning run。
  planningRunId: idSchema.optional(),
  version: z.number().int().positive(),
  status: z.enum(["draft", "confirmed", "superseded"]),
  contentHash: hashSchema,
  content: crawlPlanContentSchema,
  createdAt: isoDateSchema,
  confirmedAt: isoDateSchema.optional(),
}).strict();

const brandCatalogEntrySchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(300),
  catalogUrl: z.string().url().max(2_048),
}).strict();

const brandRankingFields = {
  kind: z.literal("brand_ranking_selection"),
  categoryUrl: z.string().url().max(2_048),
  categorySlug: keySchema,
  evidenceUrls: z.array(z.string().url().max(2_048)).min(1).max(100),
  observedAt: isoDateSchema,
  selectionPolicy: z.object({
    scoreField: z.literal("comprehensive_score"),
    minimumScoreExclusive: z.number().finite(),
    maxBrands: z.number().int().positive().max(500),
  }).strict(),
};

const rankedBrandRowSchema = z.object({
  rank: z.number().int().positive(),
  name: z.string().trim().min(1).max(300),
  comprehensiveScore: z.number().finite(),
  key: keySchema.optional(),
  catalogUrl: z.string().url().max(2_048).optional(),
  blockageReason: boundedText.optional(),
}).strict().superRefine((row, context) => {
  const mapped = Boolean(row.key && row.catalogUrl);
  if (!mapped && !row.blockageReason) {
    context.addIssue({ code: "custom", path: ["blockageReason"], message: "未映射的榜单品牌必须记录原因" });
  }
  if ((row.key && !row.catalogUrl) || (!row.key && row.catalogUrl)) {
    context.addIssue({ code: "custom", path: ["catalogUrl"], message: "品牌 key 与目录 URL 必须同时存在" });
  }
});

const verifiedBrandRankingAuditSchema = z.object({
  ...brandRankingFields,
  rankingStatus: z.literal("verified"),
  rankingUrl: z.string().url().max(2_048),
  rankingRows: z.array(rankedBrandRowSchema).min(1).max(500),
  executionBrands: z.array(brandCatalogEntrySchema).max(500),
  blockedSelectedBrands: z.array(z.object({
    rank: z.number().int().positive(),
    name: z.string().trim().min(1).max(300),
    reason: boundedText,
  }).strict()).max(500),
  brandBatchSize: z.number().int().positive().max(100),
  modelsPerBrandPerRound: z.number().int().positive().max(100),
  maxModelsPerBrand: z.number().int().positive().max(100),
  estimatedModelCapacity: z.number().int().nonnegative(),
  requestBudget: z.number().int().positive(),
  maximumRunMs: z.number().int().positive(),
  budgetRationale: boundedText,
}).strict().superRefine((audit, context) => {
  const ranks = audit.rankingRows.map((row) => row.rank);
  if (new Set(ranks).size !== ranks.length
    || ranks.some((rank, index) => index > 0 && rank <= ranks[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["rankingRows"], message: "榜单名次必须唯一并按升序保存" });
  }
  const selectedRows = audit.rankingRows
    .filter((row) => row.comprehensiveScore > audit.selectionPolicy.minimumScoreExclusive)
    .slice(0, audit.selectionPolicy.maxBrands);
  const expectedExecution = selectedRows.filter((row) => row.key && row.catalogUrl)
    .map((row) => ({ key: row.key!, name: row.name, catalogUrl: row.catalogUrl! }));
  if (JSON.stringify(audit.executionBrands) !== JSON.stringify(expectedExecution)) {
    context.addIssue({ code: "custom", path: ["executionBrands"], message: "执行品牌必须由榜单、评分阈值和品牌上限确定性推导" });
  }
  const expectedBlocked = selectedRows.filter((row) => !row.key || !row.catalogUrl)
    .map((row) => ({ rank: row.rank, name: row.name, reason: row.blockageReason! }));
  if (JSON.stringify(audit.blockedSelectedBrands) !== JSON.stringify(expectedBlocked)) {
    context.addIssue({ code: "custom", path: ["blockedSelectedBrands"], message: "受阻执行品牌必须与入选榜单行一致" });
  }
  if (audit.estimatedModelCapacity !== audit.executionBrands.length * audit.maxModelsPerBrand) {
    context.addIssue({ code: "custom", path: ["estimatedModelCapacity"], message: "型号容量必须由执行品牌数和每品牌上限推导" });
  }
});

const unavailableBrandRankingAuditSchema = z.object({
  ...brandRankingFields,
  rankingStatus: z.literal("unavailable"),
  rankingEvidenceUrls: z.array(z.string().url().max(2_048)).min(1).max(100),
  rankingReason: boundedText,
}).strict();

export const brandRankingPlanningAuditSchema = z.union([
  verifiedBrandRankingAuditSchema,
  unavailableBrandRankingAuditSchema,
]);

const publicSourceResearchTopicSchema = z.object({
  key: keySchema,
  facet: z.enum(publicResearchFacets),
  label: z.string().trim().min(1).max(300),
  searchTerms: z.array(z.string().trim().min(1).max(500)).min(2).max(12),
  purpose: boundedText,
}).strict();

const publicSourceResearchItemSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(500),
  publisher: z.string().trim().min(1).max(500),
  sourceKind: z.enum(publicResearchSourceKinds),
  url: z.string().url().max(2_048),
  topics: z.array(keySchema).min(1).max(20),
  rawFormats: z.array(z.enum(["HTML", "PDF", "TEXT"])).min(1).max(3),
  reason: boundedText,
}).strict();

const publicSourceResearchBlockerSchema = z.object({
  sourceKind: z.enum(publicResearchSourceKinds),
  query: z.string().trim().min(1).max(1_000),
  reason: boundedText,
}).strict();

export const publicSourceResearchSchema = z.object({
  topics: z.array(publicSourceResearchTopicSchema).min(5).max(20),
  sources: z.array(publicSourceResearchItemSchema).max(50),
  blocked: z.array(publicSourceResearchBlockerSchema).max(50),
}).strict().superRefine((research, context) => {
  const topicKeys = research.topics.map((topic) => topic.key);
  if (new Set(topicKeys).size !== topicKeys.length) {
    context.addIssue({ code: "custom", path: ["topics"], message: "专业主题 key 必须唯一" });
  }
  const requiredFacets = publicResearchFacets.filter((facet) => facet !== "category_specific");
  for (const facet of requiredFacets) {
    if (!research.topics.some((topic) => topic.facet === facet)) {
      context.addIssue({ code: "custom", path: ["topics"], message: `专业主题缺少 ${facet}` });
    }
  }
  const sourceKeys = research.sources.map((source) => source.key);
  const sourceUrls = research.sources.map((source) => new URL(source.url).href);
  if (new Set(sourceKeys).size !== sourceKeys.length || new Set(sourceUrls).size !== sourceUrls.length) {
    context.addIssue({ code: "custom", path: ["sources"], message: "公开来源 key 与 URL 必须唯一" });
  }
  for (const [index, source] of research.sources.entries()) {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
      || url.hostname === "example.invalid" || url.hostname.endsWith("zol.com.cn")) {
      context.addIssue({ code: "custom", path: ["sources", index, "url"],
        message: "公开来源必须是非 ZOL 的公网 HTTPS 直达入口" });
    }
    if (source.topics.some((key) => !topicKeys.includes(key))) {
      context.addIssue({ code: "custom", path: ["sources", index, "topics"],
        message: "公开来源引用了未声明的专业主题" });
    }
  }
});

export const multiSourcePlanningAuditSchema = z.object({
  kind: z.literal("multi_source_planning"),
  productCatalog: z.union([
    brandRankingPlanningAuditSchema,
    completedSourceReferenceSchema.extend({
      kind: z.literal("completed_source_reference"),
      observedAt: isoDateSchema,
    }).strict(),
  ]),
  publicSourceResearch: publicSourceResearchSchema,
  // WHY：历史 v6 计划没有覆盖快照，仍需只读；只有 v7 确认门强制要求该字段。
  priorCoverage: sourceCoverageAssessmentSchema.optional(),
  observedAt: isoDateSchema,
}).strict();

export const crawlPlanningRunSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  taskRevision: z.number().int().positive(),
  instruction: z.string().trim().min(1).max(10_000).optional(),
  status: z.enum(["running", "completed", "interrupted", "failed"]),
  timelineParts: z.array(interviewMessageTimelinePartSchema).max(200),
  planId: idSchema.optional(),
  error: z.string().trim().min(1).max(2_000).optional(),
  startedAt: isoDateSchema,
  finishedAt: isoDateSchema.optional(),
}).strict().superRefine((run, context) => {
  if (run.status !== "running" && !run.finishedAt) {
    context.addIssue({ code: "custom", path: ["finishedAt"], message: "已结束规划必须记录结束时间" });
  }
  if (run.status === "completed" && !run.planId) {
    context.addIssue({ code: "custom", path: ["planId"], message: "已完成规划必须关联计划草稿" });
  }
  if (run.status === "failed" && !run.error) {
    context.addIssue({ code: "custom", path: ["error"], message: "失败规划必须记录公开错误" });
  }
});

export const crawlPlanningViewSchema = z.object({
  taskId: idSchema,
  taskRevision: z.number().int().positive(),
  runs: z.array(crawlPlanningRunSchema),
  plans: z.array(crawlPlanSchema),
}).strict();

export const crawlPlanningRunRequestSchema = z.object({
  expectedTaskRevision: z.number().int().positive(),
  instruction: z.string().trim().min(1).max(10_000).optional(),
}).strict();

export const confirmCrawlPlanSchema = z.object({
  expectedTaskRevision: z.number().int().positive(),
}).strict();

const planningEventBase = { taskId: idSchema, runId: idSchema };
export const crawlPlanningEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.started"), ...planningEventBase }).strict(),
  z.object({ type: z.literal("run.activity"), ...planningEventBase,
    activity: interviewTurnActivitySchema }).strict(),
  z.object({ type: z.literal("assistant.delta"), ...planningEventBase, delta: z.string().min(1) }).strict(),
  z.object({ type: z.literal("run.completed"), ...planningEventBase,
    run: crawlPlanningRunSchema, plan: crawlPlanSchema }).strict(),
  z.object({ type: z.literal("run.interrupted"), ...planningEventBase,
    run: crawlPlanningRunSchema }).strict(),
  z.object({ type: z.literal("run.failed"), ...planningEventBase,
    run: crawlPlanningRunSchema, error: z.string().min(1).max(2_000) }).strict(),
  z.object({ type: z.literal("stream.failed"), taskId: idSchema,
    error: z.string().min(1).max(2_000) }).strict(),
]);

export const sourceExecutionPlanRequestSchema = z.object({
  expectedTaskRevision: z.number().int().positive(),
  expectedPlanVersion: z.number().int().positive(),
}).strict();

export const sourcePreparationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), message: z.string().trim().min(1).max(1_000) }).strict(),
  z.object({
    status: z.literal("action_required"),
    action: z.enum(["login_required", "verification_required"]),
    sourceKey: keySchema,
    message: z.string().trim().min(1).max(1_000),
  }).strict(),
]);

export type CaptureQuantity = z.infer<typeof captureQuantitySchema>;
export type CrawlPlanTarget = z.infer<typeof crawlPlanTargetSchema>;
export type CrawlPlanSource = z.infer<typeof crawlPlanSourceSchema>;
export type CrawlPlanContent = z.infer<typeof crawlPlanContentSchema>;
export type CrawlPlan = z.infer<typeof crawlPlanSchema>;
export type BrandRankingPlanningAudit = z.infer<typeof brandRankingPlanningAuditSchema>;
export type PublicSourceResearch = z.infer<typeof publicSourceResearchSchema>;
export type MultiSourcePlanningAudit = z.infer<typeof multiSourcePlanningAuditSchema>;
export type CrawlPlanningRun = z.infer<typeof crawlPlanningRunSchema>;
export type CrawlPlanningView = z.infer<typeof crawlPlanningViewSchema>;
export type CrawlPlanningEvent = z.infer<typeof crawlPlanningEventSchema>;
export type SourcePreparation = z.infer<typeof sourcePreparationSchema>;
