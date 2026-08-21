CREATE TABLE "workbench"."source_resource_references" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_url" text NOT NULL,
	"role" text NOT NULL,
	"section" text NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workbench"."source_resource_references" ADD CONSTRAINT "source_resource_references_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "workbench"."source_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_resource_reference_position_uq" ON "workbench"."source_resource_references" USING btree ("snapshot_id","kind","role","section","ordinal","source_url");--> statement-breakpoint
CREATE INDEX "source_resource_reference_snapshot_idx" ON "workbench"."source_resource_references" USING btree ("snapshot_id");