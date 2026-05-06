import { and, desc, eq } from "drizzle-orm";
import type { Platform, TaskStatus, TopicStatus } from "@domain-analysis/shared";
import type { AppDb } from "./client";
import { crawlTasks, queries, rawContents, sources, topics } from "./schema";

type TopicRow = typeof topics.$inferSelect;
type QueryRow = typeof queries.$inferSelect;
type SourceRow = typeof sources.$inferSelect;
type CrawlTaskRow = typeof crawlTasks.$inferSelect;
type RawContentRow = typeof rawContents.$inferSelect;

export interface CreateTopicInput {
  name: string;
  description?: string;
  language: string;
  market: string;
}

export interface UpdateTopicInput {
  name?: string;
  description?: string;
  language?: string;
  market?: string;
  status?: TopicStatus;
}

export interface CreateQueryInput {
  topicId: string;
  name: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  platforms: Platform[];
  language: string;
  frequency: "manual" | "hourly" | "daily" | "weekly";
  limitPerRun: number;
}

export interface UpdateQueryInput {
  name?: string;
  includeKeywords?: string[];
  excludeKeywords?: string[];
  platforms?: Platform[];
  language?: string;
  frequency?: "manual" | "hourly" | "daily" | "weekly";
  limitPerRun?: number;
  status?: TopicStatus;
}

export interface CreateSourceInput {
  platform: Platform;
  name: string;
  enabled?: boolean;
  requiresLogin?: boolean;
  crawlerType?: "cheerio" | "playwright";
  defaultLimit?: number;
}

export interface CreateCrawlTaskInput {
  topicId: string;
  queryId: string;
  sourceId: string;
  targetCount: number;
}

export interface UpdateCrawlTaskInput {
  status?: TaskStatus;
  collectedCount?: number;
  validCount?: number;
  duplicateCount?: number;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface CreateRawContentInput {
  platform: Platform;
  sourceId: string;
  queryId: string;
  topicId: string;
  externalId?: string;
  url: string;
  authorName?: string;
  authorHandle?: string;
  text: string;
  metricsJson?: Record<string, unknown>;
  publishedAt?: string;
  rawJson?: Record<string, unknown>;
}

const defaultSources: CreateSourceInput[] = [
  { platform: "reddit", name: "Reddit", requiresLogin: false, crawlerType: "cheerio", defaultLimit: 100 },
  { platform: "x", name: "X / Twitter", requiresLogin: false, crawlerType: "cheerio", defaultLimit: 25 },
  { platform: "youtube", name: "YouTube", requiresLogin: false, crawlerType: "cheerio", defaultLimit: 50 },
  { platform: "pinterest", name: "Pinterest", requiresLogin: true, crawlerType: "playwright", defaultLimit: 50 },
  { platform: "web", name: "Web Pages", requiresLogin: false, crawlerType: "cheerio", defaultLimit: 100 }
];

export function createTopicRepository(db: AppDb) {
  return {
    async create(input: CreateTopicInput) {
      const [row] = await db
        .insert(topics)
        .values({
          id: createId("topic"),
          name: input.name,
          description: input.description,
          language: input.language,
          market: input.market,
          status: "active"
        })
        .returning();
      return mapTopic(requireRow(row, "topic_create_failed"));
    },

    async list() {
      const rows = await db.select().from(topics);
      return rows.map(mapTopic);
    },

    async update(id: string, input: UpdateTopicInput) {
      const [row] = await db
        .update(topics)
        .set({ ...input, updatedAt: new Date().toISOString() })
        .where(eq(topics.id, id))
        .returning();
      return row ? mapTopic(row) : null;
    },

    async remove(id: string) {
      // WHY: Topic 是 Query 的父级；删除 Topic 时先清理 Query，避免 SQLite 外键约束导致 500。
      // TRADE-OFF: 这是阶段 1 的硬删除策略，后续有任务和内容后应改为软删除/归档。
      await db.delete(queries).where(eq(queries.topicId, id));
      await db.delete(topics).where(eq(topics.id, id));
    }
  };
}

export function createQueryRepository(db: AppDb) {
  return {
    async create(input: CreateQueryInput) {
      const [row] = await db
        .insert(queries)
        .values({
          id: createId("query"),
          topicId: input.topicId,
          name: input.name,
          includeKeywords: input.includeKeywords,
          excludeKeywords: input.excludeKeywords,
          platforms: input.platforms,
          language: input.language,
          frequency: input.frequency,
          limitPerRun: input.limitPerRun,
          status: "active"
        })
        .returning();
      return mapQuery(requireRow(row, "query_create_failed"));
    },

    async listByTopic(topicId: string) {
      const rows = await db.select().from(queries).where(eq(queries.topicId, topicId));
      return rows.map(mapQuery);
    },

    async getById(id: string) {
      const [row] = await db.select().from(queries).where(eq(queries.id, id));
      return row ? mapQuery(row) : null;
    },

    async update(id: string, input: UpdateQueryInput) {
      const [row] = await db
        .update(queries)
        .set({ ...input, updatedAt: new Date().toISOString() })
        .where(eq(queries.id, id))
        .returning();
      return row ? mapQuery(row) : null;
    },

    async remove(id: string) {
      await db.delete(queries).where(eq(queries.id, id));
    }
  };
}

export function createSourceRepository(db: AppDb) {
  return {
    async seedDefaults() {
      // WHY: 阶段 1 需要开箱即用的数据源配置；使用 upsert 避免重复启动造成重复数据。
      // TRADE-OFF: 默认源固定在代码中，等 Source 管理成熟后再迁移为可编辑 seed 配置。
      for (const source of defaultSources) {
        await db
          .insert(sources)
          .values({
            id: createId("source"),
            platform: source.platform,
            name: source.name,
            enabled: source.enabled ?? true,
            requiresLogin: source.requiresLogin ?? false,
            crawlerType: source.crawlerType ?? "cheerio",
            defaultLimit: source.defaultLimit ?? 100
          })
          .onConflictDoNothing({ target: sources.platform });
      }
    },

    async create(input: CreateSourceInput) {
      const [row] = await db
        .insert(sources)
        .values({
          id: createId("source"),
          platform: input.platform,
          name: input.name,
          enabled: input.enabled ?? true,
          requiresLogin: input.requiresLogin ?? false,
          crawlerType: input.crawlerType ?? "cheerio",
          defaultLimit: input.defaultLimit ?? 100
        })
        .onConflictDoUpdate({
          target: sources.platform,
          set: {
            name: input.name,
            enabled: input.enabled ?? true,
            requiresLogin: input.requiresLogin ?? false,
            crawlerType: input.crawlerType ?? "cheerio",
            defaultLimit: input.defaultLimit ?? 100,
            updatedAt: new Date().toISOString()
          }
        })
        .returning();
      return mapSource(requireRow(row, "source_create_failed"));
    },

    async list() {
      const rows = await db.select().from(sources);
      const order = new Map(defaultSources.map((source, index) => [source.platform, index]));
      return rows
        .map(mapSource)
        .sort((left, right) => (order.get(left.platform) ?? 99) - (order.get(right.platform) ?? 99));
    },

    async getByPlatform(platform: Platform) {
      const [row] = await db.select().from(sources).where(eq(sources.platform, platform));
      return row ? mapSource(row) : null;
    },

    async updateEnabled(platform: Platform, enabled: boolean) {
      const [row] = await db
        .update(sources)
        .set({ enabled, updatedAt: new Date().toISOString() })
        .where(eq(sources.platform, platform))
        .returning();
      return row ? mapSource(row) : null;
    }
  };
}

export function createCrawlTaskRepository(db: AppDb) {
  return {
    async create(input: CreateCrawlTaskInput) {
      const [row] = await db
        .insert(crawlTasks)
        .values({
          id: createId("task"),
          topicId: input.topicId,
          queryId: input.queryId,
          sourceId: input.sourceId,
          targetCount: input.targetCount,
          status: "pending"
        })
        .returning();
      return mapCrawlTask(requireRow(row, "crawl_task_create_failed"));
    },

    async list() {
      const rows = await db.select().from(crawlTasks).orderBy(desc(crawlTasks.createdAt));
      return rows.map(mapCrawlTask);
    },

    async update(id: string, input: UpdateCrawlTaskInput) {
      const [row] = await db
        .update(crawlTasks)
        .set({ ...input, updatedAt: new Date().toISOString() })
        .where(eq(crawlTasks.id, id))
        .returning();
      return row ? mapCrawlTask(row) : null;
    },

    async remove(id: string) {
      await db.delete(crawlTasks).where(eq(crawlTasks.id, id));
    },

    async removeFinished() {
      const finishedStatuses: TaskStatus[] = [
        "success",
        "failed",
        "no_content",
        "paused",
        "login_required",
        "rate_limited",
        "parse_failed"
      ];
      const rows = await db.select().from(crawlTasks);
      const finishedRows = rows.filter((row) => finishedStatuses.includes(row.status as TaskStatus));

      for (const row of finishedRows) {
        await db.delete(crawlTasks).where(eq(crawlTasks.id, row.id));
      }
      return finishedRows.length;
    }
  };
}

export function createRawContentRepository(db: AppDb) {
  return {
    async createMany(inputs: CreateRawContentInput[]) {
      const items = [];
      let duplicates = 0;

      for (const input of inputs) {
        if (input.externalId) {
          const [existing] = await db
            .select()
            .from(rawContents)
            .where(
              and(eq(rawContents.platform, input.platform), eq(rawContents.externalId, input.externalId))
            );
          if (existing) {
            duplicates += 1;
            continue;
          }
        }

        const [row] = await db
          .insert(rawContents)
          .values({
            id: createId("raw"),
            platform: input.platform,
            sourceId: input.sourceId,
            queryId: input.queryId,
            topicId: input.topicId,
            externalId: input.externalId,
            url: input.url,
            authorName: input.authorName,
            authorHandle: input.authorHandle,
            text: input.text,
            metricsJson: input.metricsJson,
            publishedAt: input.publishedAt,
            rawJson: input.rawJson
          })
          .returning();
        items.push(mapRawContent(requireRow(row, "raw_content_create_failed")));
      }

      // WHY: 先在仓储层做最小去重，保证 Reddit/X 重试不会反复堆同一条外部内容。
      // TRADE-OFF: 当前逐条检查吞吐较低；数据量上来后应改为唯一索引 + 批量 upsert。
      return { items, duplicates };
    },

    async list() {
      const rows = await db.select().from(rawContents).orderBy(desc(rawContents.capturedAt));
      return rows.map(mapRawContent);
    }
  };
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function requireRow<TRow>(row: TRow | undefined, message: string): TRow {
  if (!row) {
    throw new Error(message);
  }
  return row;
}

function mapTopic(row: TopicRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    language: row.language,
    market: row.market,
    status: row.status as TopicStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapQuery(row: QueryRow) {
  return {
    id: row.id,
    topicId: row.topicId,
    name: row.name,
    includeKeywords: row.includeKeywords as string[],
    excludeKeywords: row.excludeKeywords as string[],
    platforms: row.platforms as Platform[],
    language: row.language,
    frequency: row.frequency,
    limitPerRun: row.limitPerRun,
    status: row.status as TopicStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapSource(row: SourceRow) {
  return {
    id: row.id,
    platform: row.platform as Platform,
    name: row.name,
    enabled: row.enabled,
    requiresLogin: row.requiresLogin,
    crawlerType: row.crawlerType as "cheerio" | "playwright",
    defaultLimit: row.defaultLimit,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapCrawlTask(row: CrawlTaskRow) {
  return {
    id: row.id,
    topicId: row.topicId,
    queryId: row.queryId,
    sourceId: row.sourceId,
    status: row.status as TaskStatus,
    targetCount: row.targetCount,
    collectedCount: row.collectedCount,
    validCount: row.validCount,
    duplicateCount: row.duplicateCount,
    errorMessage: row.errorMessage ?? undefined,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapRawContent(row: RawContentRow) {
  return {
    id: row.id,
    platform: row.platform as Platform,
    sourceId: row.sourceId,
    queryId: row.queryId,
    topicId: row.topicId,
    externalId: row.externalId ?? undefined,
    url: row.url,
    authorName: row.authorName ?? undefined,
    authorHandle: row.authorHandle ?? undefined,
    text: row.text,
    metricsJson: row.metricsJson as Record<string, unknown> | null,
    publishedAt: row.publishedAt ?? undefined,
    capturedAt: row.capturedAt,
    rawJson: row.rawJson as Record<string, unknown> | null,
    createdAt: row.createdAt
  };
}
