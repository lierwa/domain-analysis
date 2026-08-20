import { z } from "zod";

const idSchema = z.string().min(1).max(240);
const isoDateSchema = z.string().datetime({ offset: true });
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const sourceAccessPolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual"), version: idSchema }).strict(),
  z.object({
    kind: z.literal("paced_http"),
    version: idSchema,
    maxRequestsPerMinute: z.number().int().positive(),
    minimumIntervalMs: z.number().int().positive(),
    jitterMs: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).strict(),
    batchSize: z.number().int().positive(),
    batchCooldownMs: z.number().int().positive(),
    maximumRunMs: z.number().int().positive(),
  }).strict(),
]).superRefine((policy, context) => {
  if (policy.kind === "paced_http" && policy.jitterMs.max < policy.jitterMs.min) {
    context.addIssue({ code: "custom", path: ["jitterMs", "max"], message: "抖动上限不能小于下限" });
  }
});

export const rawSourceObservationSchema = z.object({
  requestedUrl: z.string().url(),
  finalUrl: z.string().url().optional(),
  observedAt: isoDateSchema,
  state: z.enum(["accessible", "login_required", "verification_required", "access_denied", "not_found", "source_error"]),
  httpStatus: z.number().int().min(100).max(599).optional(),
  responseHeaders: z.record(z.string(), z.string()).default({}),
  error: z.string().min(1).max(4000).optional(),
}).strict();

export const rawSourcePayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("inline_text"),
    mediaType: z.string().min(1).max(240),
    charset: z.string().min(1).max(80).optional(),
    text: z.string(),
    bytes: z.number().int().nonnegative(),
    contentHash: hashSchema,
  }).strict(),
  z.object({
    kind: z.literal("asset"),
    assetKey: idSchema,
    filename: z.string().min(1).max(500),
    mediaType: z.string().min(1).max(240),
    bytes: z.number().int().nonnegative(),
    contentHash: hashSchema,
  }).strict(),
  z.object({ kind: z.literal("legacy_structured_json"), value: z.unknown() }).strict(),
]);

export const sourceObjectInputSchema = z.object({
  sourceIdentity: z.string().min(1).max(500),
  kind: z.string().min(1).max(120),
  externalKey: z.string().min(1).max(1000),
}).strict();

export const sourceObjectSchema = sourceObjectInputSchema.extend({
  id: idSchema,
  taskId: idSchema,
  createdAt: isoDateSchema,
}).strict();

export const sourceCollectionPlanContentSchema = z.object({
  taskId: idSchema,
  taskRevision: z.number().int().positive(),
  sources: z.array(z.object({
    key: idSchema,
    providerKey: idSchema,
    entryUrl: z.string().url(),
    expectedContents: z.array(z.string().min(1).max(500)),
    accessPolicy: sourceAccessPolicySchema,
  }).strict()).min(1),
}).strict();

export const sourceCollectionPlanSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  taskRevision: z.number().int().positive(),
  contentHash: hashSchema,
  content: sourceCollectionPlanContentSchema,
  createdAt: isoDateSchema,
}).strict();

export const sourceCollectionRunSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  sourceCollectionPlanId: idSchema.optional(),
  sourceCollectionPlanSourceKey: idSchema.optional(),
  sourceCollectionPlanVersion: z.number().int().positive().optional(),
  providerKey: idSchema,
  providerVersion: idSchema.optional(),
  accessPolicy: sourceAccessPolicySchema,
  status: z.enum(["running", "completed", "failed", "stopped"]),
  snapshotCount: z.number().int().nonnegative(),
  accessibleCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  startedAt: isoDateSchema,
  finishedAt: isoDateSchema.optional(),
  terminationReason: z.string().min(1).max(2000).optional(),
}).strict();

export const sourceCollectionTargetRunSchema = z.object({
  id: idSchema,
  runId: idSchema,
  targetKey: idSchema,
  status: z.enum(["pending", "running", "completed", "failed", "stopped"]),
  snapshotCount: z.number().int().nonnegative(),
  accessibleCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  startedAt: isoDateSchema.optional(),
  finishedAt: isoDateSchema.optional(),
  terminationReason: z.string().min(1).max(2000).optional(),
}).strict();

export const sourceSnapshotSchema = z.object({
  id: idSchema,
  runId: idSchema,
  // WHY：历史快照没有 target；新执行写入口强制要求，读取时继续保留旧数据而不伪造归属。
  targetKey: idSchema.optional(),
  objectId: idSchema,
  idempotencyKey: idSchema,
  observation: rawSourceObservationSchema,
  payload: rawSourcePayloadSchema.optional(),
  contentHash: hashSchema,
  createdAt: isoDateSchema,
}).strict();

export const sourceAssetSchema = z.object({
  id: idSchema,
  snapshotId: idSchema,
  assetKey: idSchema,
  filename: z.string().min(1).max(500),
  sourceUrl: z.string().url(),
  mediaType: z.string().min(1).max(240),
  contentHash: hashSchema,
  casIntegrity: z.string().min(1).max(500),
  bytes: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
}).strict();

export const sourceSnapshotRecordSchema = z.object({
  object: sourceObjectSchema,
  snapshot: sourceSnapshotSchema,
  assets: z.array(sourceAssetSchema),
}).strict();

export const sourceSnapshotCommitSchema = z.object({
  runId: idSchema,
  targetKey: idSchema,
  idempotencyKey: idSchema,
  object: sourceObjectInputSchema,
  observation: rawSourceObservationSchema,
  payload: rawSourcePayloadSchema.optional(),
}).strict();

export const sourceProviderAssetSchema = z.object({
  assetKey: idSchema,
  filename: z.string().min(1).max(500),
  sourceUrl: z.string().url(),
  mediaType: z.string().min(1).max(240),
  contentHash: hashSchema,
  content: z.instanceof(Uint8Array),
}).strict();

const providerSnapshotSchema = sourceSnapshotCommitSchema.omit({ runId: true, targetKey: true });
export const sourceProviderEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("capture"),
    targetKey: idSchema,
    snapshot: providerSnapshotSchema,
    assets: z.array(sourceProviderAssetSchema).max(20).default([]),
  }).strict(),
  z.object({ type: z.literal("target.completed"), targetKey: idSchema }).strict(),
]).superRefine((event, context) => {
  if (event.type === "capture" && event.snapshot.observation.state === "accessible"
    && !event.snapshot.payload) {
    context.addIssue({ code: "custom", path: ["snapshot", "payload"],
      message: "accessible capture 必须包含原始 payload" });
  }
});

export const sourceRunEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.started"), run: sourceCollectionRunSchema }).strict(),
  z.object({ type: z.literal("run.updated"), run: sourceCollectionRunSchema }).strict(),
  z.object({ type: z.literal("run.completed"), run: sourceCollectionRunSchema }).strict(),
  z.object({ type: z.literal("run.failed"), run: sourceCollectionRunSchema }).strict(),
  z.object({ type: z.literal("run.stopped"), run: sourceCollectionRunSchema }).strict(),
]);

export const sourceDatasetRunViewSchema = z.object({
  run: sourceCollectionRunSchema,
  targets: z.array(sourceCollectionTargetRunSchema),
  records: z.array(sourceSnapshotRecordSchema),
}).strict();

export type SourceAccessPolicy = z.infer<typeof sourceAccessPolicySchema>;
export type RawSourceObservation = z.infer<typeof rawSourceObservationSchema>;
export type RawSourcePayload = z.infer<typeof rawSourcePayloadSchema>;
export type SourceObjectInput = z.infer<typeof sourceObjectInputSchema>;
export type SourceObject = z.infer<typeof sourceObjectSchema>;
export type SourceCollectionPlanContent = z.infer<typeof sourceCollectionPlanContentSchema>;
export type SourceCollectionPlan = z.infer<typeof sourceCollectionPlanSchema>;
export type SourceCollectionRun = z.infer<typeof sourceCollectionRunSchema>;
export type SourceCollectionTargetRun = z.infer<typeof sourceCollectionTargetRunSchema>;
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type SourceAsset = z.infer<typeof sourceAssetSchema>;
export type SourceSnapshotRecord = z.infer<typeof sourceSnapshotRecordSchema>;
export type SourceDatasetRunView = z.infer<typeof sourceDatasetRunViewSchema>;
export type SourceSnapshotCommit = z.infer<typeof sourceSnapshotCommitSchema>;
export type SourceProviderAsset = z.infer<typeof sourceProviderAssetSchema>;
export type SourceProviderEvent = z.infer<typeof sourceProviderEventSchema>;
export type SourceRunEvent = z.infer<typeof sourceRunEventSchema>;
