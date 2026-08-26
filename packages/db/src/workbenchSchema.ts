import type {
  CaptureTaskContent,
  CrawlPlanContent,
  InterviewMessageTimelinePart,
  RawSourceObservation,
  RawSourcePayload,
  SourceAccessPolicy,
  SourceAccessGateState,
  SourceCaptureWorkItem,
  SourceCollectionTargetRun,
  SourceCollectionPlanContent,
  SourceRequestAttempt,
  SourceResourceReference,
} from "@domain-analysis/shared";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex,
  type AnyPgColumn } from "drizzle-orm/pg-core";

export const workbenchSchemaName = "workbench";
const workbenchSchema = pgSchema(workbenchSchemaName);

// WHY：抓取任务是当前唯一工作对象；迁移只改名保留旧任务行，不再暴露旧知识项目语义。
export const captureTasks = workbenchSchema.table("capture_tasks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  originalRequest: text("original_request").notNull(),
  marketScope: text("market_scope").notNull(),
  status: text("status", { enum: ["draft", "ready", "archived"] }).notNull(),
  revision: integer("revision").notNull().default(1),
  content: jsonb("task_content_json").$type<CaptureTaskContent>(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { mode: "string", withTimezone: true }),
});

export const categoryInterviewSessions = workbenchSchema.table("category_interview_sessions", {
  id: text("id").primaryKey(),
  initialRequest: text("initial_request").notNull(),
  phase: text("phase", { enum: ["active", "task_ready", "confirmed"] }).notNull(),
  turnState: text("turn_state", { enum: ["idle", "running", "interrupted", "failed"] }).notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("category_interview_session_time_idx").on(table.updatedAt)]);

export const categoryInterviewMessages = workbenchSchema.table("category_interview_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => categoryInterviewSessions.id),
  sequence: integer("sequence").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  text: text("text").notNull(),
  deliveryStatus: text("delivery_status", { enum: ["completed", "interrupted", "failed"] }).notNull(),
  error: text("error"),
  timelineParts: jsonb("timeline_parts_json").$type<InterviewMessageTimelinePart[]>(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("category_interview_message_sequence_uq").on(table.sessionId, table.sequence)]);

export const categoryInterviewDecisions = workbenchSchema.table("category_interview_decisions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => categoryInterviewSessions.id),
  key: text("key").notNull(),
  question: text("question").notNull(),
  options: jsonb("options_json").$type<Array<{ label: string; description: string; recommended: boolean }>>(),
  selection: text("selection"),
  rationale: text("rationale").notNull(),
  status: text("status", { enum: ["proposed", "confirmed", "superseded"] }).notNull(),
  sourceMessageId: text("source_message_id").notNull().references(() => categoryInterviewMessages.id),
  supersedesDecisionId: text("supersedes_decision_id"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { mode: "string", withTimezone: true }),
}, (table) => [index("category_interview_decision_session_idx").on(table.sessionId, table.createdAt)]);

export const categoryInterviewUnresolvedItems = workbenchSchema.table("category_interview_unresolved_items", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => categoryInterviewSessions.id),
  key: text("key").notNull(),
  description: text("description").notNull(),
  owner: text("owner", { enum: ["system", "user"] }).notNull(),
  status: text("status", { enum: ["open", "resolved"] }).notNull(),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { mode: "string", withTimezone: true }),
}, (table) => [uniqueIndex("category_interview_unresolved_key_uq").on(table.sessionId, table.key)]);

export const captureTaskDraftVersions = workbenchSchema.table("capture_task_draft_versions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => categoryInterviewSessions.id),
  version: integer("version").notNull(),
  status: text("status", { enum: ["draft", "confirmed", "superseded"] }).notNull(),
  contentHash: text("content_hash").notNull(),
  briefMarkdown: text("brief_markdown").notNull(),
  // WHY：历史草案没有经过四类来源搜索证据门；显式标记让读取层保留文本历史但禁止误确认。
  coverageVerified: boolean("coverage_verified").notNull().default(false),
  taskId: text("task_id").references(() => captureTasks.id),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { mode: "string", withTimezone: true }),
}, (table) => [
  uniqueIndex("capture_task_draft_version_uq").on(table.sessionId, table.version),
  index("capture_task_draft_status_idx").on(table.sessionId, table.status),
]);

export const crawlPlanningRuns = workbenchSchema.table("crawl_planning_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => captureTasks.id),
  taskRevision: integer("task_revision").notNull(),
  instruction: text("instruction"),
  status: text("status", { enum: ["running", "completed", "interrupted", "failed"] }).notNull(),
  timelineParts: jsonb("timeline_parts_json").$type<InterviewMessageTimelinePart[]>().notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { mode: "string", withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { mode: "string", withTimezone: true }),
}, (table) => [index("crawl_planning_run_task_time_idx").on(table.taskId, table.startedAt)]);

export const crawlPlanningStageCheckpoints = workbenchSchema.table("crawl_planning_stage_checkpoints", {
  runId: text("run_id").notNull().references(() => crawlPlanningRuns.id, { onDelete: "cascade" }),
  stageKey: text("stage_key").notNull(),
  sequence: integer("sequence").notNull(),
  label: text("label").notNull(),
  status: text("status", { enum: ["running", "completed", "failed"] }).notNull(),
  timelineParts: jsonb("timeline_parts_json").$type<InterviewMessageTimelinePart[]>().notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { mode: "string", withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { mode: "string", withTimezone: true }),
}, (table) => [
  // WHY：稳定 stage key 是 Workbench 的幂等投影键；DBOS 恢复或至少一次 step 不得重复追加时间线。
  uniqueIndex("crawl_planning_stage_checkpoint_uq").on(table.runId, table.stageKey),
  uniqueIndex("crawl_planning_stage_sequence_uq").on(table.runId, table.sequence),
]);

export const sourceCollectionPlans = workbenchSchema.table("source_collection_plans", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => captureTasks.id),
  taskRevision: integer("task_revision").notNull(),
  planningRunId: text("planning_run_id").references(() => crawlPlanningRuns.id),
  version: integer("version").notNull().default(1),
  status: text("status", { enum: ["draft", "confirmed", "superseded"] }).notNull().default("draft"),
  contentHash: text("content_hash").notNull(),
  content: jsonb("content_json").$type<SourceCollectionPlanContent | CrawlPlanContent>().notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { mode: "string", withTimezone: true }),
}, (table) => [
  // WHY：父 workflow 恢复时最终业务写可能至少一次执行；每个 Planning Run 最多生成一个计划版本。
  uniqueIndex("source_collection_plan_planning_run_uq").on(table.planningRunId)
    .where(sql`${table.planningRunId} is not null`),
  uniqueIndex("source_collection_plan_task_hash_uq").on(table.taskId, table.contentHash),
  // WHY：旧来源计划没有 planning run；partial unique 只约束新计划版本，不伪造或破坏历史行。
  uniqueIndex("source_collection_plan_task_version_uq").on(table.taskId, table.version)
    .where(sql`${table.planningRunId} is not null`),
  index("source_collection_plan_task_time_idx").on(table.taskId, table.createdAt),
]);

export const sourceCollectionBatches = workbenchSchema.table("source_collection_batches", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => captureTasks.id),
  sourceCollectionPlanId: text("source_collection_plan_id").notNull().references(() => sourceCollectionPlans.id),
  sourceCollectionPlanVersion: integer("source_collection_plan_version").notNull(),
  taskRevision: integer("task_revision").notNull(),
  status: text("status", { enum: ["running", "completed", "partial", "failed", "stopped"] }).notNull(),
  plannedSourceCount: integer("planned_source_count").notNull(),
  startedAt: timestamp("started_at", { mode: "string", withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { mode: "string", withTimezone: true }),
  terminationReason: text("termination_reason"),
}, (table) => [
  index("source_collection_batch_task_time_idx").on(table.taskId, table.startedAt),
  index("source_collection_batch_plan_idx").on(table.sourceCollectionPlanId, table.sourceCollectionPlanVersion),
]);

export const sourceCollectionRuns = workbenchSchema.table("source_collection_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => captureTasks.id),
  executionBatchId: text("execution_batch_id").references(() => sourceCollectionBatches.id),
  resumedFromRunId: text("resumed_from_run_id")
    .references((): AnyPgColumn => sourceCollectionRuns.id),
  sourceCollectionPlanId: text("source_collection_plan_id").references(() => sourceCollectionPlans.id),
  sourceCollectionPlanSourceKey: text("source_collection_plan_source_key"),
  sourceCollectionPlanVersion: integer("source_collection_plan_version"),
  providerKey: text("provider_key").notNull(),
  providerVersion: text("provider_version"),
  requestBudget: integer("request_budget"),
  accessPolicy: jsonb("access_policy_json").$type<SourceAccessPolicy>().notNull(),
  status: text("status", { enum: ["running", "completed", "failed", "stopped"] }).notNull(),
  snapshotCount: integer("snapshot_count").notNull().default(0),
  accessibleCount: integer("accessible_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  assetCount: integer("asset_count").notNull().default(0),
  startedAt: timestamp("started_at", { mode: "string", withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { mode: "string", withTimezone: true }),
  terminationReason: text("termination_reason"),
}, (table) => [
  uniqueIndex("source_collection_run_resume_uq").on(table.resumedFromRunId),
  index("source_collection_run_task_time_idx").on(table.taskId, table.startedAt),
  index("source_collection_run_batch_idx").on(table.executionBatchId),
  index("source_collection_run_plan_batch_idx").on(table.sourceCollectionPlanId, table.sourceCollectionPlanSourceKey),
]);

export const sourceCollectionTargetRuns = workbenchSchema.table("source_collection_target_runs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => sourceCollectionRuns.id),
  targetKey: text("target_key").notNull(),
  status: text("status", { enum: ["pending", "running", "completed", "failed", "stopped"] })
    .$type<SourceCollectionTargetRun["status"]>().notNull(),
  snapshotCount: integer("snapshot_count").notNull().default(0),
  accessibleCount: integer("accessible_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  assetCount: integer("asset_count").notNull().default(0),
  startedAt: timestamp("started_at", { mode: "string", withTimezone: true }),
  finishedAt: timestamp("finished_at", { mode: "string", withTimezone: true }),
  terminationReason: text("termination_reason"),
}, (table) => [
  uniqueIndex("source_target_run_key_uq").on(table.runId, table.targetKey),
  index("source_target_run_status_idx").on(table.runId, table.status),
]);

export const sourceCaptureWorkItems = workbenchSchema.table("source_capture_work_items", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => sourceCollectionRuns.id, { onDelete: "cascade" }),
  targetKey: text("target_key").notNull(),
  workKey: text("work_key").notNull(),
  parentObjectKey: text("parent_object_key"),
  captureUnit: text("capture_unit").notNull(),
  expectedUnitCount: integer("expected_unit_count"),
  observedUnitCount: integer("observed_unit_count").notNull().default(0),
  status: text("status", { enum: ["pending", "running", "completed", "failed", "stopped"] })
    .$type<SourceCaptureWorkItem["status"]>().notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { mode: "string", withTimezone: true }),
  finishedAt: timestamp("finished_at", { mode: "string", withTimezone: true }),
  terminationReason: text("termination_reason"),
}, (table) => [
  uniqueIndex("source_capture_work_run_key_uq").on(table.runId, table.workKey),
  index("source_capture_work_status_idx").on(table.runId, table.status),
]);

export const sourceAccessGateStates = workbenchSchema.table("source_access_gate_states", {
  key: text("key").primaryKey(),
  providerKey: text("provider_key").notNull(),
  providerVersion: text("provider_version").notNull(),
  policyVersion: text("policy_version").notNull(),
  circuitState: text("circuit_state", { enum: ["closed", "open"] })
    .$type<SourceAccessGateState["circuitState"]>().notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { mode: "string", withTimezone: true }),
  nextEligibleAt: timestamp("next_eligible_at", { mode: "string", withTimezone: true }),
  windowStartedAt: timestamp("window_started_at", { mode: "string", withTimezone: true }),
  windowRequestCount: integer("window_request_count").notNull().default(0),
  blockedAt: timestamp("blocked_at", { mode: "string", withTimezone: true }),
  blockedReason: text("blocked_reason"),
  manualResumeRequired: boolean("manual_resume_required").notNull().default(false),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
});

export const sourceRequestAttempts = workbenchSchema.table("source_request_attempts", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => sourceCollectionRuns.id, { onDelete: "cascade" }),
  targetKey: text("target_key").notNull(),
  workKey: text("work_key").notNull(),
  gateKey: text("gate_key").notNull().references(() => sourceAccessGateStates.key),
  requestedUrl: text("requested_url").notNull(),
  origin: text("origin").notNull(),
  redirectParentAttemptId: text("redirect_parent_attempt_id"),
  startedAt: timestamp("started_at", { mode: "string", withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { mode: "string", withTimezone: true }),
  finalUrl: text("final_url"),
  httpStatus: integer("http_status"),
  bytes: integer("bytes"),
  state: text("state", { enum: ["started", "completed", "restricted", "failed", "cancelled"] })
    .$type<SourceRequestAttempt["state"]>().notNull(),
  restrictionReason: text("restriction_reason"),
}, (table) => [
  index("source_request_attempt_run_time_idx").on(table.runId, table.startedAt),
  index("source_request_attempt_gate_time_idx").on(table.gateKey, table.startedAt),
]);

export const sourceObjects = workbenchSchema.table("source_objects", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => captureTasks.id),
  sourceIdentity: text("source_identity").notNull(),
  kind: text("kind").notNull(),
  externalKey: text("external_key").notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("source_object_identity_uq").on(table.taskId, table.sourceIdentity, table.kind, table.externalKey),
]);

export const sourceSnapshots = workbenchSchema.table("source_snapshots", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => sourceCollectionRuns.id),
  targetKey: text("target_key"),
  objectId: text("object_id").notNull().references(() => sourceObjects.id),
  idempotencyKey: text("idempotency_key").notNull(),
  observation: jsonb("observation_json").$type<RawSourceObservation>().notNull(),
  payload: jsonb("content_json").$type<RawSourcePayload>(),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("source_snapshot_run_idempotency_uq").on(table.runId, table.idempotencyKey),
  index("source_snapshot_run_time_idx").on(table.runId, table.createdAt),
]);

export const sourceAssets = workbenchSchema.table("source_assets", {
  id: text("id").primaryKey(),
  snapshotId: text("snapshot_id").notNull().references(() => sourceSnapshots.id),
  assetKey: text("asset_key").notNull(),
  filename: text("filename").notNull(),
  sourceUrl: text("source_url").notNull(),
  mediaType: text("media_type").notNull(),
  contentHash: text("content_hash").notNull(),
  casIntegrity: text("cas_integrity").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("source_asset_snapshot_key_uq").on(table.snapshotId, table.assetKey),
  index("source_asset_integrity_idx").on(table.casIntegrity),
]);

export const sourceResourceReferences = workbenchSchema.table("source_resource_references", {
  id: text("id").primaryKey(),
  snapshotId: text("snapshot_id").notNull().references(() => sourceSnapshots.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["image"] }).$type<SourceResourceReference["kind"]>().notNull(),
  sourceUrl: text("source_url").notNull(),
  observedValue: text("observed_value"),
  locator: text("locator"),
  role: text("role", { enum: ["primary", "detail", "parameter", "review"] })
    .$type<SourceResourceReference["role"]>().notNull(),
  section: text("section").notNull(),
  ordinal: integer("ordinal").notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("source_resource_reference_position_uq")
    .on(table.snapshotId, table.kind, table.role, table.section, table.ordinal, table.sourceUrl),
  index("source_resource_reference_snapshot_idx").on(table.snapshotId),
]);
