ALTER TABLE IF EXISTS "workbench"."category_definition_versions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "workbench"."collection_board_versions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "workbench"."confirmed_scope_versions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "workbench"."evidence_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "workbench"."evidence_requests" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "workbench"."knowledge_candidates" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "workbench"."knowledge_conflicts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "workbench"."knowledge_factory_batches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "workbench"."knowledge_review_decisions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "workbench"."knowledge_unknowns" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "workbench"."market_universe_versions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "workbench"."source_observations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE IF EXISTS "workbench"."category_definition_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workbench"."collection_board_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workbench"."confirmed_scope_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workbench"."evidence_items" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workbench"."evidence_requests" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workbench"."knowledge_candidates" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workbench"."knowledge_conflicts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workbench"."knowledge_factory_batches" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workbench"."knowledge_review_decisions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workbench"."knowledge_unknowns" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workbench"."market_universe_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workbench"."source_observations" CASCADE;--> statement-breakpoint
ALTER TABLE "workbench"."category_research_brief_versions" RENAME TO "capture_task_draft_versions";--> statement-breakpoint
ALTER TABLE "workbench"."product_knowledge_projects" RENAME TO "capture_tasks";--> statement-breakpoint
ALTER TABLE "workbench"."category_interview_sessions" RENAME COLUMN "category_hint" TO "initial_request";--> statement-breakpoint
ALTER TABLE "workbench"."capture_task_draft_versions" RENAME COLUMN "project_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "workbench"."capture_tasks" RENAME COLUMN "knowledge_topic" TO "original_request";--> statement-breakpoint
ALTER TABLE "workbench"."capture_tasks" RENAME COLUMN "market" TO "market_scope";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" RENAME COLUMN "project_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" RENAME COLUMN "project_revision" TO "task_revision";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" RENAME COLUMN "project_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" RENAME COLUMN "source_collection_plan_batch_key" TO "source_collection_plan_source_key";--> statement-breakpoint
ALTER TABLE "workbench"."source_objects" RENAME COLUMN "project_id" TO "task_id";--> statement-breakpoint
ALTER TABLE "workbench"."capture_task_draft_versions" DROP CONSTRAINT IF EXISTS "category_research_brief_versions_session_id_category_interview_sessions_id_fk";--> statement-breakpoint
ALTER TABLE "workbench"."capture_task_draft_versions" DROP CONSTRAINT IF EXISTS "category_research_brief_versions_project_id_product_knowledge_projects_id_fk";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" DROP CONSTRAINT IF EXISTS "source_collection_plans_project_id_product_knowledge_projects_id_fk";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" DROP CONSTRAINT IF EXISTS "source_collection_runs_project_id_product_knowledge_projects_id_fk";--> statement-breakpoint
ALTER TABLE "workbench"."source_objects" DROP CONSTRAINT IF EXISTS "source_objects_project_id_product_knowledge_projects_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "workbench"."source_snapshot_object_time_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "workbench"."source_collection_plan_project_hash_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "workbench"."source_collection_plan_project_time_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "workbench"."source_collection_run_project_time_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "workbench"."source_collection_run_plan_batch_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "workbench"."source_object_identity_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "workbench"."source_snapshot_run_time_idx";--> statement-breakpoint
ALTER TABLE "workbench"."category_interview_decisions" ADD COLUMN IF NOT EXISTS "options_json" jsonb;--> statement-breakpoint
ALTER TABLE "workbench"."capture_tasks" ADD COLUMN IF NOT EXISTS "task_content_json" jsonb;--> statement-breakpoint
ALTER TABLE "workbench"."capture_tasks" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workbench"."source_assets" ADD COLUMN IF NOT EXISTS "filename" text;--> statement-breakpoint
UPDATE "workbench"."source_assets" SET "filename" = "asset_key" WHERE "filename" IS NULL;--> statement-breakpoint
ALTER TABLE "workbench"."source_assets" ALTER COLUMN "filename" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workbench"."capture_task_draft_versions" ADD CONSTRAINT "capture_task_draft_versions_session_id_category_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "workbench"."category_interview_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."capture_task_draft_versions" ADD CONSTRAINT "capture_task_draft_versions_task_id_capture_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "workbench"."capture_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" ADD CONSTRAINT "source_collection_plans_task_id_capture_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "workbench"."capture_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD CONSTRAINT "source_collection_runs_task_id_capture_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "workbench"."capture_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_objects" ADD CONSTRAINT "source_objects_task_id_capture_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "workbench"."capture_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER INDEX IF EXISTS "workbench"."category_research_brief_version_uq" RENAME TO "capture_task_draft_version_uq";--> statement-breakpoint
ALTER INDEX IF EXISTS "workbench"."category_research_brief_status_idx" RENAME TO "capture_task_draft_status_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_collection_plan_task_hash_uq" ON "workbench"."source_collection_plans" USING btree ("task_id","content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_collection_plan_task_time_idx" ON "workbench"."source_collection_plans" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_collection_run_task_time_idx" ON "workbench"."source_collection_runs" USING btree ("task_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_collection_run_plan_batch_idx" ON "workbench"."source_collection_runs" USING btree ("source_collection_plan_id","source_collection_plan_source_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_object_identity_uq" ON "workbench"."source_objects" USING btree ("task_id","source_identity","kind","external_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_snapshot_run_time_idx" ON "workbench"."source_snapshots" USING btree ("run_id","created_at");--> statement-breakpoint
ALTER TABLE "workbench"."source_assets" DROP COLUMN IF EXISTS "dimensions_json";--> statement-breakpoint
ALTER TABLE "workbench"."source_assets" DROP COLUMN IF EXISTS "purpose";--> statement-breakpoint
ALTER TABLE "workbench"."source_assets" DROP COLUMN IF EXISTS "block_index";--> statement-breakpoint
ALTER TABLE "workbench"."source_assets" DROP COLUMN IF EXISTS "position";--> statement-breakpoint
ALTER TABLE "workbench"."source_assets" DROP COLUMN IF EXISTS "privacy_class";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" DROP COLUMN IF EXISTS "category_definition_version_id";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" DROP COLUMN IF EXISTS "confirmed_scope_version_id";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" DROP COLUMN IF EXISTS "collection_board_version_id";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" DROP COLUMN IF EXISTS "category_definition_version_id";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" DROP COLUMN IF EXISTS "confirmed_scope_version_id";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" DROP COLUMN IF EXISTS "collection_board_version_id";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" DROP COLUMN IF EXISTS "category_code";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" DROP COLUMN IF EXISTS "collection_lane_id";--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" DROP COLUMN IF EXISTS "source_authority_type";--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" DROP COLUMN IF EXISTS "target_keys_json";--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" DROP COLUMN IF EXISTS "knowledge_need_ids_json";--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" DROP COLUMN IF EXISTS "parsing_json";--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" DROP COLUMN IF EXISTS "claim_scopes_json";--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" DROP COLUMN IF EXISTS "usage_permission_json";--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" DROP COLUMN IF EXISTS "relations_json";--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" DROP COLUMN IF EXISTS "observed_at";--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" DROP COLUMN IF EXISTS "state";
