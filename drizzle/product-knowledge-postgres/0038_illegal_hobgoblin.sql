CREATE TABLE "workbench"."knowledge_ai_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"issue_fingerprint" text NOT NULL,
	"generation" integer NOT NULL,
	"review_revision" integer NOT NULL,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"reasoning_effort" text NOT NULL,
	"recommendations" jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_ai_reviews" ADD CONSTRAINT "knowledge_ai_reviews_run_id_knowledge_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "workbench"."knowledge_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_ai_review_run_fingerprint_uq" ON "workbench"."knowledge_ai_reviews" USING btree ("run_id","issue_fingerprint");