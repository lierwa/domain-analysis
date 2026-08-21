CREATE TABLE "workbench"."source_access_gate_states" (
	"key" text PRIMARY KEY NOT NULL,
	"provider_key" text NOT NULL,
	"provider_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"circuit_state" text NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_eligible_at" timestamp with time zone,
	"window_started_at" timestamp with time zone,
	"window_request_count" integer DEFAULT 0 NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_reason" text,
	"manual_resume_required" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."source_capture_work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"target_key" text NOT NULL,
	"work_key" text NOT NULL,
	"parent_object_key" text,
	"capture_unit" text NOT NULL,
	"expected_unit_count" integer,
	"observed_unit_count" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"termination_reason" text
);
--> statement-breakpoint
CREATE TABLE "workbench"."source_request_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"target_key" text NOT NULL,
	"work_key" text NOT NULL,
	"gate_key" text NOT NULL,
	"requested_url" text NOT NULL,
	"origin" text NOT NULL,
	"redirect_parent_attempt_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"final_url" text,
	"http_status" integer,
	"bytes" integer,
	"state" text NOT NULL,
	"restriction_reason" text
);
--> statement-breakpoint
ALTER TABLE "workbench"."source_collection_runs" ADD COLUMN "request_budget" integer;--> statement-breakpoint
ALTER TABLE "workbench"."source_capture_work_items" ADD CONSTRAINT "source_capture_work_items_run_id_source_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "workbench"."source_collection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_request_attempts" ADD CONSTRAINT "source_request_attempts_run_id_source_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "workbench"."source_collection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_request_attempts" ADD CONSTRAINT "source_request_attempts_gate_key_source_access_gate_states_key_fk" FOREIGN KEY ("gate_key") REFERENCES "workbench"."source_access_gate_states"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_capture_work_run_key_uq" ON "workbench"."source_capture_work_items" USING btree ("run_id","work_key");--> statement-breakpoint
CREATE INDEX "source_capture_work_status_idx" ON "workbench"."source_capture_work_items" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "source_request_attempt_run_time_idx" ON "workbench"."source_request_attempts" USING btree ("run_id","started_at");--> statement-breakpoint
CREATE INDEX "source_request_attempt_gate_time_idx" ON "workbench"."source_request_attempts" USING btree ("gate_key","started_at");