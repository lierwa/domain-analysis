ALTER TABLE "workbench"."knowledge_packs" ADD COLUMN "selection_revision" integer DEFAULT 1 NOT NULL;
UPDATE "workbench"."knowledge_packs" AS p
SET "selection_revision" = COALESCE((
  SELECT r."source_revision"
  FROM "workbench"."knowledge_runs" AS r
  WHERE r."pack_id" = p."id"
  ORDER BY r."created_at" DESC
  LIMIT 1
), p."revision");
