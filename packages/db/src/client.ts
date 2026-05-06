import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

/** 每条 createDb 连接对应一个 client，供 Vitest/Windows 在删库前显式 close，避免 EBUSY。 */
const libsqlClients = new WeakMap<object, ReturnType<typeof createClient>>();

export function createDb(databaseUrl = process.env.DATABASE_URL ?? "file:data/domain-analysis.sqlite") {
  const client = createClient({ url: databaseUrl });
  const db = drizzle(client, { schema });
  libsqlClients.set(db, client);
  return db;
}

export type AppDb = ReturnType<typeof createDb>;

/** WHY: 临时文件 SQLite 在连接未释放时 unlink 会 EBUSY；测试与进程退出前应释放。 */
export function closeDb(db: AppDb): void {
  const client = libsqlClients.get(db);
  if (client) {
    client.close();
  }
}

export async function initializeDatabase(
  databaseUrl = process.env.DATABASE_URL ?? "file:data/domain-analysis.sqlite"
) {
  await ensureSqliteDirectory(databaseUrl);
  const client = createClient({ url: databaseUrl });

  try {
  // WHY: MVP 使用 SQLite 单文件部署，不引入独立迁移服务；启动时建表能降低 2核2G 服务器的运维复杂度。
  // TRADE-OFF: 后续多人协作和复杂迁移增加后，应切换到 drizzle-kit 生成的显式 migration。
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      language TEXT NOT NULL,
      market TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS queries (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      name TEXT NOT NULL,
      include_keywords TEXT NOT NULL,
      exclude_keywords TEXT NOT NULL,
      platforms TEXT NOT NULL,
      language TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'manual',
      limit_per_run INTEGER NOT NULL DEFAULT 100,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS queries_topic_idx ON queries(topic_id);

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

    CREATE TABLE IF NOT EXISTS crawl_tasks (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      query_id TEXT NOT NULL REFERENCES queries(id),
      source_id TEXT NOT NULL REFERENCES sources(id),
      status TEXT NOT NULL DEFAULT 'pending',
      target_count INTEGER NOT NULL DEFAULT 100,
      collected_count INTEGER NOT NULL DEFAULT 0,
      valid_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS crawl_tasks_status_idx ON crawl_tasks(status);
    CREATE INDEX IF NOT EXISTS crawl_tasks_topic_idx ON crawl_tasks(topic_id);

    CREATE TABLE IF NOT EXISTS raw_contents (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id),
      query_id TEXT NOT NULL REFERENCES queries(id),
      topic_id TEXT NOT NULL REFERENCES topics(id),
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

    CREATE INDEX IF NOT EXISTS raw_contents_topic_idx ON raw_contents(topic_id);
    CREATE INDEX IF NOT EXISTS raw_contents_external_idx ON raw_contents(platform, external_id);

    CREATE TABLE IF NOT EXISTS cleaned_contents (
      id TEXT PRIMARY KEY,
      raw_content_id TEXT NOT NULL REFERENCES raw_contents(id),
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
      summary TEXT NOT NULL,
      content_type TEXT NOT NULL,
      topics TEXT NOT NULL,
      entities TEXT NOT NULL,
      intent TEXT NOT NULL,
      sentiment TEXT NOT NULL,
      insight_score INTEGER NOT NULL DEFAULT 0,
      opportunity_score INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      model_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trend_snapshots (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      date_range_start TEXT NOT NULL,
      date_range_end TEXT NOT NULL,
      volume_total INTEGER NOT NULL DEFAULT 0,
      volume_by_platform TEXT NOT NULL,
      sentiment_distribution TEXT NOT NULL,
      top_topics TEXT NOT NULL,
      top_keywords TEXT NOT NULL,
      top_contents TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      date_range_start TEXT NOT NULL,
      date_range_end TEXT NOT NULL,
      content_markdown TEXT NOT NULL,
      content_json TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS reports_topic_idx ON reports(topic_id);
  `);

  await ensureSourcesDefaultLimitColumn(client);
  } finally {
    client.close();
  }
}

async function ensureSqliteDirectory(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) return;

  const sqlitePath = databaseUrl.slice("file:".length);
  if (!sqlitePath || sqlitePath === ":memory:") return;

  await mkdir(dirname(sqlitePath), { recursive: true });
}

async function ensureSourcesDefaultLimitColumn(client: ReturnType<typeof createClient>) {
  try {
    // WHY: 当前 MVP 采用启动时建表，旧本地 SQLite 不会因 CREATE TABLE IF NOT EXISTS 自动补列。
    // TRADE-OFF: 这里保留最小迁移逻辑；正式迁移链路成熟后应交给 drizzle-kit migration。
    await client.execute("ALTER TABLE sources ADD COLUMN default_limit INTEGER NOT NULL DEFAULT 100");
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("duplicate column")) return;
    throw error;
  }
}
