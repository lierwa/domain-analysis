import type { KnowledgeAiRecommendation, KnowledgeArtifact, KnowledgeAttempt, KnowledgeDecision, KnowledgeDerivative,
  KnowledgeBatchRef, KnowledgeExtraction, KnowledgeInput, KnowledgeSettings } from "@domain-analysis/shared";
import { boolean, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { workbenchSchemaName } from "./workbenchSchema";

const schema = pgSchema(workbenchSchemaName);
export const knowledgePacks = schema.table("knowledge_packs", {
  id: text("id").primaryKey(), name: text("name").notNull(), skillName: text("skill_name").notNull(),
  scope: text("scope").notNull(),
  revision: integer("revision").notNull().default(1),
  selectionRevision: integer("selection_revision").notNull().default(1),
  selection: jsonb("selection").$type<KnowledgeBatchRef[]>().notNull(),
  settings: jsonb("settings").$type<KnowledgeSettings>().notNull(),
  createdAt: timestamp("created_at", {mode:"string",withTimezone:true}).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", {mode:"string",withTimezone:true}).notNull().defaultNow(),
}, t=>[uniqueIndex("knowledge_pack_skill_name_uq").on(t.skillName)]);
export const knowledgeRuns = schema.table("knowledge_runs", {
  id: text("id").primaryKey(), packId: text("pack_id").notNull().references(()=>knowledgePacks.id),
  sourceRevision: integer("source_revision").notNull(),
  inputs: jsonb("inputs").$type<KnowledgeInput[]>().notNull(),
  settings: jsonb("settings").$type<KnowledgeSettings>().notNull(), inputHash: text("input_hash").notNull(),
  toolVersion: text("tool_version").notNull(),
  generation: integer("generation").notNull().default(1), reviewRevision: integer("review_revision").notNull().default(0),
  stage: text("stage",{enum:["extract","review"]}).notNull(),
  status: text("status",{enum:["queued","running","completed","partial","stopped","failed"]}).notNull(),
  stopRequested: boolean("stop_requested").notNull().default(false), error: text("error"),
  startedAt: timestamp("started_at",{mode:"string",withTimezone:true}),
  finishedAt: timestamp("finished_at",{mode:"string",withTimezone:true}),
  createdAt: timestamp("created_at",{mode:"string",withTimezone:true}).notNull().defaultNow(),
}, t=>[index("knowledge_run_pack_idx").on(t.packId,t.createdAt)]);
export const knowledgeItems = schema.table("knowledge_items", {
  id: text("id").primaryKey(), runId: text("run_id").notNull().references(()=>knowledgeRuns.id),
  inputKey: text("input_key").notNull(), input: jsonb("input").$type<KnowledgeInput>().notNull(),
  status: text("status",{enum:["pending","running","completed","failed"]}).notNull(),
  attempts: jsonb("attempts").$type<KnowledgeAttempt[]>().notNull(), result: jsonb("result").$type<KnowledgeExtraction>(),
  derivative: jsonb("derivative").$type<KnowledgeDerivative>(), error: text("error"),
}, t=>[uniqueIndex("knowledge_item_run_input_uq").on(t.runId,t.inputKey)]);
export const knowledgeDecisions = schema.table("knowledge_decisions", {
  id: text("id").primaryKey(), runId: text("run_id").notNull().references(()=>knowledgeRuns.id),
  revision: integer("revision").notNull(), value: jsonb("value").$type<KnowledgeDecision>().notNull(),
}, t=>[uniqueIndex("knowledge_decision_run_revision_uq").on(t.runId,t.revision)]);
export const knowledgeAiReviews = schema.table("knowledge_ai_reviews", {
  id: text("id").primaryKey(), runId: text("run_id").notNull().references(()=>knowledgeRuns.id),
  issueFingerprint: text("issue_fingerprint").notNull(), generation: integer("generation").notNull(),
  reviewRevision: integer("review_revision").notNull(),
  status: text("status",{enum:["queued","running","completed","failed"]}).notNull(),
  model: text("model").notNull(), reasoningEffort: text("reasoning_effort").notNull(),
  recommendations: jsonb("recommendations").$type<KnowledgeAiRecommendation[]>().notNull(), error: text("error"),
  startedAt: timestamp("started_at",{mode:"string",withTimezone:true}),
  finishedAt: timestamp("finished_at",{mode:"string",withTimezone:true}),
  createdAt: timestamp("created_at",{mode:"string",withTimezone:true}).notNull().defaultNow(),
}, t=>[uniqueIndex("knowledge_ai_review_run_fingerprint_uq").on(t.runId,t.issueFingerprint)]);
export const knowledgeVersions = schema.table("knowledge_versions", {
  id: text("id").primaryKey(), packId: text("pack_id").notNull().references(()=>knowledgePacks.id),
  runId: text("run_id").notNull().references(()=>knowledgeRuns.id), number: integer("number").notNull(),
  packRevision: integer("pack_revision").notNull(),
  generation: integer("generation").notNull(), reviewRevision: integer("review_revision").notNull(),
  inputHash: text("input_hash").notNull(),
  status: text("status",{enum:["building","ready","failed","published"]}).notNull(),
  artifact: jsonb("artifact").$type<KnowledgeArtifact>(), error: text("error"),
  startedAt: timestamp("started_at",{mode:"string",withTimezone:true}),
  createdAt: timestamp("created_at",{mode:"string",withTimezone:true}).notNull().defaultNow(),
  publishedAt: timestamp("published_at",{mode:"string",withTimezone:true}),
}, t=>[uniqueIndex("knowledge_version_pack_number_uq").on(t.packId,t.number)]);
