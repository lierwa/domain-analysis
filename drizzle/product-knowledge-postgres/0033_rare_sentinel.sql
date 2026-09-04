CREATE TABLE "workbench"."knowledge_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"revision" integer NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."knowledge_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"input_key" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" jsonb NOT NULL,
	"result" jsonb,
	"derivative" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "workbench"."knowledge_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"selection" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."knowledge_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"source_revision" integer NOT NULL,
	"inputs" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"review_revision" integer DEFAULT 0 NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."knowledge_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"run_id" text NOT NULL,
	"number" integer NOT NULL,
	"generation" integer NOT NULL,
	"review_revision" integer NOT NULL,
	"input_hash" text NOT NULL,
	"status" text NOT NULL,
	"artifact" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_decisions" ADD CONSTRAINT "knowledge_decisions_run_id_knowledge_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "workbench"."knowledge_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_items" ADD CONSTRAINT "knowledge_items_run_id_knowledge_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "workbench"."knowledge_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_runs" ADD CONSTRAINT "knowledge_runs_pack_id_knowledge_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "workbench"."knowledge_packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_versions" ADD CONSTRAINT "knowledge_versions_pack_id_knowledge_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "workbench"."knowledge_packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_versions" ADD CONSTRAINT "knowledge_versions_run_id_knowledge_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "workbench"."knowledge_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_decision_run_revision_uq" ON "workbench"."knowledge_decisions" USING btree ("run_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_item_run_input_uq" ON "workbench"."knowledge_items" USING btree ("run_id","input_key");--> statement-breakpoint
CREATE INDEX "knowledge_run_pack_idx" ON "workbench"."knowledge_runs" USING btree ("pack_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_version_pack_number_uq" ON "workbench"."knowledge_versions" USING btree ("pack_id","number");