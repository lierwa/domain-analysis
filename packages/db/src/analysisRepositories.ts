import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import type {
  AnalysisReportType,
  AnalysisRunStatus,
  BrowserMode,
  Platform,
  ProjectStatus,
  TaskStatus
} from "@domain-analysis/shared";
import type { AppDb } from "./client";
import type { PageInput, PageMeta } from "./repositories";
import { analysisProjects, analysisRuns, crawlTasks, reports } from "./schema";

// ─── 类型定义 ───────────────────────────────────────────────────────────────

type AnalysisProjectRow = typeof analysisProjects.$inferSelect;
type AnalysisRunRow = typeof analysisRuns.$inferSelect;
type CrawlTaskRow = typeof crawlTasks.$inferSelect;
type ReportRow = typeof reports.$inferSelect;

export interface CreateAnalysisProjectInput {
  name: string;
  goal: string;
  language: string;
  market: string;
  defaultLimit?: number;
}

export interface CreateAnalysisRunInput {
  projectId: string;
  collectionPlanId?: string;
  runTrigger?: "manual" | "scheduled";
  name: string;
  goal: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  language: string;
  market: string;
  limit: number;
  platforms?: Platform[];
  browserMode?: BrowserMode;
  maxScrollsPerPlatform?: number;
  maxItemsPerPlatform?: number;
}

export interface UpdateAnalysisRunInput {
  status?: AnalysisRunStatus;
  collectedCount?: number;
  validCount?: number;
  duplicateCount?: number;
  analyzedCount?: number;
  reportId?: string;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface CreateRunReportInput {
  projectId: string;
  analysisRunId: string;
  title: string;
  type: AnalysisReportType;
  contentMarkdown: string;
  contentJson?: Record<string, unknown>;
}

// ─── Analysis Project Repository ─────────────────────────────────────────────

export function createAnalysisProjectRepository(db: AppDb) {
  return {
    async create(input: CreateAnalysisProjectInput) {
      const [row] = await db
        .insert(analysisProjects)
        .values({
          id: createId("proj"),
          name: input.name,
          goal: input.goal,
          language: input.language,
          market: input.market,
          defaultPlatform: "reddit",
          defaultLimit: input.defaultLimit ?? 100,
          status: "active"
        })
        .returning();
      return mapProject(requireRow(row, "analysis_project_create_failed"));
    },

    async getById(id: string) {
      const [row] = await db.select().from(analysisProjects).where(eq(analysisProjects.id, id));
      return row ? mapProject(row) : null;
    },

    async listPage(input: PageInput) {
      const [countRow] = await db.select({ total: count() }).from(analysisProjects);
      const total = countRow?.total ?? 0;
      const rows = await db
        .select()
        .from(analysisProjects)
        .orderBy(desc(analysisProjects.createdAt))
        .limit(input.pageSize)
        .offset(toOffset(input));
      return { items: rows.map(mapProject), page: createPageMeta(input, total) };
    },

    async archive(id: string) {
      const [row] = await db
        .update(analysisProjects)
        .set({ status: "archived" as ProjectStatus, updatedAt: now() })
        .where(eq(analysisProjects.id, id))
        .returning();
      return row ? mapProject(row) : null;
    }
  };
}

// ─── Analysis Run Repository ──────────────────────────────────────────────────

export function createAnalysisRunRepository(db: AppDb) {
  return {
    async create(input: CreateAnalysisRunInput) {
      const [row] = await db
        .insert(analysisRuns)
        .values({
          id: createId("run"),
          projectId: input.projectId,
          collectionPlanId: input.collectionPlanId,
          name: input.name,
          status: "draft",
          runTrigger: input.runTrigger ?? "manual",
          includeKeywords: input.includeKeywords,
          excludeKeywords: input.excludeKeywords,
          platform: "reddit",
          platforms: input.platforms ?? ["reddit"],
          browserMode: input.browserMode ?? "local_profile",
          maxScrollsPerPlatform: input.maxScrollsPerPlatform ?? 5,
          maxItemsPerPlatform: input.maxItemsPerPlatform ?? input.limit,
          limit: input.limit,
          collectedCount: 0,
          validCount: 0,
          duplicateCount: 0,
          analyzedCount: 0
        })
        .returning();
      return mapRun(requireRow(row, "analysis_run_create_failed"));
    },

    async getById(id: string) {
      const [row] = await db.select().from(analysisRuns).where(eq(analysisRuns.id, id));
      return row ? mapRun(row) : null;
    },

    async listPage(input: PageInput, filters: { projectId?: string; status?: string } = {}) {
      const baseQuery = db.select().from(analysisRuns);
      const countQuery = db.select({ total: count() }).from(analysisRuns);

      const rows = await baseQuery
        .orderBy(desc(analysisRuns.createdAt))
        .limit(input.pageSize)
        .offset(toOffset(input));
      const [countRow] = await countQuery;
      const total = countRow?.total ?? 0;

      // WHY: 过滤在应用层做，避免 Drizzle 动态 where 组合的类型体操，保持简单可读。
      const filtered = rows.filter((row) => {
        if (filters.projectId && row.projectId !== filters.projectId) return false;
        if (filters.status && row.status !== filters.status) return false;
        return true;
      });

      return { items: filtered.map(mapRun), page: createPageMeta(input, total) };
    },

    async update(id: string, input: UpdateAnalysisRunInput) {
      const [row] = await db
        .update(analysisRuns)
        .set({ ...input, updatedAt: now() })
        .where(eq(analysisRuns.id, id))
        .returning();
      return row ? mapRun(row) : null;
    },

    async remove(id: string) {
      await db.delete(analysisRuns).where(eq(analysisRuns.id, id));
    },

    // WHY: 查询当前 run 下是否有已运行任务，避免重复启动并发采集。
    async findActiveCrawlTask(runId: string) {
      const rows = await db
        .select()
        .from(crawlTasks)
        .where(eq(crawlTasks.analysisRunId, runId));
      return rows.find((row) => row.status === "pending" || row.status === "running") ?? null;
    },

    async listCrawlTasks(runId: string) {
      const rows = await db
        .select()
        .from(crawlTasks)
        .where(eq(crawlTasks.analysisRunId, runId))
        .orderBy(desc(crawlTasks.createdAt));
      return rows.map(mapCrawlTask);
    },

    async listStaleCollecting(cutoffIso: string) {
      const rows = await db
        .select()
        .from(analysisRuns)
        .where(and(eq(analysisRuns.status, "collecting"), inArray(analysisRuns.status, ["collecting"])));
      return rows
        .filter((row) => {
          const startedAt = normalizeDateTime(row.startedAt);
          return startedAt ? startedAt <= cutoffIso : false;
        })
        .map(mapRun);
    }
  };
}

// ─── Run Report Repository ────────────────────────────────────────────────────

export function createRunReportRepository(db: AppDb) {
  return {
    async create(input: CreateRunReportInput) {
      const [row] = await db
        .insert(reports)
        .values({
          id: createId("report"),
          projectId: input.projectId,
          analysisRunId: input.analysisRunId,
          title: input.title,
          type: input.type,
          contentMarkdown: input.contentMarkdown,
          contentJson: input.contentJson,
          status: "ready"
        })
        .returning();
      return mapReport(requireRow(row, "report_create_failed"));
    },

    async getById(id: string) {
      const [row] = await db.select().from(reports).where(eq(reports.id, id));
      return row ? mapReport(row) : null;
    },

    async listPage(input: PageInput, filters: { projectId?: string } = {}) {
      const [countRow] = await db.select({ total: count() }).from(reports);
      const total = countRow?.total ?? 0;
      const rows = await db
        .select()
        .from(reports)
        .orderBy(desc(reports.createdAt))
        .limit(input.pageSize)
        .offset(toOffset(input));

      const filtered = rows.filter((row) => {
        if (filters.projectId && row.projectId !== filters.projectId) return false;
        return true;
      });

      return { items: filtered.map(mapReport), page: createPageMeta(input, total) };
    }
  };
}

// ─── 内部工具函数 ──────────────────────────────────────────────────────────────

function createId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function requireRow<TRow>(row: TRow | undefined, message: string): TRow {
  if (!row) throw new Error(message);
  return row;
}

function now() {
  return new Date().toISOString();
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

function mapProject(row: AnalysisProjectRow) {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    language: row.language,
    market: row.market,
    defaultPlatform: row.defaultPlatform as "reddit",
    defaultLimit: row.defaultLimit,
    status: row.status as ProjectStatus,
    createdAt: normalizeDateTime(row.createdAt) ?? row.createdAt,
    updatedAt: normalizeDateTime(row.updatedAt) ?? row.updatedAt
  };
}

function mapRun(row: AnalysisRunRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    collectionPlanId: row.collectionPlanId ?? undefined,
    name: row.name,
    status: row.status as AnalysisRunStatus,
    runTrigger: row.runTrigger as "manual" | "scheduled",
    includeKeywords: (row.includeKeywords as string[]) ?? [],
    excludeKeywords: (row.excludeKeywords as string[]) ?? [],
    platform: row.platform as "reddit",
    platforms: ((row.platforms as Platform[] | null) ?? [row.platform as Platform]).filter(Boolean),
    browserMode: row.browserMode as BrowserMode,
    maxScrollsPerPlatform: row.maxScrollsPerPlatform,
    maxItemsPerPlatform: row.maxItemsPerPlatform,
    limit: row.limit,
    collectedCount: row.collectedCount,
    validCount: row.validCount,
    duplicateCount: row.duplicateCount,
    analyzedCount: row.analyzedCount,
    reportId: row.reportId ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    startedAt: normalizeDateTime(row.startedAt),
    finishedAt: normalizeDateTime(row.finishedAt),
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

function mapReport(row: ReportRow) {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    analysisRunId: row.analysisRunId ?? undefined,
    title: row.title,
    type: row.type as AnalysisReportType,
    status: row.status as "draft" | "ready" | "failed",
    contentMarkdown: row.contentMarkdown,
    contentJson: (row.contentJson as Record<string, unknown>) ?? undefined,
    createdAt: normalizeDateTime(row.createdAt) ?? row.createdAt,
    updatedAt: normalizeDateTime(row.updatedAt) ?? row.updatedAt
  };
}
