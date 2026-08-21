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

export const sourceCollectionBatchSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  sourceCollectionPlanId: idSchema,
  sourceCollectionPlanVersion: z.number().int().positive(),
  taskRevision: z.number().int().positive(),
  status: z.enum(["running", "completed", "partial", "failed", "stopped"]),
  plannedSourceCount: z.number().int().positive(),
  startedAt: isoDateSchema,
  finishedAt: isoDateSchema.optional(),
  terminationReason: z.string().min(1).max(2000).optional(),
}).strict();

export const sourceCollectionRunSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  // WHY：批次是一次“开始抓取”的事实；历史行没有该关系，只能显式归为无批次记录。
  executionBatchId: idSchema.optional(),
  // WHY：显式恢复产生新运行；前序运行保持不可变，并由关系字段形成可审计链路。
  resumedFromRunId: idSchema.optional(),
  sourceCollectionPlanId: idSchema.optional(),
  sourceCollectionPlanSourceKey: idSchema.optional(),
  sourceCollectionPlanVersion: z.number().int().positive().optional(),
  providerKey: idSchema,
  providerVersion: idSchema.optional(),
  // WHY：历史运行未保存计划预算；新运行必须写入，读取旧数据时只能显式缺失而不能猜测。
  requestBudget: z.number().int().positive().optional(),
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

export const sourceProviderCollectionContextSchema = z.object({
  queueRunId: idSchema,
  resumedFromRunId: idSchema.optional(),
  accessPolicy: sourceAccessPolicySchema,
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

export const sourceCaptureWorkItemSchema = z.object({
  id: idSchema,
  runId: idSchema,
  targetKey: idSchema,
  workKey: idSchema,
  parentObjectKey: idSchema.optional(),
  captureUnit: idSchema,
  expectedUnitCount: z.number().int().nonnegative().optional(),
  observedUnitCount: z.number().int().nonnegative(),
  status: z.enum(["pending", "running", "completed", "failed", "stopped"]),
  createdAt: isoDateSchema,
  startedAt: isoDateSchema.optional(),
  finishedAt: isoDateSchema.optional(),
  terminationReason: z.string().min(1).max(2000).optional(),
}).strict();

export const sourceRequestAttemptSchema = z.object({
  id: idSchema,
  runId: idSchema,
  targetKey: idSchema,
  workKey: idSchema,
  gateKey: idSchema,
  requestedUrl: z.string().url(),
  origin: z.string().url(),
  redirectParentAttemptId: idSchema.optional(),
  startedAt: isoDateSchema,
  finishedAt: isoDateSchema.optional(),
  finalUrl: z.string().url().optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  bytes: z.number().int().nonnegative().optional(),
  state: z.enum(["started", "completed", "restricted", "failed", "cancelled"]),
  restrictionReason: z.string().min(1).max(500).optional(),
}).strict();

export const sourceAccessGateStateSchema = z.object({
  key: idSchema,
  providerKey: idSchema,
  providerVersion: idSchema,
  policyVersion: idSchema,
  circuitState: z.enum(["closed", "open"]),
  lastAttemptAt: isoDateSchema.optional(),
  nextEligibleAt: isoDateSchema.optional(),
  windowStartedAt: isoDateSchema.optional(),
  windowRequestCount: z.number().int().nonnegative(),
  blockedAt: isoDateSchema.optional(),
  blockedReason: z.string().min(1).max(500).optional(),
  manualResumeRequired: z.boolean(),
  updatedAt: isoDateSchema,
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

export const sourceProviderResourceReferenceSchema = z.object({
  kind: z.literal("image"),
  sourceUrl: z.string().url(),
  observedValue: z.string().min(1).max(4_000).optional(),
  locator: z.string().min(1).max(2_000).optional(),
  role: z.enum(["primary", "detail", "parameter", "review"]),
  section: idSchema,
  ordinal: z.number().int().nonnegative(),
}).strict();

export const sourceResourceReferenceSchema = sourceProviderResourceReferenceSchema.extend({
  id: idSchema,
  snapshotId: idSchema,
  createdAt: isoDateSchema,
}).strict();

export const sourceSnapshotRecordSchema = z.object({
  object: sourceObjectSchema,
  snapshot: sourceSnapshotSchema,
  assets: z.array(sourceAssetSchema),
  // WHY：历史 Snapshot 没有资源引用；读取时投影为空数组，不伪造任何已观察 URL。
  resourceReferences: z.array(sourceResourceReferenceSchema).default([]),
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
    resourceReferences: z.array(sourceProviderResourceReferenceSchema).default([]),
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

export const sourceExecutionEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("batch.started"), batch: sourceCollectionBatchSchema }).strict(),
  z.object({ type: z.literal("batch.completed"), batch: sourceCollectionBatchSchema }).strict(),
  z.object({ type: z.literal("batch.partial"), batch: sourceCollectionBatchSchema }).strict(),
  z.object({ type: z.literal("batch.failed"), batch: sourceCollectionBatchSchema }).strict(),
  z.object({ type: z.literal("batch.stopped"), batch: sourceCollectionBatchSchema }).strict(),
  z.object({ type: z.literal("run.started"), run: sourceCollectionRunSchema }).strict(),
  z.object({ type: z.literal("run.updated"), run: sourceCollectionRunSchema }).strict(),
  z.object({ type: z.literal("run.completed"), run: sourceCollectionRunSchema }).strict(),
  z.object({ type: z.literal("run.failed"), run: sourceCollectionRunSchema }).strict(),
  z.object({ type: z.literal("run.stopped"), run: sourceCollectionRunSchema }).strict(),
]);

export const sourceExecutionAcceptanceSchema = z.object({
  status: z.literal("accepted"),
  commandId: idSchema,
}).strict();

export const sourceDatasetTaskViewSchema = z.object({
  batches: z.array(sourceCollectionBatchSchema),
  runs: z.array(sourceCollectionRunSchema),
}).strict();

export const sourceDatasetRunViewSchema = z.object({
  run: sourceCollectionRunSchema,
  targets: z.array(sourceCollectionTargetRunSchema),
  workItems: z.array(sourceCaptureWorkItemSchema).default([]),
  requestAttempts: z.array(sourceRequestAttemptSchema).default([]),
  accessGates: z.array(sourceAccessGateStateSchema).default([]),
  records: z.array(sourceSnapshotRecordSchema),
}).strict();

export type SourceAccessPolicy = z.infer<typeof sourceAccessPolicySchema>;
export type RawSourceObservation = z.infer<typeof rawSourceObservationSchema>;
export type RawSourcePayload = z.infer<typeof rawSourcePayloadSchema>;
export type SourceObjectInput = z.infer<typeof sourceObjectInputSchema>;
export type SourceObject = z.infer<typeof sourceObjectSchema>;
export type SourceCollectionPlanContent = z.infer<typeof sourceCollectionPlanContentSchema>;
export type SourceCollectionPlan = z.infer<typeof sourceCollectionPlanSchema>;
export type SourceCollectionBatch = z.infer<typeof sourceCollectionBatchSchema>;
export type SourceCollectionRun = z.infer<typeof sourceCollectionRunSchema>;
export type SourceProviderCollectionContext = z.infer<typeof sourceProviderCollectionContextSchema>;
export type SourceCollectionTargetRun = z.infer<typeof sourceCollectionTargetRunSchema>;
export type SourceCaptureWorkItem = z.infer<typeof sourceCaptureWorkItemSchema>;
export type SourceRequestAttempt = z.infer<typeof sourceRequestAttemptSchema>;
export type SourceAccessGateState = z.infer<typeof sourceAccessGateStateSchema>;
export type SourceRequestAdmission =
  | { status: "admitted"; attempt: SourceRequestAttempt }
  | { status: "deferred"; reason: "minimum_interval" | "rate_window"; retryAt: string }
  | { status: "blocked"; reason: string; manualResumeRequired: boolean };
export interface SourceRequestAdmissionPort {
  ensureCaptureWorkItem(input: { runId: string; targetKey: string; workKey: string;
    parentObjectKey?: string; captureUnit: string; expectedUnitCount?: number }): Promise<SourceCaptureWorkItem>;
  startCaptureWorkItem(input: { runId: string; workKey: string }): Promise<SourceCaptureWorkItem>;
  finishCaptureWorkItem(input: { runId: string; workKey: string;
    status: "completed" | "failed" | "stopped"; observedUnitCount: number;
    terminationReason?: string }): Promise<SourceCaptureWorkItem>;
  reserveRequest(input: { runId: string; targetKey: string; workKey: string; gateKey: string;
    providerKey: string; providerVersion: string; policyVersion: string; requestedUrl: string;
    redirectParentAttemptId?: string; minimumIntervalMs: number;
    maxRequestsPerMinute: number }): Promise<SourceRequestAdmission>;
  finishRequest(input: { attemptId: string; state: Exclude<SourceRequestAttempt["state"], "started">;
    finalUrl?: string; httpStatus?: number; bytes?: number; restrictionReason?: string }): Promise<SourceRequestAttempt>;
  getAccessGate(gateKey: string): Promise<SourceAccessGateState | null>;
}
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type SourceAsset = z.infer<typeof sourceAssetSchema>;
export type SourceProviderResourceReference = z.infer<typeof sourceProviderResourceReferenceSchema>;
export type SourceResourceReference = z.infer<typeof sourceResourceReferenceSchema>;
export type SourceSnapshotRecord = z.infer<typeof sourceSnapshotRecordSchema>;
export type SourceDatasetRunView = z.infer<typeof sourceDatasetRunViewSchema>;
export type SourceDatasetTaskView = z.infer<typeof sourceDatasetTaskViewSchema>;
export type SourceSnapshotCommit = z.infer<typeof sourceSnapshotCommitSchema>;
export type SourceProviderAsset = z.infer<typeof sourceProviderAssetSchema>;
// WHY：Provider 产物先经过执行层 parse；默认空集合属于边界规范化，不应强迫所有旧 Provider 重复填充。
export type SourceProviderEvent = z.input<typeof sourceProviderEventSchema>;
export type SourceRunEvent = z.infer<typeof sourceRunEventSchema>;
export type SourceExecutionEvent = z.infer<typeof sourceExecutionEventSchema>;
export type SourceExecutionAcceptance = z.infer<typeof sourceExecutionAcceptanceSchema>;
