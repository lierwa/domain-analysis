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
}).strict();

export const crawlPlanSourceSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(500),
  publisher: z.string().trim().min(1).max(500),
  sourceKind: z.enum(sourceKinds),
  role: z.string().trim().min(1).max(1_000),
  entryUrls: z.array(z.string().url().max(2_048)).min(1).max(50),
  observationLevel: z.literal("search_discovered"),
  accessState: z.enum(sourceAccessStates),
  observedAt: isoDateSchema,
  targets: z.array(crawlPlanTargetSchema).min(1).max(100),
  executionBlockers: z.array(boundedText).max(100),
}).strict().superRefine((source, context) => {
  addDuplicateKeyIssues(source.targets, context, ["targets"]);
});

const crawlPlanCandidateBaseSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  sources: z.array(crawlPlanSourceSchema).min(1).max(100),
  excludedContent: z.array(boundedText).max(100),
}).strict();

export const crawlPlanCandidateSchema = crawlPlanCandidateBaseSchema.superRefine((candidate, context) => {
  addDuplicateKeyIssues(candidate.sources, context, ["sources"]);
});

export const crawlPlanContentSchema = crawlPlanCandidateBaseSchema.extend({
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
