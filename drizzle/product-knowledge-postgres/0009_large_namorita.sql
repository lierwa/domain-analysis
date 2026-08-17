CREATE TABLE "workbench"."knowledge_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"project_id" text NOT NULL,
	"subject_key" text NOT NULL,
	"knowledge_need_id" text NOT NULL,
	"predicate" text NOT NULL,
	"candidate_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."knowledge_conflicts" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"project_id" text NOT NULL,
	"subject_key" text NOT NULL,
	"knowledge_need_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"conflict_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."knowledge_factory_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"category_definition_version_id" text NOT NULL,
	"recipe_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text NOT NULL,
	"batch_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."knowledge_review_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"project_id" text NOT NULL,
	"action" text NOT NULL,
	"target_ids_json" jsonb NOT NULL,
	"decision_json" jsonb NOT NULL,
	"decided_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."knowledge_unknowns" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"project_id" text NOT NULL,
	"subject_key" text NOT NULL,
	"knowledge_need_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"unknown_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workbench"."evidence_items" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "workbench"."source_observations" ADD COLUMN "source_snapshot_id" text;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_batch_id_knowledge_factory_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "workbench"."knowledge_factory_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_conflicts" ADD CONSTRAINT "knowledge_conflicts_batch_id_knowledge_factory_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "workbench"."knowledge_factory_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_conflicts" ADD CONSTRAINT "knowledge_conflicts_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_factory_batches" ADD CONSTRAINT "knowledge_factory_batches_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_factory_batches" ADD CONSTRAINT "knowledge_factory_batches_category_definition_version_id_category_definition_versions_id_fk" FOREIGN KEY ("category_definition_version_id") REFERENCES "workbench"."category_definition_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_review_decisions" ADD CONSTRAINT "knowledge_review_decisions_batch_id_knowledge_factory_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "workbench"."knowledge_factory_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_review_decisions" ADD CONSTRAINT "knowledge_review_decisions_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_unknowns" ADD CONSTRAINT "knowledge_unknowns_batch_id_knowledge_factory_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "workbench"."knowledge_factory_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_unknowns" ADD CONSTRAINT "knowledge_unknowns_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_candidate_batch_idx" ON "workbench"."knowledge_candidates" USING btree ("batch_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_candidate_subject_idx" ON "workbench"."knowledge_candidates" USING btree ("project_id","subject_key");--> statement-breakpoint
CREATE INDEX "knowledge_conflict_batch_idx" ON "workbench"."knowledge_conflicts" USING btree ("batch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_factory_project_input_uq" ON "workbench"."knowledge_factory_batches" USING btree ("project_id","input_hash");--> statement-breakpoint
CREATE INDEX "knowledge_factory_project_time_idx" ON "workbench"."knowledge_factory_batches" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_review_batch_time_idx" ON "workbench"."knowledge_review_decisions" USING btree ("batch_id","decided_at");--> statement-breakpoint
CREATE INDEX "knowledge_review_project_time_idx" ON "workbench"."knowledge_review_decisions" USING btree ("project_id","decided_at");--> statement-breakpoint
CREATE INDEX "knowledge_unknown_batch_idx" ON "workbench"."knowledge_unknowns" USING btree ("batch_id","created_at");--> statement-breakpoint
ALTER TABLE "workbench"."source_observations" ADD CONSTRAINT "source_observations_source_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "workbench"."source_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_item_request_idempotency_uq" ON "workbench"."evidence_items" USING btree ("request_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "source_observation_request_snapshot_uq" ON "workbench"."source_observations" USING btree ("request_id","source_snapshot_id");