CREATE TABLE "workbench"."category_definition_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"category_code" text NOT NULL,
	"label" text NOT NULL,
	"market" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workbench"."collection_board_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"confirmed_scope_version_id" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workbench"."confirmed_scope_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"category_definition_version_id" text NOT NULL,
	"market" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workbench"."evidence_items" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"observation_id" text NOT NULL,
	"subject_keys_json" jsonb NOT NULL,
	"kind" text NOT NULL,
	"privacy_class" text NOT NULL,
	"content_integrity" text NOT NULL,
	"content_bytes" integer NOT NULL,
	"manifest_integrity" text NOT NULL,
	"evidence_policy_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."evidence_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"category_definition_version_id" text NOT NULL,
	"confirmed_scope_version_id" text NOT NULL,
	"collection_board_version_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."product_knowledge_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"knowledge_topic" text NOT NULL,
	"market" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench"."source_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"source_identity" text NOT NULL,
	"source_authority_type" text NOT NULL,
	"final_url" text,
	"state" text NOT NULL,
	"observation_json" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workbench"."category_definition_versions" ADD CONSTRAINT "category_definition_versions_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."collection_board_versions" ADD CONSTRAINT "collection_board_versions_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."collection_board_versions" ADD CONSTRAINT "collection_board_versions_confirmed_scope_version_id_confirmed_scope_versions_id_fk" FOREIGN KEY ("confirmed_scope_version_id") REFERENCES "workbench"."confirmed_scope_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."confirmed_scope_versions" ADD CONSTRAINT "confirmed_scope_versions_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."confirmed_scope_versions" ADD CONSTRAINT "confirmed_scope_versions_category_definition_version_id_category_definition_versions_id_fk" FOREIGN KEY ("category_definition_version_id") REFERENCES "workbench"."category_definition_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."evidence_items" ADD CONSTRAINT "evidence_items_request_id_evidence_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "workbench"."evidence_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."evidence_items" ADD CONSTRAINT "evidence_items_observation_id_source_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "workbench"."source_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."evidence_requests" ADD CONSTRAINT "evidence_requests_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."evidence_requests" ADD CONSTRAINT "evidence_requests_category_definition_version_id_category_definition_versions_id_fk" FOREIGN KEY ("category_definition_version_id") REFERENCES "workbench"."category_definition_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."evidence_requests" ADD CONSTRAINT "evidence_requests_confirmed_scope_version_id_confirmed_scope_versions_id_fk" FOREIGN KEY ("confirmed_scope_version_id") REFERENCES "workbench"."confirmed_scope_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."evidence_requests" ADD CONSTRAINT "evidence_requests_collection_board_version_id_collection_board_versions_id_fk" FOREIGN KEY ("collection_board_version_id") REFERENCES "workbench"."collection_board_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."source_observations" ADD CONSTRAINT "source_observations_request_id_evidence_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "workbench"."evidence_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_definition_project_version_uq" ON "workbench"."category_definition_versions" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "category_definition_project_status_idx" ON "workbench"."category_definition_versions" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_board_project_version_uq" ON "workbench"."collection_board_versions" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "collection_board_project_status_idx" ON "workbench"."collection_board_versions" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "confirmed_scope_project_version_uq" ON "workbench"."confirmed_scope_versions" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "confirmed_scope_project_status_idx" ON "workbench"."confirmed_scope_versions" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_item_request_manifest_uq" ON "workbench"."evidence_items" USING btree ("request_id","manifest_integrity");--> statement-breakpoint
CREATE INDEX "evidence_item_request_time_idx" ON "workbench"."evidence_items" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_item_content_idx" ON "workbench"."evidence_items" USING btree ("content_integrity");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_request_project_hash_uq" ON "workbench"."evidence_requests" USING btree ("project_id","content_hash");--> statement-breakpoint
CREATE INDEX "evidence_request_project_time_idx" ON "workbench"."evidence_requests" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "source_observation_request_time_idx" ON "workbench"."source_observations" USING btree ("request_id","observed_at");--> statement-breakpoint
CREATE INDEX "source_observation_request_state_idx" ON "workbench"."source_observations" USING btree ("request_id","state");