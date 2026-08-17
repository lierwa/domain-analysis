CREATE TABLE "workbench"."source_collection_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"project_revision" integer NOT NULL,
	"category_definition_version_id" text NOT NULL,
	"confirmed_scope_version_id" text NOT NULL,
	"collection_board_version_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD COLUMN "source_collection_plan_id" text;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD COLUMN "source_collection_plan_batch_key" text;--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" ADD COLUMN "target_keys_json" jsonb;--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" ADD COLUMN "knowledge_need_ids_json" jsonb;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" ADD CONSTRAINT "source_collection_plans_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" ADD CONSTRAINT "source_collection_plans_category_definition_version_id_category_definition_versions_id_fk" FOREIGN KEY ("category_definition_version_id") REFERENCES "workbench"."category_definition_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" ADD CONSTRAINT "source_collection_plans_confirmed_scope_version_id_confirmed_scope_versions_id_fk" FOREIGN KEY ("confirmed_scope_version_id") REFERENCES "workbench"."confirmed_scope_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" ADD CONSTRAINT "source_collection_plans_collection_board_version_id_collection_board_versions_id_fk" FOREIGN KEY ("collection_board_version_id") REFERENCES "workbench"."collection_board_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_collection_plan_project_hash_uq" ON "workbench"."source_collection_plans" USING btree ("project_id","content_hash");--> statement-breakpoint
CREATE INDEX "source_collection_plan_project_time_idx" ON "workbench"."source_collection_plans" USING btree ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD CONSTRAINT "source_collection_runs_source_collection_plan_id_source_collection_plans_id_fk" FOREIGN KEY ("source_collection_plan_id") REFERENCES "workbench"."source_collection_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_collection_run_plan_batch_idx" ON "workbench"."source_collection_runs" USING btree ("source_collection_plan_id","source_collection_plan_batch_key");
