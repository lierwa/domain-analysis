import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export function createDb(databaseUrl = process.env.DATABASE_URL ?? "file:data/domain-analysis.sqlite") {
  const client = createClient({ url: databaseUrl });
  return drizzle(client, { schema });
}

export type AppDb = ReturnType<typeof createDb>;

export async function initializeDatabase(
  databaseUrl = process.env.DATABASE_URL ?? "file:data/domain-analysis.sqlite"
) {
  await ensureSqliteDirectory(databaseUrl);
  const client = createClient({ url: databaseUrl });

  // WHY: 当前仍是测试阶段的大重构，不为旧 SQLite schema 写兼容迁移。
  // TRADE-OFF: 如果已有本地旧库，需要手动清空/重建；后续稳定后再引入正式 migration。
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      requires_login INTEGER NOT NULL DEFAULT 0,
      crawler_type TEXT NOT NULL DEFAULT 'cheerio',
      default_limit INTEGER NOT NULL DEFAULT 100,
      rate_limit_config TEXT,
      login_profile_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS analysis_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      goal TEXT NOT NULL,
      language TEXT NOT NULL,
      market TEXT NOT NULL,
      default_platform TEXT NOT NULL DEFAULT 'reddit',
      default_limit INTEGER NOT NULL DEFAULT 100,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS collection_plans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES analysis_projects(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      platform TEXT NOT NULL DEFAULT 'reddit',
      include_keywords TEXT NOT NULL,
      exclude_keywords TEXT NOT NULL,
      language TEXT NOT NULL,
      market TEXT NOT NULL,
      cadence TEXT NOT NULL DEFAULT 'daily',
      batch_limit INTEGER NOT NULL DEFAULT 100,
      max_runs_per_day INTEGER NOT NULL DEFAULT 4,
      last_run_at TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS collection_plans_project_idx ON collection_plans(project_id);
    CREATE INDEX IF NOT EXISTS collection_plans_status_next_run_idx ON collection_plans(status, next_run_at);

    CREATE TABLE IF NOT EXISTS analysis_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES analysis_projects(id),
      collection_plan_id TEXT REFERENCES collection_plans(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      run_trigger TEXT NOT NULL DEFAULT 'manual',
      include_keywords TEXT NOT NULL,
      exclude_keywords TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'reddit',
      run_limit INTEGER NOT NULL DEFAULT 100,
      collected_count INTEGER NOT NULL DEFAULT 0,
      valid_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      analyzed_count INTEGER NOT NULL DEFAULT 0,
      report_id TEXT,
      error_message TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS analysis_runs_project_idx ON analysis_runs(project_id);
    CREATE INDEX IF NOT EXISTS analysis_runs_status_idx ON analysis_runs(status);

    CREATE TABLE IF NOT EXISTS crawl_tasks (
      id TEXT PRIMARY KEY,
      analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id),
      collection_plan_id TEXT REFERENCES collection_plans(id),
      source_id TEXT NOT NULL REFERENCES sources(id),
      status TEXT NOT NULL DEFAULT 'pending',
      target_count INTEGER NOT NULL DEFAULT 100,
      collected_count INTEGER NOT NULL DEFAULT 0,
      valid_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TEXT,
      finished_at TEXT,
      scheduled_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS crawl_tasks_status_idx ON crawl_tasks(status);
    CREATE INDEX IF NOT EXISTS crawl_tasks_run_idx ON crawl_tasks(analysis_run_id);

    CREATE TABLE IF NOT EXISTS raw_contents (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      analysis_project_id TEXT NOT NULL REFERENCES analysis_projects(id),
      analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id),
      crawl_task_id TEXT NOT NULL REFERENCES crawl_tasks(id),
      matched_keywords TEXT NOT NULL,
      external_id TEXT,
      url TEXT NOT NULL,
      author_name TEXT,
      author_handle TEXT,
      text TEXT NOT NULL,
      media_urls TEXT,
      metrics_json TEXT,
      published_at TEXT,
      captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      raw_json TEXT,
      raw_html_path TEXT,
      screenshot_path TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS raw_contents_run_idx ON raw_contents(analysis_run_id);
    CREATE INDEX IF NOT EXISTS raw_contents_external_idx ON raw_contents(platform, external_id);

    CREATE TABLE IF NOT EXISTS cleaned_contents (
      id TEXT PRIMARY KEY,
      raw_content_id TEXT NOT NULL REFERENCES raw_contents(id),
      analysis_run_id TEXT REFERENCES analysis_runs(id),
      normalized_text TEXT NOT NULL,
      language TEXT NOT NULL,
      is_duplicate INTEGER NOT NULL DEFAULT 0,
      is_ad INTEGER NOT NULL DEFAULT 0,
      is_irrelevant INTEGER NOT NULL DEFAULT 0,
      quality_score INTEGER NOT NULL DEFAULT 0,
      engagement_score INTEGER NOT NULL DEFAULT 0,
      clean_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS analyzed_contents (
      id TEXT PRIMARY KEY,
      raw_content_id TEXT NOT NULL REFERENCES raw_contents(id),
      analysis_run_id TEXT REFERENCES analysis_runs(id),
      summary TEXT NOT NULL,
      content_type TEXT NOT NULL,
      topics TEXT NOT NULL,
      entities TEXT NOT NULL,
      intent TEXT NOT NULL,
      sentiment TEXT NOT NULL,
      insight_score INTEGER NOT NULL DEFAULT 0,
      opportunity_score INTEGER NOT NULL DEFAULT 0,
      content_opportunity TEXT,
      reason TEXT NOT NULL,
      model_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES analysis_projects(id),
      analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id),
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      content_markdown TEXT NOT NULL DEFAULT '',
      content_json TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS reports_run_idx ON reports(analysis_run_id);
  `);
}

async function ensureSqliteDirectory(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) return;

  const sqlitePath = databaseUrl.slice("file:".length);
  if (!sqlitePath || sqlitePath === ":memory:") return;

  await mkdir(dirname(sqlitePath), { recursive: true });
}
