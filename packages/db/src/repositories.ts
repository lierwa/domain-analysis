import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, like, lte, or } from "drizzle-orm";
import type { Platform, TaskStatus } from "@domain-analysis/shared";
import type { AppDb } from "./client";
import { crawlTasks, rawContents, sources } from "./schema";

type SourceRow = typeof sources.$inferSelect;
type CrawlTaskRow = typeof crawlTasks.$inferSelect;
type RawContentRow = typeof rawContents.$inferSelect;

export interface PageInput {
  page: number;
  pageSize: number;
}

export interface PageMeta extends PageInput {
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
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
  analysisRunId: string;
  sourceId: string;
  platform?: Platform;
  targetCount: number;
}

export interface UpdateCrawlTaskInput {
  status?: TaskStatus;
  collectedCount?: number;
  validCount?: number;
  duplicateCount?: number;
  errorMessage?: string | null;
  pagesCollected?: number;
  lastCursor?: string | null;
  stopReason?: string | null;
  lastRequestAt?: string | null;
  nextRequestAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface CreateRawContentInput {
  platform: Platform;
  analysisProjectId: string;
  analysisRunId: string;
  crawlTaskId: string;
  matchedKeywords: string[];
  sourceId: string;
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
  { platform: "reddit", name: "Reddit", requiresLogin: false, crawlerType: "playwright", defaultLimit: 100 },
  { platform: "x", name: "X / Twitter", requiresLogin: true, crawlerType: "playwright", defaultLimit: 25 },
  { platform: "youtube", name: "YouTube", requiresLogin: false, crawlerType: "playwright", defaultLimit: 50 },
  { platform: "tiktok", name: "TikTok", requiresLogin: true, crawlerType: "playwright", defaultLimit: 50 },
  { platform: "pinterest", name: "Pinterest", requiresLogin: true, crawlerType: "playwright", defaultLimit: 50 },
  { platform: "web", name: "Web Pages", requiresLogin: false, crawlerType: "cheerio", defaultLimit: 100 }
];

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
          analysisRunId: input.analysisRunId,
          sourceId: input.sourceId,
          platform: input.platform ?? "reddit",
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

    async listPage(input: PageInput) {
      const [countRow] = await db.select({ total: count() }).from(crawlTasks);
      const total = countRow?.total ?? 0;
      const rows = await db
        .select()
        .from(crawlTasks)
        .orderBy(desc(crawlTasks.createdAt))
        .limit(input.pageSize)
        .offset(toOffset(input));

      // WHY: 长列表必须在数据库层分页，避免任务历史增长后首屏请求和渲染成本线性膨胀。
      // TRADE-OFF: limit/offset 对当前 SQLite MVP 足够简单；大数据量再切 keyset pagination。
      return {
        items: rows.map(mapCrawlTask),
        page: createPageMeta(input, total)
      };
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
        const fingerprint = normalizeContentFingerprint(input.text);
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
        if (!input.externalId) {
          const [existing] = await db
            .select()
            .from(rawContents)
            .where(
              and(
                eq(rawContents.platform, input.platform),
                eq(rawContents.authorHandle, input.authorHandle ?? ""),
                eq(rawContents.publishedAt, input.publishedAt ?? ""),
                like(rawContents.text, `%${fingerprint.slice(0, 80)}%`)
              )
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
            analysisProjectId: input.analysisProjectId,
            analysisRunId: input.analysisRunId,
            crawlTaskId: input.crawlTaskId,
            matchedKeywords: input.matchedKeywords,
            sourceId: input.sourceId,
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
    },

    async listPage(input: PageInput) {
      const [countRow] = await db.select({ total: count() }).from(rawContents);
      const total = countRow?.total ?? 0;
      const rows = await db
        .select()
        .from(rawContents)
        .orderBy(desc(rawContents.capturedAt))
        .limit(input.pageSize)
        .offset(toOffset(input));

      // WHY: 内容库会快速增长，API 只返回当前页可保持移动端和桌面端一致的响应速度。
      // TRADE-OFF: 先保持简单的 offset 分页；等筛选和排序条件增多后再引入游标策略。
      return {
        items: rows.map(mapRawContent),
        page: createPageMeta(input, total)
      };
    },

    // WHY: run 上下文查询必须隔离，不允许跨 run 混用内容，保证分析可追溯。
    async listByRunPage(runId: string, input: PageInput, filters: RunContentFilters = {}) {
      const conditions = buildRunContentConditions(runId, filters);
      const [countRow] = await db
        .select({ total: count() })
        .from(rawContents)
        .where(conditions);
      const total = countRow?.total ?? 0;
      const rows = await db
        .select()
        .from(rawContents)
        .where(conditions)
        .orderBy(desc(rawContents.capturedAt))
        .limit(input.pageSize)
        .offset(toOffset(input));
      return { items: rows.map(mapRawContent), page: createPageMeta(input, total) };
    }
  };
}

export interface RunContentFilters {
  search?: string;
  author?: string;
  publishedFrom?: string;
  publishedTo?: string;
}

function buildRunContentConditions(runId: string, filters: RunContentFilters) {
  const conditions = [eq(rawContents.analysisRunId, runId)];
  if (filters.author) conditions.push(like(rawContents.authorHandle, `%${filters.author}%`));
  if (filters.search) conditions.push(like(rawContents.text, `%${filters.search}%`));
  if (filters.publishedFrom) conditions.push(gte(rawContents.publishedAt, filters.publishedFrom));
  if (filters.publishedTo) conditions.push(lte(rawContents.publishedAt, filters.publishedTo));
  return and(...conditions);
}

function createId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function requireRow<TRow>(row: TRow | undefined, message: string): TRow {
  if (!row) {
    throw new Error(message);
  }
  return row;
}

function toOffset(input: PageInput) {
  return (input.page - 1) * input.pageSize;
}

function createPageMeta(input: PageInput, total: number): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  return {
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages,
    hasNextPage: input.page < totalPages,
    hasPreviousPage: input.page > 1
  };
}

function normalizeDateTime(value: string | null | undefined) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value.replace(" ", "T")}Z`).toISOString();
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
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
    createdAt: normalizeDateTime(row.createdAt) ?? row.createdAt,
    updatedAt: normalizeDateTime(row.updatedAt) ?? row.updatedAt
  };
}

function mapCrawlTask(row: CrawlTaskRow) {
  return {
    id: row.id,
    analysisRunId: row.analysisRunId,
    sourceId: row.sourceId,
    platform: row.platform as Platform,
    status: row.status as TaskStatus,
    targetCount: row.targetCount,
    collectedCount: row.collectedCount,
    validCount: row.validCount,
    duplicateCount: row.duplicateCount,
    errorMessage: row.errorMessage ?? undefined,
    pagesCollected: row.pagesCollected,
    lastCursor: row.lastCursor ?? undefined,
    stopReason: row.stopReason ?? undefined,
    lastRequestAt: normalizeDateTime(row.lastRequestAt),
    nextRequestAt: normalizeDateTime(row.nextRequestAt),
    startedAt: normalizeDateTime(row.startedAt),
    finishedAt: normalizeDateTime(row.finishedAt),
    createdAt: normalizeDateTime(row.createdAt) ?? row.createdAt,
    updatedAt: normalizeDateTime(row.updatedAt) ?? row.updatedAt
  };
}

function normalizeContentFingerprint(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function mapRawContent(row: RawContentRow) {
  return {
    id: row.id,
    platform: row.platform as Platform,
    analysisProjectId: row.analysisProjectId,
    analysisRunId: row.analysisRunId,
    crawlTaskId: row.crawlTaskId,
    matchedKeywords: row.matchedKeywords as string[],
    sourceId: row.sourceId,
    externalId: row.externalId ?? undefined,
    url: row.url,
    authorName: row.authorName ?? undefined,
    authorHandle: row.authorHandle ?? undefined,
    text: row.text,
    metricsJson: row.metricsJson as Record<string, unknown> | null,
    publishedAt: normalizeDateTime(row.publishedAt),
    capturedAt: normalizeDateTime(row.capturedAt) ?? row.capturedAt,
    rawJson: row.rawJson as Record<string, unknown> | null,
    createdAt: normalizeDateTime(row.createdAt) ?? row.createdAt
  };
}
