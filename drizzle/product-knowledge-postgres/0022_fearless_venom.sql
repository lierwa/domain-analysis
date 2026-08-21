CREATE TABLE "workbench"."source_collection_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"source_collection_plan_id" text NOT NULL,
	"source_collection_plan_version" integer NOT NULL,
	"task_revision" integer NOT NULL,
	"status" text NOT NULL,
	"planned_source_count" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"termination_reason" text
);
--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD COLUMN "execution_batch_id" text;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_batches" ADD CONSTRAINT "source_collection_batches_task_id_capture_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "workbench"."capture_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_batches" ADD CONSTRAINT "source_collection_batches_source_collection_plan_id_source_collection_plans_id_fk" FOREIGN KEY ("source_collection_plan_id") REFERENCES "workbench"."source_collection_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_collection_batch_task_time_idx" ON "workbench"."source_collection_batches" USING btree ("task_id","started_at");--> statement-breakpoint
CREATE INDEX "source_collection_batch_plan_idx" ON "workbench"."source_collection_batches" USING btree ("source_collection_plan_id","source_collection_plan_version");--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD CONSTRAINT "source_collection_runs_execution_batch_id_source_collection_batches_id_fk" FOREIGN KEY ("execution_batch_id") REFERENCES "workbench"."source_collection_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_collection_run_batch_idx" ON "workbench"."source_collection_runs" USING btree ("execution_batch_id");