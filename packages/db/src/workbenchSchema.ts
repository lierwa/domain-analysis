import type {
  CaptureTaskContent,
  CaptureTaskDraftVersion,
  CrawlPlanContent,
  InterviewMessageTimelinePart,
  RawSourceObservation,
  RawSourcePayload,
  SourceAccessPolicy,
  SourceCollectionPlanContent,
} from "@domain-analysis/shared";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
  selection: text("selection").notNull(),
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
  content: jsonb("content_json").$type<CaptureTaskDraftVersion["content"]>().notNull(),
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
  uniqueIndex("source_collection_plan_task_hash_uq").on(table.taskId, table.contentHash),
  // WHY：旧来源计划没有 planning run；partial unique 只约束新计划版本，不伪造或破坏历史行。
  uniqueIndex("source_collection_plan_task_version_uq").on(table.taskId, table.version)
    .where(sql`${table.planningRunId} is not null`),
  index("source_collection_plan_task_time_idx").on(table.taskId, table.createdAt),
]);

export const sourceCollectionRuns = workbenchSchema.table("source_collection_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => captureTasks.id),
  sourceCollectionPlanId: text("source_collection_plan_id").references(() => sourceCollectionPlans.id),
  sourceCollectionPlanSourceKey: text("source_collection_plan_source_key"),
  providerKey: text("provider_key").notNull(),
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
  index("source_collection_run_task_time_idx").on(table.taskId, table.startedAt),
  index("source_collection_run_plan_batch_idx").on(table.sourceCollectionPlanId, table.sourceCollectionPlanSourceKey),
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
