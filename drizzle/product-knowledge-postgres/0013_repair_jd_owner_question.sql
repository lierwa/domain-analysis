UPDATE "workbench"."category_interview_unresolved_items"
SET
	"status" = 'resolved',
	"resolution" = '京东覆盖由平台默认来源策略确定，不再需要负责人确认。',
	"resolved_at" = COALESCE("resolved_at", NOW())
WHERE "key" = 'jd.scope' AND "status" = 'open';
--> statement-breakpoint
UPDATE "workbench"."category_interview_decisions" AS "decision"
SET "status" = 'superseded'
WHERE "decision"."key" = 'jd.scope'
	AND (
		"decision"."status" = 'proposed'
		OR (
			"decision"."status" = 'confirmed'
			AND NOT EXISTS (
				SELECT 1
				FROM "workbench"."capture_task_draft_versions" AS "draft"
				WHERE "draft"."session_id" = "decision"."session_id"
			)
		)
	);
