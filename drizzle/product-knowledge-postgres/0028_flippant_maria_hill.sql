-- Drizzle 0024-0027 的 snapshot 未进入仓库；生成器因此重复列出已存在字段。
-- 本迁移只保留本轮 schema 相对已执行 0027 的真实增量。
ALTER TABLE "workbench"."source_collection_target_runs" ADD COLUMN "observed_unit_count" integer;
