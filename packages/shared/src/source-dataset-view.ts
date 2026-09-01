import { z } from "zod";

import {
  rawSourceObservationSchema,
  sourceAccessGateStateSchema,
  sourceCaptureWorkItemSchema,
  sourceCollectionBatchSchema,
  sourceCollectionRunSchema,
  sourceCollectionTargetRunSchema,
  sourceDatasetIdSchema,
  sourceDatasetIsoDateSchema,
  sourceExecutionFailureCategorySchema,
  sourceRequestAttemptSchema,
  sourceSnapshotLineageSchema,
  sourceSnapshotRecordSchema,
} from "./source-dataset";
import { sourceCoverageAssessmentSchema } from "./source-coverage";

export const sourceDatasetResourceFormatSchema = z.enum([
  "html", "json", "xml", "csv", "text", "pdf", "word", "spreadsheet", "image", "video",
  "binary", "legacy", "unknown",
]);

export const sourceDatasetRecordGroupKeySchema = z.enum([
  "planned_entry:0",
  "sitemap_document:0", "sitemap_document:1", "sitemap_document:2", "sitemap_document:3",
  "sitemap_entry:1", "sitemap_entry:2", "sitemap_entry:3",
  "html_link:1", "html_link:2", "html_link:3",
  "unrecorded",
]);

const sourceDatasetOutcomeCountsSchema = z.object({
  accepted: z.number().int().nonnegative(),
  supporting: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
}).strict();

export const sourceDatasetRecordGroupSummarySchema = z.object({
  groupKey: sourceDatasetRecordGroupKeySchema,
  totalCount: z.number().int().nonnegative(),
  outcomes: sourceDatasetOutcomeCountsSchema,
  formats: z.array(z.object({
    format: sourceDatasetResourceFormatSchema,
    count: z.number().int().positive(),
  }).strict()).max(13),
}).strict();

export const sourceDatasetPlanSourceSchema = z.object({
  planId: sourceDatasetIdSchema,
  planVersion: z.number().int().positive(),
  planStatus: z.enum(["draft", "confirmed", "superseded"]),
  sourceKey: sourceDatasetIdSchema,
  name: z.string().min(1).max(500),
  publisher: z.string().min(1).max(500).optional(),
  sourceKind: z.string().min(1).max(120).optional(),
  role: z.string().min(1).max(1_000).optional(),
  targets: z.array(z.object({
    targetKey: sourceDatasetIdSchema,
    name: z.string().min(1).max(500),
    captureUnit: z.string().min(1).max(500),
    taskTopics: z.array(z.string().min(1).max(500)),
    recordGroups: z.array(sourceDatasetRecordGroupSummarySchema).default([]),
  }).strict()),
}).strict();

export const sourceDatasetPlanBrandSchema = z.object({
  planId: sourceDatasetIdSchema,
  planVersion: z.number().int().positive(),
  planStatus: z.enum(["draft", "confirmed", "superseded"]),
  name: z.string().trim().min(1).max(300),
  aliases: z.array(z.string().trim().min(1).max(300)).max(30),
  status: z.enum(["planned", "unresolved"]),
  officialSourceKeys: z.array(sourceDatasetIdSchema).max(20),
}).strict().superRefine((brand, context) => {
  if (brand.status === "planned" && brand.officialSourceKeys.length === 0) {
    context.addIssue({ code: "custom", path: ["officialSourceKeys"], message: "已规划品牌必须关联官网来源" });
  }
  if (brand.status === "unresolved" && brand.officialSourceKeys.length > 0) {
    context.addIssue({ code: "custom", path: ["officialSourceKeys"], message: "未解决品牌不能关联官网来源" });
  }
});

export const sourceDatasetRecordSummarySchema = z.object({
  snapshotId: sourceDatasetIdSchema,
  runId: sourceDatasetIdSchema,
  targetKey: sourceDatasetIdSchema.optional(),
  sourceIdentity: z.string().min(1).max(500),
  objectKind: z.string().min(1).max(120),
  externalKey: z.string().min(1).max(1_000),
  observation: rawSourceObservationSchema,
  outcome: z.enum(["accepted", "rejected", "supporting", "failed"]),
  lineage: sourceSnapshotLineageSchema.optional(),
  captureSubjectId: sourceDatasetIdSchema.optional(),
  resourceKind: sourceCaptureWorkItemSchema.shape.resourceKind,
  resourceSection: z.string().min(1).max(300).optional(),
  resourceOrdinal: z.number().int().nonnegative().optional(),
  payload: z.object({
    kind: z.enum(["inline_text", "asset", "legacy_structured_json"]),
    mediaType: z.string().min(1).max(240).optional(),
    filename: z.string().min(1).max(500).optional(),
    bytes: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  resourceFormat: sourceDatasetResourceFormatSchema,
  assets: z.array(z.object({
    id: sourceDatasetIdSchema,
    filename: z.string().min(1).max(500),
    sourceUrl: z.string().url(),
    mediaType: z.string().min(1).max(240),
    bytes: z.number().int().nonnegative(),
  }).strict()).max(20).default([]),
  assetCount: z.number().int().nonnegative(),
  resourceReferenceCount: z.number().int().nonnegative(),
}).strict();

const sourceDatasetResourceCountsSchema = z.object({
  parameterPages: z.number().int().nonnegative(),
  galleryPages: z.number().int().nonnegative(),
  pictureSets: z.number().int().nonnegative(),
  images: z.number().int().nonnegative(),
}).strict();

export const sourceDatasetModelSummarySchema = z.object({
  subjectId: sourceDatasetIdSchema,
  sourceEntityId: sourceDatasetIdSchema,
  displayName: z.string().min(1).max(500),
  status: z.enum(["pending", "running", "completed", "needs_attention"]),
  resources: sourceDatasetResourceCountsSchema,
  issueCount: z.number().int().nonnegative(),
}).strict();

export const sourceDatasetBrandSummarySchema = z.object({
  subjectId: sourceDatasetIdSchema,
  sourceEntityId: sourceDatasetIdSchema,
  displayName: z.string().min(1).max(500),
  models: z.array(sourceDatasetModelSummarySchema),
  counts: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    needsAttention: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export const sourceDatasetIssueSummarySchema = z.object({
  id: sourceDatasetIdSchema,
  classification: z.enum(["content_rejected", "request_failed"]),
  subjectId: sourceDatasetIdSchema.optional(),
  requestedUrl: z.string().url(),
  ruleVersion: sourceDatasetIdSchema.optional(),
  reason: z.string().min(1).max(4_000),
  httpStatus: z.number().int().min(100).max(599).optional(),
  occurrenceCount: z.number().int().positive(),
  runIds: z.array(sourceDatasetIdSchema),
  latestSnapshotId: sourceDatasetIdSchema,
}).strict();

export const sourceDatasetCurrentExecutionSchema = z.object({
  batchId: sourceDatasetIdSchema,
  status: z.enum(["running", "completed", "partial", "failed", "stopped"]),
  recoveryState: z.enum(["none", "pending", "running", "completed"]),
  planVersion: z.number().int().positive(),
  runCount: z.number().int().nonnegative(),
  snapshotCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  brandCount: z.number().int().nonnegative(),
  modelCount: z.number().int().nonnegative(),
  completedModelCount: z.number().int().nonnegative(),
  needsAttentionModelCount: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  cumulativeRunDurationMs: z.number().int().nonnegative(),
  startedAt: sourceDatasetIsoDateSchema,
  finishedAt: sourceDatasetIsoDateSchema.optional(),
}).strict();

export const sourceDatasetRecordPageSchema = z.object({
  items: z.array(sourceDatasetRecordSummarySchema).max(50),
  totalCount: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).max(2_000).optional(),
}).strict();

export const sourceCollectionExecutionSummarySchema = z.object({
  batchId: sourceDatasetIdSchema,
  taskId: sourceDatasetIdSchema,
  sourceCollectionPlanId: sourceDatasetIdSchema,
  sourceCollectionPlanVersion: z.number().int().positive(),
  taskRevision: z.number().int().positive(),
  status: z.enum(["running", "completed", "partial", "failed", "stopped"]),
  plannedSourceCount: z.number().int().positive(),
  latestRuns: z.array(sourceCollectionRunSchema),
  counts: z.object({
    running: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    stopped: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
  }).strict(),
  failureCounts: z.record(sourceExecutionFailureCategorySchema,
    z.number().int().nonnegative()).default({}),
}).strict();

export const sourceDatasetTaskViewSchema = z.object({
  batches: z.array(sourceCollectionBatchSchema),
  runs: z.array(sourceCollectionRunSchema),
  // WHY：历史 Batch/Run 保持不可变；恢复后的用户状态由每个计划来源最新 Run 统一投影。
  executions: z.array(sourceCollectionExecutionSummarySchema).default([]),
  // WHY：任务页只读取聚合地图摘要；单条记录在负责人展开记录组后分页取得。
  sources: z.array(sourceDatasetPlanSourceSchema).default([]),
  brands: z.array(sourceDatasetPlanBrandSchema).default([]),
  currentExecution: sourceDatasetCurrentExecutionSchema.optional(),
  capturedBrands: z.array(sourceDatasetBrandSummarySchema).default([]),
  issues: z.array(sourceDatasetIssueSummarySchema).default([]),
  coverage: sourceCoverageAssessmentSchema.optional(),
}).strict();

export const sourceDatasetRunViewSchema = z.object({
  run: sourceCollectionRunSchema,
  targets: z.array(sourceCollectionTargetRunSchema),
  workItems: z.array(sourceCaptureWorkItemSchema).default([]),
  requestAttempts: z.array(sourceRequestAttemptSchema).default([]),
  accessGates: z.array(sourceAccessGateStateSchema).default([]),
  records: z.array(sourceSnapshotRecordSchema),
}).strict();

export const sourceDatasetRunAuditViewSchema = sourceDatasetRunViewSchema.omit({ records: true }).extend({
  recordGroups: z.array(z.object({
    targetKey: sourceDatasetIdSchema.optional(),
    resourceKind: sourceCaptureWorkItemSchema.shape.resourceKind,
    totalCount: z.number().int().nonnegative(),
  }).strict()).default([]),
}).strict();

export type SourceDatasetPlanSource = z.infer<typeof sourceDatasetPlanSourceSchema>;
export type SourceDatasetPlanBrand = z.infer<typeof sourceDatasetPlanBrandSchema>;
export type SourceDatasetBrandSummary = z.infer<typeof sourceDatasetBrandSummarySchema>;
export type SourceDatasetModelSummary = z.infer<typeof sourceDatasetModelSummarySchema>;
export type SourceDatasetIssueSummary = z.infer<typeof sourceDatasetIssueSummarySchema>;
export type SourceDatasetCurrentExecution = z.infer<typeof sourceDatasetCurrentExecutionSchema>;
export type SourceDatasetRecordSummary = z.infer<typeof sourceDatasetRecordSummarySchema>;
export type SourceDatasetRecordPage = z.infer<typeof sourceDatasetRecordPageSchema>;
export type SourceDatasetRecordGroupKey = z.infer<typeof sourceDatasetRecordGroupKeySchema>;
export type SourceDatasetResourceFormat = z.infer<typeof sourceDatasetResourceFormatSchema>;
export type SourceDatasetRunView = z.infer<typeof sourceDatasetRunViewSchema>;
export type SourceDatasetRunAuditView = z.infer<typeof sourceDatasetRunAuditViewSchema>;
export type SourceDatasetTaskView = z.infer<typeof sourceDatasetTaskViewSchema>;
export type SourceCollectionExecutionSummary = z.infer<typeof sourceCollectionExecutionSummarySchema>;
