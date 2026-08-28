ALTER TABLE "workbench"."source_collection_batches" ADD COLUMN "command_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "source_collection_batch_command_uq" ON "workbench"."source_collection_batches" USING btree ("command_id") WHERE "workbench"."source_collection_batches"."command_id" is not null;
ALTER TABLE "workbench"."category_interview_sessions" ADD COLUMN "model_id" text DEFAULT 'gpt-5.6-terra' NOT NULL;--> statement-breakpoint
ALTER TABLE "workbench"."category_interview_sessions" ADD COLUMN "reasoning_effort" text DEFAULT 'medium' NOT NULL;
