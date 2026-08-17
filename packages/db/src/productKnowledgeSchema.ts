import type {
  CategoryResearchBriefContent,
  CategoryDefinitionContent,
  CollectionBoardContent,
  ConfirmedScopeContent,
  EvidenceRequest,
  KnowledgeClaimCandidate,
  KnowledgeConflict,
  KnowledgeFactoryBatch,
  KnowledgeReviewDecision,
  KnowledgeUnknown,
  MarketUniverseContent,
  CommitSourceSnapshot,
  SourceAsset,
  SourceAccessPolicy,
  SourceCollectionPlanContent,
  SourceObservation,
} from "@domain-analysis/shared";
import { index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const productKnowledgeSchemaName = "workbench";
const workbenchSchema = pgSchema(productKnowledgeSchemaName);

const versionColumns = {
  version: integer("version").notNull(),
  status: text("status", { enum: ["draft", "confirmed", "superseded"] }).notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { mode: "string", withTimezone: true }),
};

// WHY：Workbench 与 DBOS 共用 PostgreSQL，但由 schema 隔离所有权，双方不能跨 schema 写表。
export const productKnowledgeProjects = workbenchSchema.table("product_knowledge_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  knowledgeTopic: text("knowledge_topic").notNull(),
  market: text("market").notNull(),
  status: text("status", { enum: ["draft", "ready", "archived"] }).notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
});

export const categoryInterviewSessions = workbenchSchema.table("category_interview_sessions", {
  id: text("id").primaryKey(),
  categoryHint: text("category_hint").notNull(),
  phase: text("phase", { enum: ["active", "brief_ready", "confirmed"] }).notNull(),
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
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("category_interview_message_sequence_uq").on(table.sessionId, table.sequence),
]);

export const categoryInterviewDecisions = workbenchSchema.table("category_interview_decisions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => categoryInterviewSessions.id),
  key: text("key").notNull(),
  question: text("question").notNull(),
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
}, (table) => [
  uniqueIndex("category_interview_unresolved_key_uq").on(table.sessionId, table.key),
]);

export const categoryResearchBriefVersions = workbenchSchema.table("category_research_brief_versions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => categoryInterviewSessions.id),
  version: integer("version").notNull(),
  status: text("status", { enum: ["draft", "confirmed", "superseded"] }).notNull(),
  contentHash: text("content_hash").notNull(),
  content: jsonb("content_json").$type<CategoryResearchBriefContent>().notNull(),
  projectId: text("project_id").references(() => productKnowledgeProjects.id),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { mode: "string", withTimezone: true }),
}, (table) => [
  uniqueIndex("category_research_brief_version_uq").on(table.sessionId, table.version),
  index("category_research_brief_status_idx").on(table.sessionId, table.status),
]);

export const categoryDefinitionVersions = workbenchSchema.table("category_definition_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  categoryCode: text("category_code").notNull(),
  label: text("label").notNull(),
  market: text("market").notNull(),
  content: jsonb("content_json").$type<CategoryDefinitionContent>().notNull(),
  ...versionColumns,
}, (table) => [
  uniqueIndex("category_definition_project_version_uq").on(table.projectId, table.version),
  index("category_definition_project_status_idx").on(table.projectId, table.status),
]);

export const confirmedScopeVersions = workbenchSchema.table("confirmed_scope_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  categoryDefinitionVersionId: text("category_definition_version_id").notNull()
    .references(() => categoryDefinitionVersions.id),
  market: text("market").notNull(),
  content: jsonb("content_json").$type<ConfirmedScopeContent>().notNull(),
  ...versionColumns,
}, (table) => [
  uniqueIndex("confirmed_scope_project_version_uq").on(table.projectId, table.version),
  index("confirmed_scope_project_status_idx").on(table.projectId, table.status),
]);

export const collectionBoardVersions = workbenchSchema.table("collection_board_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  confirmedScopeVersionId: text("confirmed_scope_version_id").notNull()
    .references(() => confirmedScopeVersions.id),
  content: jsonb("content_json").$type<CollectionBoardContent>().notNull(),
  ...versionColumns,
}, (table) => [
  uniqueIndex("collection_board_project_version_uq").on(table.projectId, table.version),
  index("collection_board_project_status_idx").on(table.projectId, table.status),
]);

// WHY：采集计划是 Workbench 业务事实；DBOS 只消费冻结计划，不能反向成为“为什么采、采什么”的事实源。
export const sourceCollectionPlans = workbenchSchema.table("source_collection_plans", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  projectRevision: integer("project_revision").notNull(),
  categoryDefinitionVersionId: text("category_definition_version_id").notNull()
    .references(() => categoryDefinitionVersions.id),
  confirmedScopeVersionId: text("confirmed_scope_version_id").notNull()
    .references(() => confirmedScopeVersions.id),
  collectionBoardVersionId: text("collection_board_version_id").notNull()
    .references(() => collectionBoardVersions.id),
  contentHash: text("content_hash").notNull(),
  content: jsonb("content_json").$type<SourceCollectionPlanContent>().notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("source_collection_plan_project_hash_uq").on(table.projectId, table.contentHash),
  index("source_collection_plan_project_time_idx").on(table.projectId, table.createdAt),
]);

// WHY：来源运行冻结确认后的项目版本；执行尝试仍归 DBOS，不能用 workflow 状态反推来源事实。
export const sourceCollectionRuns = workbenchSchema.table("source_collection_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  // TRADE-OFF：历史运行允许为空；Planner 接管生产入口后新运行必须绑定不可变计划。
  sourceCollectionPlanId: text("source_collection_plan_id")
    .references(() => sourceCollectionPlans.id),
  sourceCollectionPlanBatchKey: text("source_collection_plan_batch_key"),
  categoryDefinitionVersionId: text("category_definition_version_id").notNull()
    .references(() => categoryDefinitionVersions.id),
  confirmedScopeVersionId: text("confirmed_scope_version_id").notNull()
    .references(() => confirmedScopeVersions.id),
  collectionBoardVersionId: text("collection_board_version_id").notNull()
    .references(() => collectionBoardVersions.id),
  categoryCode: text("category_code").notNull(),
  collectionLaneId: text("collection_lane_id").notNull(),
  providerKey: text("provider_key").notNull(),
  sourceAuthorityType: text("source_authority_type").notNull(),
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
  index("source_collection_run_project_time_idx").on(table.projectId, table.startedAt),
  index("source_collection_run_plan_batch_idx")
    .on(table.sourceCollectionPlanId, table.sourceCollectionPlanBatchKey),
]);

// WHY：外部对象的稳定身份跨运行复用；品类差异留在数据值，不进入表结构或唯一键分支。
export const sourceObjects = workbenchSchema.table("source_objects", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  sourceIdentity: text("source_identity").notNull(),
  kind: text("kind").notNull(),
  externalKey: text("external_key").notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("source_object_identity_uq")
    .on(table.projectId, table.sourceIdentity, table.kind, table.externalKey),
]);

// WHY：来源快照只能追加；run 内幂等键保护任务重试，content hash 用于识别同键异内容冲突。
export const sourceSnapshots = workbenchSchema.table("source_snapshots", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => sourceCollectionRuns.id),
  objectId: text("object_id").notNull().references(() => sourceObjects.id),
  idempotencyKey: text("idempotency_key").notNull(),
  targetKeys: jsonb("target_keys_json").$type<CommitSourceSnapshot["targetKeys"]>(),
  knowledgeNeedIds: jsonb("knowledge_need_ids_json")
    .$type<CommitSourceSnapshot["knowledgeNeedIds"]>(),
  observation: jsonb("observation_json").$type<CommitSourceSnapshot["observation"]>().notNull(),
  content: jsonb("content_json").$type<CommitSourceSnapshot["content"]>(),
  parsing: jsonb("parsing_json").$type<CommitSourceSnapshot["parsing"]>().notNull(),
  claimScopes: jsonb("claim_scopes_json").$type<CommitSourceSnapshot["claimScopes"]>().notNull(),
  usagePermission: jsonb("usage_permission_json")
    .$type<CommitSourceSnapshot["usagePermission"]>().notNull(),
  relations: jsonb("relations_json").$type<CommitSourceSnapshot["relations"]>().notNull(),
  contentHash: text("content_hash").notNull(),
  observedAt: timestamp("observed_at", { mode: "string", withTimezone: true }).notNull(),
  state: text("state").notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("source_snapshot_run_idempotency_uq").on(table.runId, table.idempotencyKey),
  index("source_snapshot_run_time_idx").on(table.runId, table.observedAt),
  index("source_snapshot_object_time_idx").on(table.objectId, table.observedAt),
]);

// WHY：CAS 只去重字节；每条来源附件关系仍归自己的 snapshot，不能因内容相同而合并来源语义。
export const sourceAssets = workbenchSchema.table("source_assets", {
  id: text("id").primaryKey(),
  snapshotId: text("snapshot_id").notNull().references(() => sourceSnapshots.id),
  assetKey: text("asset_key").notNull(),
  sourceUrl: text("source_url").notNull(),
  mediaType: text("media_type").notNull(),
  dimensions: jsonb("dimensions_json").$type<SourceAsset["dimensions"]>(),
  purpose: text("purpose").notNull(),
  blockIndex: integer("block_index").notNull(),
  position: integer("position").notNull(),
  privacyClass: text("privacy_class", { enum: ["public", "restricted"] }).notNull(),
  contentHash: text("content_hash").notNull(),
  casIntegrity: text("cas_integrity").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("source_asset_snapshot_key_uq").on(table.snapshotId, table.assetKey),
  index("source_asset_integrity_idx").on(table.casIntegrity),
]);

// WHY：市场总体是批量 EvidenceRequest 的唯一分母；完整候选内容按版本不可变保存，不能由队列 URL 反推。
export const marketUniverseVersions = workbenchSchema.table("market_universe_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  categoryDefinitionVersionId: text("category_definition_version_id").notNull()
    .references(() => categoryDefinitionVersions.id),
  confirmedScopeVersionId: text("confirmed_scope_version_id").notNull()
    .references(() => confirmedScopeVersions.id),
  version: integer("version").notNull(),
  status: text("status", { enum: ["candidate", "confirmed", "superseded"] }).notNull(),
  contentHash: text("content_hash").notNull(),
  content: jsonb("content_json").$type<MarketUniverseContent>().notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { mode: "string", withTimezone: true }),
}, (table) => [
  uniqueIndex("market_universe_project_version_uq").on(table.projectId, table.version),
  index("market_universe_project_status_idx").on(table.projectId, table.status),
]);

// WHY：请求保存“为什么采”，不保存站点 DOM 或待抓字段；其内容只能绑定已确认项目版本。
export const evidenceRequests = workbenchSchema.table("evidence_requests", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  categoryDefinitionVersionId: text("category_definition_version_id").notNull()
    .references(() => categoryDefinitionVersions.id),
  confirmedScopeVersionId: text("confirmed_scope_version_id").notNull()
    .references(() => confirmedScopeVersions.id),
  collectionBoardVersionId: text("collection_board_version_id").notNull()
    .references(() => collectionBoardVersions.id),
  contentHash: text("content_hash").notNull(),
  request: jsonb("request_json").$type<EvidenceRequest>().notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("evidence_request_project_hash_uq").on(table.projectId, table.contentHash),
  index("evidence_request_project_time_idx").on(table.projectId, table.createdAt),
]);

// WHY：来源观察只记录访问事实和 typed 状态，不能借 HTTP 200 或 URL 存在推导证据充分。
export const sourceObservations = workbenchSchema.table("source_observations", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().references(() => evidenceRequests.id),
  sourceSnapshotId: text("source_snapshot_id").references(() => sourceSnapshots.id),
  sourceIdentity: text("source_identity").notNull(),
  sourceAuthorityType: text("source_authority_type").notNull(),
  finalUrl: text("final_url"),
  state: text("state").notNull(),
  observation: jsonb("observation_json").$type<SourceObservation>().notNull(),
  observedAt: timestamp("observed_at", { mode: "string", withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("source_observation_request_time_idx").on(table.requestId, table.observedAt),
  index("source_observation_request_state_idx").on(table.requestId, table.state),
  uniqueIndex("source_observation_request_snapshot_uq")
    .on(table.requestId, table.sourceSnapshotId),
]);

// WHY：表内只保存最小证据目录；证据字节和不可变 manifest 位于公开/受限 CAS。
export const evidenceItems = workbenchSchema.table("evidence_items", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().references(() => evidenceRequests.id),
  observationId: text("observation_id").notNull().references(() => sourceObservations.id),
  idempotencyKey: text("idempotency_key"),
  subjectKeys: jsonb("subject_keys_json").$type<string[]>().notNull(),
  kind: text("kind").notNull(),
  privacyClass: text("privacy_class", { enum: ["public", "restricted"] }).notNull(),
  contentIntegrity: text("content_integrity").notNull(),
  contentBytes: integer("content_bytes").notNull(),
  manifestIntegrity: text("manifest_integrity").notNull(),
  evidencePolicyVersion: text("evidence_policy_version").notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("evidence_item_request_manifest_uq").on(table.requestId, table.manifestIntegrity),
  uniqueIndex("evidence_item_request_idempotency_uq").on(table.requestId, table.idempotencyKey),
  index("evidence_item_request_time_idx").on(table.requestId, table.createdAt),
  index("evidence_item_content_idx").on(table.contentIntegrity),
]);

// WHY：Factory 产物与证据分开追加保存；重跑生成新批次或复用同一输入批次，绝不回写 Evidence。
export const knowledgeFactoryBatches = workbenchSchema.table("knowledge_factory_batches", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  categoryDefinitionVersionId: text("category_definition_version_id").notNull()
    .references(() => categoryDefinitionVersions.id),
  recipeVersion: text("recipe_version").notNull(),
  inputHash: text("input_hash").notNull(),
  status: text("status", { enum: ["completed", "failed"] }).notNull(),
  batch: jsonb("batch_json").$type<KnowledgeFactoryBatch>().notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { mode: "string", withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("knowledge_factory_project_input_uq").on(table.projectId, table.inputHash),
  index("knowledge_factory_project_time_idx").on(table.projectId, table.createdAt),
]);

export const knowledgeCandidates = workbenchSchema.table("knowledge_candidates", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => knowledgeFactoryBatches.id),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  subjectKey: text("subject_key").notNull(),
  knowledgeNeedId: text("knowledge_need_id").notNull(),
  predicate: text("predicate").notNull(),
  candidate: jsonb("candidate_json").$type<KnowledgeClaimCandidate>().notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("knowledge_candidate_batch_idx").on(table.batchId, table.createdAt),
  index("knowledge_candidate_subject_idx").on(table.projectId, table.subjectKey),
]);

export const knowledgeConflicts = workbenchSchema.table("knowledge_conflicts", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => knowledgeFactoryBatches.id),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  subjectKey: text("subject_key").notNull(),
  knowledgeNeedId: text("knowledge_need_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  conflict: jsonb("conflict_json").$type<KnowledgeConflict>().notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("knowledge_conflict_batch_idx").on(table.batchId, table.createdAt)]);

export const knowledgeUnknowns = workbenchSchema.table("knowledge_unknowns", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => knowledgeFactoryBatches.id),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  subjectKey: text("subject_key").notNull(),
  knowledgeNeedId: text("knowledge_need_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  unknown: jsonb("unknown_json").$type<KnowledgeUnknown>().notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("knowledge_unknown_batch_idx").on(table.batchId, table.createdAt)]);

// WHY：审核只追加决定；已发布视图由候选/冲突和决定计算，不能把候选行改成另一份事实源。
export const knowledgeReviewDecisions = workbenchSchema.table("knowledge_review_decisions", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => knowledgeFactoryBatches.id),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  action: text("action").notNull(),
  targetIds: jsonb("target_ids_json").$type<string[]>().notNull(),
  decision: jsonb("decision_json").$type<KnowledgeReviewDecision>().notNull(),
  decidedAt: timestamp("decided_at", { mode: "string", withTimezone: true }).notNull(),
}, (table) => [
  index("knowledge_review_batch_time_idx").on(table.batchId, table.decidedAt),
  index("knowledge_review_project_time_idx").on(table.projectId, table.decidedAt),
]);
