ALTER TABLE "workbench"."knowledge_packs" ADD COLUMN "skill_name" text;--> statement-breakpoint
UPDATE "workbench"."knowledge_packs"
SET "skill_name" = 'knowledge-' || substring(md5("id") from 1 for 12);--> statement-breakpoint
UPDATE "workbench"."knowledge_packs" AS pack
SET "selection" = COALESCE((
	SELECT jsonb_agg(selected.ref ORDER BY selected.ref->>'batchId')
	FROM (
		SELECT DISTINCT jsonb_build_object(
			'taskId', item->>'taskId',
			'batchId', run.execution_batch_id
		) AS ref
		FROM jsonb_array_elements(pack."selection") AS item
		JOIN "workbench"."source_collection_runs" AS run ON run.id = item->>'runId'
		WHERE item ? 'runId' AND run.execution_batch_id IS NOT NULL
	) AS selected
), '[]'::jsonb);--> statement-breakpoint
ALTER TABLE "workbench"."knowledge_packs" ALTER COLUMN "skill_name" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_pack_skill_name_uq" ON "workbench"."knowledge_packs" USING btree ("skill_name");
