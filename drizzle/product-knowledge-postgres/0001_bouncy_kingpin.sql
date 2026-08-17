CREATE TABLE "workbench"."category_interview_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"key" text NOT NULL,
	"question" text NOT NULL,
	"selection" text NOT NULL,
	"rationale" text NOT NULL,
	"status" text NOT NULL,
	"source_message_id" text NOT NULL,
	"supersedes_decision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workbench"."category_interview_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"delivery_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."category_interview_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"category_hint" text NOT NULL,
	"phase" text NOT NULL,
	"turn_state" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"codex_thread_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."category_interview_unresolved_items" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"owner" text NOT NULL,
	"status" text NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workbench"."category_research_brief_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"content_hash" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"project_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workbench"."category_interview_decisions" ADD CONSTRAINT "category_interview_decisions_session_id_category_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "workbench"."category_interview_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."category_interview_decisions" ADD CONSTRAINT "category_interview_decisions_source_message_id_category_interview_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "workbench"."category_interview_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."category_interview_messages" ADD CONSTRAINT "category_interview_messages_session_id_category_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "workbench"."category_interview_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."category_interview_unresolved_items" ADD CONSTRAINT "category_interview_unresolved_items_session_id_category_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "workbench"."category_interview_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."category_research_brief_versions" ADD CONSTRAINT "category_research_brief_versions_session_id_category_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "workbench"."category_interview_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."category_research_brief_versions" ADD CONSTRAINT "category_research_brief_versions_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_interview_decision_session_idx" ON "workbench"."category_interview_decisions" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "category_interview_message_sequence_uq" ON "workbench"."category_interview_messages" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "category_interview_session_time_idx" ON "workbench"."category_interview_sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "category_interview_unresolved_key_uq" ON "workbench"."category_interview_unresolved_items" USING btree ("session_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "category_research_brief_version_uq" ON "workbench"."category_research_brief_versions" USING btree ("session_id","version");--> statement-breakpoint
CREATE INDEX "category_research_brief_status_idx" ON "workbench"."category_research_brief_versions" USING btree ("session_id","status");