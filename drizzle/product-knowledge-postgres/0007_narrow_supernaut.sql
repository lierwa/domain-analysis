CREATE TABLE "workbench"."source_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"asset_key" text NOT NULL,
	"source_url" text NOT NULL,
	"media_type" text NOT NULL,
	"dimensions_json" jsonb,
	"purpose" text NOT NULL,
	"block_index" integer NOT NULL,
	"position" integer NOT NULL,
	"privacy_class" text NOT NULL,
	"content_hash" text NOT NULL,
	"cas_integrity" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workbench"."source_assets" ADD CONSTRAINT "source_assets_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "workbench"."source_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_asset_snapshot_key_uq" ON "workbench"."source_assets" USING btree ("snapshot_id","asset_key");--> statement-breakpoint
CREATE INDEX "source_asset_integrity_idx" ON "workbench"."source_assets" USING btree ("cas_integrity");