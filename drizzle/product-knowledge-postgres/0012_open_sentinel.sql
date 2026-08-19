CREATE TABLE "workbench"."crawl_planning_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"task_revision" integer NOT NULL,
	"instruction" text,
	"status" text NOT NULL,
	"timeline_parts_json" jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" ADD COLUMN "planning_run_id" text;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workbench"."crawl_planning_runs" ADD CONSTRAINT "crawl_planning_runs_task_id_capture_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "workbench"."capture_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_planning_run_task_time_idx" ON "workbench"."crawl_planning_runs" USING btree ("task_id","started_at");--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_plans" ADD CONSTRAINT "source_collection_plans_planning_run_id_crawl_planning_runs_id_fk" FOREIGN KEY ("planning_run_id") REFERENCES "workbench"."crawl_planning_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_collection_plan_task_version_uq" ON "workbench"."source_collection_plans" USING btree ("task_id","version") WHERE "workbench"."source_collection_plans"."planning_run_id" is not null;