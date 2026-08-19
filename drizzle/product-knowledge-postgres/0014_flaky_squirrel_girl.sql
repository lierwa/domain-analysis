ALTER TABLE "workbench"."capture_task_draft_versions" RENAME COLUMN "content_json" TO "brief_markdown";
ALTER TABLE "workbench"."capture_task_draft_versions"
  ALTER COLUMN "brief_markdown" TYPE text
  USING (
    '# 采访范围草案（历史版本）' || E'\n\n'
    || '> 旧结构化记录，仅供历史审计，不可作为当前草案确认。' || E'\n\n'
    || jsonb_pretty("brief_markdown")
  );
UPDATE "workbench"."capture_task_draft_versions" SET "status" = 'superseded';
ALTER TABLE "workbench"."category_interview_decisions" ALTER COLUMN "selection" DROP NOT NULL;
