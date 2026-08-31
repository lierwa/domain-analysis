CREATE TABLE "workbench"."source_capture_subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_batch_id" text NOT NULL,
	"source_key" text NOT NULL,
	"kind" text NOT NULL,
	"source_entity_id" text NOT NULL,
	"display_name" text NOT NULL,
	"parent_subject_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workbench"."source_capture_work_items" ADD COLUMN "subject_id" text;--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" ADD COLUMN "capture_work_item_id" text;--> statement-breakpoint
ALTER TABLE "workbench"."source_capture_subjects" ADD CONSTRAINT "source_capture_subjects_execution_batch_id_source_collection_batches_id_fk" FOREIGN KEY ("execution_batch_id") REFERENCES "workbench"."source_collection_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_capture_subjects" ADD CONSTRAINT "source_capture_subjects_parent_subject_id_source_capture_subjects_id_fk" FOREIGN KEY ("parent_subject_id") REFERENCES "workbench"."source_capture_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_capture_subject_identity_uq" ON "workbench"."source_capture_subjects" USING btree ("execution_batch_id","source_key","kind","source_entity_id");--> statement-breakpoint
CREATE INDEX "source_capture_subject_parent_idx" ON "workbench"."source_capture_subjects" USING btree ("parent_subject_id");--> statement-breakpoint
CREATE INDEX "source_capture_subject_batch_idx" ON "workbench"."source_capture_subjects" USING btree ("execution_batch_id","source_key");--> statement-breakpoint
ALTER TABLE "workbench"."source_capture_work_items" ADD CONSTRAINT "source_capture_work_items_subject_id_source_capture_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "workbench"."source_capture_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_snapshots" ADD CONSTRAINT "source_snapshots_capture_work_item_id_source_capture_work_items_id_fk" FOREIGN KEY ("capture_work_item_id") REFERENCES "workbench"."source_capture_work_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_capture_work_subject_idx" ON "workbench"."source_capture_work_items" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_collection_batch_active_task_uq" ON "workbench"."source_collection_batches" USING btree ("task_id") WHERE "workbench"."source_collection_batches"."status" = 'running' or "workbench"."source_collection_batches"."recovery_state" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "source_snapshot_capture_work_idx" ON "workbench"."source_snapshots" USING btree ("capture_work_item_id");