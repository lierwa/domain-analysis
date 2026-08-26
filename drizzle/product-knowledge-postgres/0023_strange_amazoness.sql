CREATE TABLE "workbench"."crawl_planning_stage_checkpoints" (
	"run_id" text NOT NULL,
	"stage_key" text NOT NULL,
	"sequence" integer NOT NULL,
	"label" text NOT NULL,
	"status" text NOT NULL,
	"timeline_parts_json" jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workbench"."crawl_planning_stage_checkpoints" ADD CONSTRAINT "crawl_planning_stage_checkpoints_run_id_crawl_planning_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "workbench"."crawl_planning_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_planning_stage_checkpoint_uq" ON "workbench"."crawl_planning_stage_checkpoints" USING btree ("run_id","stage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_planning_stage_sequence_uq" ON "workbench"."crawl_planning_stage_checkpoints" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "source_collection_plan_planning_run_uq" ON "workbench"."source_collection_plans" USING btree ("planning_run_id") WHERE "workbench"."source_collection_plans"."planning_run_id" is not null;