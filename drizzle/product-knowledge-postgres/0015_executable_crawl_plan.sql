ALTER TABLE "workbench"."category_interview_decisions" ALTER COLUMN "selection" DROP NOT NULL;

-- WHY：0014 已经在部分本机执行；旧结构化行必须退出当前确认路径，但历史内容继续保留。
UPDATE "workbench"."capture_task_draft_versions"
SET "status" = 'superseded'
WHERE "brief_markdown" LIKE '# 采访范围草案（历史版本）%';
