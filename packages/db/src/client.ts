import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export function getDefaultDatabaseUrl() {
  const dbPackageDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(dbPackageDir, "../../..");
  return `file:${resolve(repoRoot, "data/domain-analysis.sqlite")}`;
}

export function createDb(databaseUrl = process.env.DATABASE_URL ?? getDefaultDatabaseUrl()) {
  const client = createClient({ url: databaseUrl });
  return drizzle(client, { schema });
}

export type AppDb = ReturnType<typeof createDb>;

export async function initializeDatabase(
  databaseUrl = process.env.DATABASE_URL ?? getDefaultDatabaseUrl()
) {
  await ensureSqliteDirectory(databaseUrl);
  const client = createClient({ url: databaseUrl });

  // WHY: 当前仍是测试阶段的大重构，DDL 负责新库；少量追加字段用轻量迁移保护本地旧库。
  // TRADE-OFF: 这不是正式 migration 系统，只处理向后兼容的 nullable/default 新列。
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
      platforms TEXT NOT NULL DEFAULT '["reddit"]',
      browser_mode TEXT NOT NULL DEFAULT 'local_profile',
      max_scrolls_per_platform INTEGER NOT NULL DEFAULT 5,
      max_items_per_platform INTEGER NOT NULL DEFAULT 50,
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
      platforms TEXT NOT NULL DEFAULT '["reddit"]',
      browser_mode TEXT NOT NULL DEFAULT 'local_profile',
      max_scrolls_per_platform INTEGER NOT NULL DEFAULT 5,
      max_items_per_platform INTEGER NOT NULL DEFAULT 50,
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
      platform TEXT NOT NULL DEFAULT 'reddit',
      status TEXT NOT NULL DEFAULT 'pending',
      target_count INTEGER NOT NULL DEFAULT 100,
      collected_count INTEGER NOT NULL DEFAULT 0,
      valid_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      pages_collected INTEGER NOT NULL DEFAULT 0,
      last_cursor TEXT,
      stop_reason TEXT,
      last_request_at TEXT,
      next_request_at TEXT,
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

  await ensureColumn(client, "analysis_runs", "collection_plan_id", "TEXT REFERENCES collection_plans(id)");
  await ensureColumn(client, "analysis_runs", "run_trigger", "TEXT NOT NULL DEFAULT 'manual'");
  await ensureColumn(client, "analysis_runs", "platforms", "TEXT NOT NULL DEFAULT '[\"reddit\"]'");
  await ensureColumn(client, "analysis_runs", "browser_mode", "TEXT NOT NULL DEFAULT 'local_profile'");
  await ensureColumn(client, "analysis_runs", "max_scrolls_per_platform", "INTEGER NOT NULL DEFAULT 5");
  await ensureColumn(client, "analysis_runs", "max_items_per_platform", "INTEGER NOT NULL DEFAULT 50");
  await ensureColumn(client, "collection_plans", "platforms", "TEXT NOT NULL DEFAULT '[\"reddit\"]'");
  await ensureColumn(client, "collection_plans", "browser_mode", "TEXT NOT NULL DEFAULT 'local_profile'");
  await ensureColumn(client, "collection_plans", "max_scrolls_per_platform", "INTEGER NOT NULL DEFAULT 5");
  await ensureColumn(client, "collection_plans", "max_items_per_platform", "INTEGER NOT NULL DEFAULT 50");
  await ensureColumn(client, "crawl_tasks", "collection_plan_id", "TEXT REFERENCES collection_plans(id)");
  await ensureColumn(client, "crawl_tasks", "platform", "TEXT NOT NULL DEFAULT 'reddit'");
  await ensureColumn(client, "crawl_tasks", "error_message", "TEXT");
  await ensureColumn(client, "crawl_tasks", "pages_collected", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(client, "crawl_tasks", "last_cursor", "TEXT");
  await ensureColumn(client, "crawl_tasks", "stop_reason", "TEXT");
  await ensureColumn(client, "crawl_tasks", "last_request_at", "TEXT");
  await ensureColumn(client, "crawl_tasks", "next_request_at", "TEXT");
  await ensureColumn(client, "crawl_tasks", "started_at", "TEXT");
  await ensureColumn(client, "crawl_tasks", "finished_at", "TEXT");
  await ensureColumn(client, "crawl_tasks", "scheduled_at", "TEXT");
}

async function ensureSqliteDirectory(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) return;

  const sqlitePath = databaseUrl.slice("file:".length);
  if (!sqlitePath || sqlitePath === ":memory:") return;

  await mkdir(dirname(sqlitePath), { recursive: true });
}

async function ensureColumn(
  client: ReturnType<typeof createClient>,
  tableName: string,
  columnName: string,
  columnDefinition: string
) {
  const tableInfo = await client.execute(`PRAGMA table_info(${tableName})`);
  if (tableInfo.rows.length === 0) return;

  const hasColumn = tableInfo.rows.some((row) => row.name === columnName);
  if (hasColumn) return;

  await client.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}
