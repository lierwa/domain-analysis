import { z } from "zod";

import { sourceAccessStates, sourceKinds } from "./capture-task";
import { interviewMessageTimelinePartSchema, interviewTurnActivitySchema } from "./category-interview";

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
  value: z.union([z.string(), z.number(), z.boolean()]),
}).strict()).max(50);

const crawlPlanProviderSchema = z.object({
  key: keySchema,
  version: idSchema,
  configuration: providerConfigurationSchema,
}).strict();

const jdCandidateProviderSchema = z.object({
  key: z.literal("jd.catalog-product"),
  version: z.literal("1.0.0"),
  configuration: z.array(z.discriminatedUnion("key", [
    z.object({ key: z.literal("mode"), value: z.literal("cdp") }).strict(),
    z.object({ key: z.literal("include_text"), value: boundedText }).strict(),
    z.object({ key: z.literal("exclude_text"), value: boundedText }).strict(),
  ])).length(3),
}).strict();

const publicCandidateProviderSchema = z.object({
  key: z.literal("public.web-resource"),
  version: z.literal("1.0.0"),
  configuration: z.array(z.discriminatedUnion("key", [
    z.object({ key: z.literal("mode"), value: z.literal("exact_https") }).strict(),
    z.object({ key: z.literal("maximum_bytes"), value: z.number().int().positive().max(25_000_000) }).strict(),
  ])).length(2),
}).strict();

const crawlPlanTargetShape = {
  key: keySchema,
  name: z.string().trim().min(1).max(300),
  taskTopics: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  captureUnit: z.string().trim().min(1).max(500),
  rawFormats: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  quantity: captureQuantitySchema,
  uniqueKey: z.string().trim().min(1).max(1_000),
  traversal: z.string().trim().min(1).max(2_000),
  stopCondition: z.string().trim().min(1).max(2_000),
};

export const crawlPlanTargetSchema = z.object({ ...crawlPlanTargetShape,
  providerConfiguration: providerConfigurationSchema.default([]),
}).strict();

const jdCandidateTargetSchema = z.object({ ...crawlPlanTargetShape,
  rawFormats: z.array(z.literal("html")).length(1),
  providerConfiguration: z.array(z.object({
    key: z.literal("operation"),
    value: z.enum(["catalog", "first_matching_product"]),
  }).strict()).length(1),
}).strict();

const publicExactTargetSchema = z.object({ ...crawlPlanTargetShape,
  providerConfiguration: z.array(z.object({
    key: z.literal("url"), value: z.string().url().max(2_048),
  }).strict()).length(1),
}).strict();

const publicLinkedTargetSchema = z.object({ ...crawlPlanTargetShape,
  providerConfiguration: z.array(z.discriminatedUnion("key", [
    z.object({ key: z.literal("from_target"), value: keySchema }).strict(),
    z.object({ key: z.literal("link_text"), value: boundedText }).strict(),
  ])).length(2),
}).strict();

const publicCandidateTargetSchema = z.union([
  publicExactTargetSchema,
  publicLinkedTargetSchema,
]);

const crawlPlanSourceShape = {
  key: keySchema,
  name: z.string().trim().min(1).max(500),
  publisher: z.string().trim().min(1).max(500),
  sourceKind: z.enum(sourceKinds),
  role: z.string().trim().min(1).max(1_000),
  entryUrls: z.array(z.string().url().max(2_048)).min(1).max(50),
  provider: crawlPlanProviderSchema,
  accessPolicy: z.object({
    kind: z.literal("paced_http"),
    version: idSchema,
    maxRequestsPerMinute: z.number().int().positive(),
    minimumIntervalMs: z.number().int().positive(),
    maximumRunMs: z.number().int().positive(),
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
  // WHY：候选时间由模型传来但不会成为事实；Workbench 在持久化前覆盖为服务端时间。
  observedAt: z.string().min(1).max(100),
  executionBlockers: z.array(boundedText).max(100),
};

export const crawlPlanSourceSchema = z.object({ ...crawlPlanSourceShape,
  sourceCandidateIds: z.array(idSchema).max(100).default([]),
  targets: z.array(crawlPlanTargetSchema).min(1).max(100),
}).strict().superRefine((source, context) => {
  addDuplicateKeyIssues(source.targets, context, ["targets"]);
});

const jdCandidateSourceSchema = z.object({ ...crawlPlanSourceShape,
  provider: jdCandidateProviderSchema,
  accessPolicy: z.object({
    kind: z.literal("paced_http"), version: z.literal("jd-low-frequency-v1"),
    maxRequestsPerMinute: z.literal(2), minimumIntervalMs: z.literal(10_000),
    maximumRunMs: z.literal(180_000),
  }).strict(),
  stopPolicy: z.object({
    requestBudget: z.literal(2), noNewUniqueKeysLimit: z.literal(1),
    stopOnAccessRestriction: z.literal(true),
  }).strict(),
  rawOutputPolicy: z.object({ formats: z.array(z.literal("html")).length(1), retainAssets: z.literal(false) }).strict(),
  sourceCandidateIds: z.array(idSchema).max(100),
  targets: z.array(jdCandidateTargetSchema).length(2),
  executionBlockers: z.array(boundedText).length(0),
}).strict().superRefine((source, context) => {
  addDuplicateKeyIssues(source.targets, context, ["targets"]);
  addExactConfigurationIssues(source.provider.configuration, ["mode", "include_text", "exclude_text"], context);
  addExactJdSourceIssues(source, context);
});

const publicCandidateSourceSchema = z.object({ ...crawlPlanSourceShape,
  provider: publicCandidateProviderSchema,
  sourceCandidateIds: z.array(idSchema).max(100),
  targets: z.array(publicCandidateTargetSchema).min(1).max(100),
  executionBlockers: z.array(boundedText).length(0),
}).strict().superRefine((source, context) => {
  addDuplicateKeyIssues(source.targets, context, ["targets"]);
  addExactConfigurationIssues(source.provider.configuration, ["mode", "maximum_bytes"], context);
  addExactPublicSourceIssues(source, context);
});

// WHY：输出 Schema 直接表达两种真实执行协议；模型不能再把 Provider 配置当自由文本猜测。
const crawlPlanCandidateSourceSchema = z.union([
  jdCandidateSourceSchema,
  publicCandidateSourceSchema,
]);

const crawlPlanBaseShape = {
  summary: z.string().trim().min(1).max(4_000),
  excludedContent: z.array(boundedText).max(100),
};

export const crawlPlanCandidateSchema = z.object({ ...crawlPlanBaseShape,
  sources: z.array(crawlPlanCandidateSourceSchema).min(1).max(100),
  executionChecklistVersion: z.literal(2),
}).strict().superRefine((candidate, context) => {
  addDuplicateKeyIssues(candidate.sources, context, ["sources"]);
});

export const crawlPlanContentSchema = z.object({ ...crawlPlanBaseShape,
  sources: z.array(crawlPlanSourceSchema).min(1).max(100),
  // WHY：旧京东纵切片仍需只读展示；只有显式 v2 才能通过当前确认和启动门。
  executionChecklistVersion: z.literal(2).optional(),
  taskId: idSchema,
  taskRevision: z.number().int().positive(),
}).strict().superRefine((candidate, context) => {
  addDuplicateKeyIssues(candidate.sources, context, ["sources"]);
});

export const crawlPlanSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  taskRevision: z.number().int().positive(),
  planningRunId: idSchema,
  version: z.number().int().positive(),
  status: z.enum(["draft", "confirmed", "superseded"]),
  contentHash: hashSchema,
  content: crawlPlanContentSchema,
  createdAt: isoDateSchema,
  confirmedAt: isoDateSchema.optional(),
}).strict().superRefine((plan, context) => {
  if (plan.content.taskId !== plan.taskId) {
    context.addIssue({ code: "custom", path: ["content", "taskId"], message: "计划内容 taskId 与 envelope 不一致" });
  }
  if (plan.content.taskRevision !== plan.taskRevision) {
    context.addIssue({ code: "custom", path: ["content", "taskRevision"], message: "计划内容 revision 与 envelope 不一致" });
  }
  if (plan.status === "confirmed" && !plan.confirmedAt) {
    context.addIssue({ code: "custom", path: ["confirmedAt"], message: "已确认计划必须记录确认时间" });
  }
  plan.content.sources.forEach((source, index) => {
    if (Number.isNaN(Date.parse(source.observedAt))) {
      context.addIssue({ code: "custom", path: ["content", "sources", index, "observedAt"], message: "持久化计划的观察时间无效" });
    }
  });
});

export const crawlPlanningRunSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  taskRevision: z.number().int().positive(),
  instruction: z.string().trim().min(1).max(10_000).optional(),
  status: z.enum(["running", "completed", "interrupted", "failed"]),
  timelineParts: z.array(interviewMessageTimelinePartSchema).max(200),
  planId: idSchema.optional(),
  error: z.string().min(1).max(2_000).optional(),
  startedAt: isoDateSchema,
  finishedAt: isoDateSchema.optional(),
}).strict().superRefine((run, context) => {
  if (run.status !== "running" && !run.finishedAt) {
    context.addIssue({ code: "custom", path: ["finishedAt"], message: "已结束运行必须记录结束时间" });
  }
  if (run.status === "completed" && !run.planId) {
    context.addIssue({ code: "custom", path: ["planId"], message: "已完成运行必须关联计划" });
  }
  if (run.status === "failed" && !run.error) {
    context.addIssue({ code: "custom", path: ["error"], message: "失败运行必须记录公开错误" });
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

export const startCrawlPlanSchema = z.object({
  expectedTaskRevision: z.number().int().positive(),
  expectedPlanVersion: z.number().int().positive(),
}).strict();

export const crawlPlanningRuntimeOutputSchema = z.object({
  assistantText: z.string().trim().min(1).max(40_000),
  planCandidate: crawlPlanCandidateSchema,
}).strict();

const eventBase = { taskId: idSchema, runId: idSchema };
export const crawlPlanningEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.started"), ...eventBase }).strict(),
  z.object({ type: z.literal("run.activity"), ...eventBase,
    activity: interviewTurnActivitySchema }).strict(),
  z.object({ type: z.literal("assistant.delta"), ...eventBase, delta: z.string().min(1) }).strict(),
  z.object({ type: z.literal("run.completed"), ...eventBase,
    run: crawlPlanningRunSchema, plan: crawlPlanSchema }).strict(),
  z.object({ type: z.literal("run.interrupted"), ...eventBase, run: crawlPlanningRunSchema }).strict(),
  z.object({ type: z.literal("run.failed"), ...eventBase,
    run: crawlPlanningRunSchema, error: z.string().min(1).max(2_000) }).strict(),
  z.object({ type: z.literal("stream.failed"), taskId: idSchema, error: z.string().min(1).max(2_000) }).strict(),
]);

export type CaptureQuantity = z.infer<typeof captureQuantitySchema>;
export type CrawlPlanTarget = z.infer<typeof crawlPlanTargetSchema>;
export type CrawlPlanSource = z.infer<typeof crawlPlanSourceSchema>;
export type CrawlPlanCandidate = z.infer<typeof crawlPlanCandidateSchema>;
export type CrawlPlanContent = z.infer<typeof crawlPlanContentSchema>;
export type CrawlPlan = z.infer<typeof crawlPlanSchema>;
export type CrawlPlanningRun = z.infer<typeof crawlPlanningRunSchema>;
export type CrawlPlanningView = z.infer<typeof crawlPlanningViewSchema>;
export type CrawlPlanningRunRequest = z.infer<typeof crawlPlanningRunRequestSchema>;
export type CrawlPlanningRuntimeOutput = z.infer<typeof crawlPlanningRuntimeOutputSchema>;
export type CrawlPlanningEvent = z.infer<typeof crawlPlanningEventSchema>;

function addExactConfigurationIssues(
  configuration: Array<{ key: string }>,
  expectedKeys: string[],
  context: z.RefinementCtx,
) {
  const actual = configuration.map((item) => item.key).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    context.addIssue({ code: "custom", path: ["provider", "configuration"],
      message: `Provider 配置必须且只能包含：${expectedKeys.join("、")}` });
  }
}

function addExactJdSourceIssues(
  source: {
    sourceKind: string;
    entryUrls: string[];
    targets: Array<{ key: string; providerConfiguration: Array<{ key: string; value: string }>; quantity: CaptureQuantity }>;
  },
  context: z.RefinementCtx,
) {
  const entry = source.entryUrls[0];
  if (source.entryUrls.length !== 1 || !entry || !isExactPublicHttps(entry, "www.jd.com")) {
    context.addIssue({ code: "custom", path: ["entryUrls"], message: "JD Provider 只接受一个 www.jd.com HTTPS 入口" });
  }
  if (source.sourceKind !== "retailer") {
    context.addIssue({ code: "custom", path: ["sourceKind"], message: "JD Provider 只承担零售来源" });
  }
  const operations = source.targets.map((target) => target.providerConfiguration[0]?.value).sort();
  if (operations.join(",") !== "catalog,first_matching_product") {
    context.addIssue({ code: "custom", path: ["targets"], message: "JD 来源必须各有一个 catalog 和 first_matching_product target" });
  }
  if (source.targets.some((target) => target.quantity.mode !== "target_count" || target.quantity.targetCount !== 1)) {
    context.addIssue({ code: "custom", path: ["targets"], message: "JD 每个 target 必须声明 target_count=1" });
  }
}

function addExactPublicSourceIssues(
  source: {
    entryUrls: string[];
    stopPolicy: { requestBudget: number };
    targets: Array<{ key: string; providerConfiguration: Array<{ key: string; value: string }>; quantity: CaptureQuantity }>;
  },
  context: z.RefinementCtx,
) {
  const targetPlans = source.targets.map((target) => Object.fromEntries(
    target.providerConfiguration.map((item) => [item.key, item.value]),
  ));
  const exactUrls = targetPlans.flatMap((plan) => typeof plan.url === "string" ? [plan.url] : []);
  if ([...source.entryUrls, ...exactUrls].some((url) => !isExactPublicHttps(url))) {
    context.addIssue({ code: "custom", path: ["entryUrls"], message: "公共资源只接受无凭证的公网 HTTPS 443 精确 URL" });
  }
  if (new Set(exactUrls).size !== exactUrls.length
    || !sameStringSet(source.entryUrls, exactUrls)) {
    context.addIssue({ code: "custom", path: ["targets"], message: "每个公共资源入口必须恰好对应一个同 URL target" });
  }
  if (source.targets.some((target) => target.quantity.mode !== "target_count" || target.quantity.targetCount !== 1)) {
    context.addIssue({ code: "custom", path: ["targets"], message: "公共资源每个 target 必须声明 target_count=1" });
  }
  source.targets.forEach((target, index) => {
    const plan = targetPlans[index]!;
    const configurationKeys = target.providerConfiguration.map((item) => item.key).sort();
    if (configurationKeys.join(",") === "url") return;
    if (configurationKeys.join(",") !== "from_target,link_text"
      || typeof plan.from_target !== "string" || typeof plan.link_text !== "string") {
      context.addIssue({ code: "custom", path: ["targets", index, "providerConfiguration"],
        message: "同源链接 target 必须且只能配置 from_target 与 link_text" });
      return;
    }
    const parentIndex = source.targets.findIndex((item) => item.key === plan.from_target);
    if (parentIndex < 0 || parentIndex >= index) {
      context.addIssue({ code: "custom", path: ["targets", index, "providerConfiguration"],
        message: "同源链接 target 的 from_target 必须引用排在它之前的 target" });
    }
  });
  const origins = new Set(exactUrls.filter((url) => isExactPublicHttps(url)).map((url) => new URL(url).origin));
  if (source.stopPolicy.requestBudget < source.targets.length + origins.size) {
    context.addIssue({ code: "custom", path: ["stopPolicy", "requestBudget"],
      message: "公共资源请求预算必须包含每个 target 与每个 origin 的 robots.txt" });
  }
}

function sameStringSet(left: string[], right: string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function isExactPublicHttps(value: string, requiredHostname?: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (!url.port || url.port === "443")
      && !url.username && !url.password && (!requiredHostname || url.hostname === requiredHostname);
  } catch {
    return false;
  }
}

function addDuplicateKeyIssues(
  values: Array<{ key: string }>,
  context: z.RefinementCtx,
  path: Array<string | number>,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (!seen.has(value.key)) {
      seen.add(value.key);
      return;
    }
    context.addIssue({ code: "custom", path: [...path, index, "key"], message: `key 重复：${value.key}` });
  });
}
