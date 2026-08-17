CREATE TABLE "workbench"."market_universe_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"category_definition_version_id" text NOT NULL,
	"confirmed_scope_version_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"content_hash" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workbench"."market_universe_versions" ADD CONSTRAINT "market_universe_versions_project_id_product_knowledge_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "workbench"."product_knowledge_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."market_universe_versions" ADD CONSTRAINT "market_universe_versions_category_definition_version_id_category_definition_versions_id_fk" FOREIGN KEY ("category_definition_version_id") REFERENCES "workbench"."category_definition_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench"."market_universe_versions" ADD CONSTRAINT "market_universe_versions_confirmed_scope_version_id_confirmed_scope_versions_id_fk" FOREIGN KEY ("confirmed_scope_version_id") REFERENCES "workbench"."confirmed_scope_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "market_universe_project_version_uq" ON "workbench"."market_universe_versions" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "market_universe_project_status_idx" ON "workbench"."market_universe_versions" USING btree ("project_id","status");