CREATE TABLE "workbench"."source_collection_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"category_definition_version_id" text NOT NULL,
	"confirmed_scope_version_id" text NOT NULL,
	"collection_board_version_id" text NOT NULL,
	"category_code" text NOT NULL,
	"collection_lane_id" text NOT NULL,
	"provider_key" text NOT NULL,
	"source_authority_type" text NOT NULL,
	"access_policy_json" jsonb NOT NULL,
	"status" text NOT NULL,
	"snapshot_count" integer DEFAULT 0 NOT NULL,
	"accessible_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"asset_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"termination_reason" text
);
--> statement-breakpoint
CREATE TABLE "workbench"."source_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source_identity" text NOT NULL,
	"kind" text NOT NULL,
	"external_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."source_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"object_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"observation_json" jsonb NOT NULL,
	"content_json" jsonb NOT NULL,
	"parsing_json" jsonb NOT NULL,
	"claim_scopes_json" jsonb NOT NULL,
	"usage_permission_json" jsonb NOT NULL,
	"relations_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD CONSTRAINT "source_collection_runs_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD CONSTRAINT "source_collection_runs_category_definition_version_id_category_definition_versions_id_fk" FOREIGN KEY ("category_definition_version_id") REFERENCES "workbench"."category_definition_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD CONSTRAINT "source_collection_runs_confirmed_scope_version_id_confirmed_scope_versions_id_fk" FOREIGN KEY ("confirmed_scope_version_id") REFERENCES "workbench"."confirmed_scope_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD CONSTRAINT "source_collection_runs_collection_board_version_id_collection_board_versions_id_fk" FOREIGN KEY ("collection_board_version_id") REFERENCES "workbench"."collection_board_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_objects" ADD CONSTRAINT "source_objects_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" ADD CONSTRAINT "source_snapshots_run_id_source_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "workbench"."source_collection_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" ADD CONSTRAINT "source_snapshots_object_id_source_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "workbench"."source_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_collection_run_project_time_idx" ON "workbench"."source_collection_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_object_identity_uq" ON "workbench"."source_objects" USING btree ("project_id","source_identity","kind","external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "source_snapshot_run_idempotency_uq" ON "workbench"."source_snapshots" USING btree ("run_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "source_snapshot_run_time_idx" ON "workbench"."source_snapshots" USING btree ("run_id","observed_at");--> statement-breakpoint
CREATE INDEX "source_snapshot_object_time_idx" ON "workbench"."source_snapshots" USING btree ("object_id","observed_at");