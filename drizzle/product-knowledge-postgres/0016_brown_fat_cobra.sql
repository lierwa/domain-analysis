CREATE TABLE "workbench"."source_collection_target_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"target_key" text NOT NULL,
	"status" text NOT NULL,
	"snapshot_count" integer DEFAULT 0 NOT NULL,
	"accessible_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"asset_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"termination_reason" text
);
--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD COLUMN "source_collection_plan_version" integer;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD COLUMN "provider_version" text;--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" ADD COLUMN "target_key" text;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_target_runs" ADD CONSTRAINT "source_collection_target_runs_run_id_source_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "workbench"."source_collection_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_target_run_key_uq" ON "workbench"."source_collection_target_runs" USING btree ("run_id","target_key");--> statement-breakpoint
CREATE INDEX "source_target_run_status_idx" ON "workbench"."source_collection_target_runs" USING btree ("run_id","status");
