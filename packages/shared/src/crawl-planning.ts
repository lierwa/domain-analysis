import { z } from "zod";

import { sourceAccessStates, sourceKinds } from "./capture-task";

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
  value: z.union([z.string(), z.number(), z.boolean(), z.array(boundedText).max(30)]),
}).strict()).max(50);

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
  entryUrls: z.array(z.string().url().max(2_048)).min(1).max(50),
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
  sources: z.array(crawlPlanSourceSchema).min(1).max(100),
  researchAudit: z.unknown().optional(),
  executionChecklistVersion: z.number().int().positive().optional(),
  taskId: idSchema,
  taskRevision: z.number().int().positive(),
}).strict();

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
}).strict();

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
export type SourcePreparation = z.infer<typeof sourcePreparationSchema>;
