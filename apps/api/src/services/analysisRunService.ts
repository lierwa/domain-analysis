import {
  createAnalysisProjectRepository,
  createAnalysisRunRepository,
  createCrawlTaskRepository,
  createRawContentRepository,
  createRunReportRepository,
  createSourceRepository,
  type AppDb
} from "@domain-analysis/db";
import type { AnalysisRunStatus, BrowserMode, Platform } from "@domain-analysis/shared";
import { BullMqCrawlQueue, type CrawlJobQueue } from "@domain-analysis/worker";

// WHY: service 层编排业务流程，route 只做 HTTP 参数解析，repository 只做数据读写。
// TRADE-OFF: API 只入队轻量任务，真实采集由 worker 消费；本地未配置 Redis 时启动采集会给出明确错误。

export interface AnalysisRunServiceOptions {
  crawlJobQueue?: CrawlJobQueue;
}

export function createAnalysisRunService(db: AppDb, options: AnalysisRunServiceOptions = {}) {
  const projectRepo = createAnalysisProjectRepository(db);
  const runRepo = createAnalysisRunRepository(db);
  const sourceRepo = createSourceRepository(db);
  const taskRepo = createCrawlTaskRepository(db);
  const contentRepo = createRawContentRepository(db);
  const reportRepo = createRunReportRepository(db);
  let crawlJobQueue = options.crawlJobQueue;

  function getCrawlJobQueue() {
    crawlJobQueue ??= createDefaultCrawlJobQueue();
    return crawlJobQueue;
  }

  return {
    // ─── 创建 Analysis Run ────────────────────────────────────────────────────
    // WHY: 如果没有传 projectId，自动创建 project，降低用户操作步骤。
    async createRun(input: {
      projectId?: string;
      projectName?: string;
      collectionPlanId?: string;
      runTrigger?: "manual" | "scheduled";
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
    }) {
      let projectId = input.projectId;

      if (!projectId) {
        const project = await projectRepo.create({
          name: input.projectName ?? input.goal.slice(0, 60),
          goal: input.goal,
          language: input.language,
          market: input.market,
          defaultLimit: input.limit
        });
        projectId = project.id;
      }

      const runName = `${input.includeKeywords.slice(0, 2).join(", ")} – ${new Date().toLocaleDateString("en", { month: "short", day: "numeric" })}`;

      const run = await runRepo.create({
        projectId,
        collectionPlanId: input.collectionPlanId,
        runTrigger: input.runTrigger ?? "manual",
        name: runName,
        goal: input.goal,
        includeKeywords: input.includeKeywords,
        excludeKeywords: input.excludeKeywords,
        language: input.language,
        market: input.market,
        limit: input.limit,
        platforms: input.platforms,
        browserMode: input.browserMode,
        maxScrollsPerPlatform: input.maxScrollsPerPlatform,
        maxItemsPerPlatform: input.maxItemsPerPlatform
      });

      return run;
    },

    async getRunById(id: string) {
      return runRepo.getById(id);
    },

    async listRuns(page: number, pageSize: number, filters: { projectId?: string; status?: string } = {}) {
      return runRepo.listPage({ page, pageSize }, filters);
    },

    async deleteRun(id: string) {
      const run = await runRepo.getById(id);
      if (!run) return null;
      await runRepo.remove(id);
      return run;
    },

    // ─── 启动采集 ─────────────────────────────────────────────────────────────
    async startRun(runId: string) {
      const run = await runRepo.getById(runId);
      if (!run) throw Object.assign(new Error("run_not_found"), { statusCode: 404 });

      if (run.status !== "draft" && run.status !== "collection_failed") {
        throw Object.assign(
          new Error(`Cannot start run in status: ${run.status}`),
          { statusCode: 400 }
        );
      }

      // WHY: 检查是否已有活跃任务，避免并发重复采集。
      const activeTask = await runRepo.findActiveCrawlTask(runId);
      if (activeTask) {
        return runRepo.getById(runId);
      }

      await sourceRepo.seedDefaults();
      const jobQueue = getCrawlJobQueue();
      const platforms = normalizePlatforms(run.platforms);
      const sources = [];
      for (const platform of platforms) {
        const source = await sourceRepo.getByPlatform(platform);
        if (!source || !source.enabled) {
          throw Object.assign(new Error(`${platform}_source_unavailable`), { statusCode: 503 });
        }
        sources.push(source);
      }

      await runRepo.update(runId, {
        status: "collecting" as AnalysisRunStatus,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        errorMessage: null
      });

      for (const source of sources) {
        const task = await taskRepo.create({
          analysisRunId: runId,
          sourceId: source.id,
          platform: source.platform,
          targetCount: run.maxItemsPerPlatform ?? run.limit
        });

        // WHY: API 只创建 pending task 并入队；running 必须由 worker 消费后写入，避免队列失败造成假运行。
        await jobQueue.enqueueCrawlJob({ runId, taskId: task.id });
      }

      return runRepo.getById(runId);
    },

    // ─── 重试采集 ─────────────────────────────────────────────────────────────
    async retryRun(runId: string) {
      const run = await runRepo.getById(runId);
      if (!run) throw Object.assign(new Error("run_not_found"), { statusCode: 404 });

      if (run.status !== "collection_failed") {
        throw Object.assign(new Error("Only collection_failed runs can be retried"), { statusCode: 400 });
      }

      return this.startRun(runId);
    },

    // ─── 生成报告 ─────────────────────────────────────────────────────────────
    // WHY: MVP 生成 deterministic markdown 报告，不依赖 AI；AI 报告作为后续增强。
    async generateReport(runId: string) {
      const run = await runRepo.getById(runId);
      if (!run) throw Object.assign(new Error("run_not_found"), { statusCode: 404 });

      if (run.status !== "content_ready" && run.status !== "insight_ready") {
        throw Object.assign(
          new Error("Report can only be generated after content is ready"),
          { statusCode: 400 }
        );
      }

      const contentsResult = await contentRepo.listByRunPage(runId, { page: 1, pageSize: 500 });
      const contents = contentsResult.items;

      const markdown = buildDeterministicReport(run, contents);

      const report = await reportRepo.create({
        projectId: run.projectId,
        analysisRunId: runId,
        title: `${run.name} – Analysis Report`,
        type: "run_summary",
        contentMarkdown: markdown,
        contentJson: {
          runId,
          totalContents: contents.length,
          generatedAt: new Date().toISOString()
        }
      });

      await runRepo.update(runId, { status: "report_ready", reportId: report.id });

      return report;
    },

    async listRunCrawlTasks(runId: string) {
      return runRepo.listCrawlTasks(runId);
    },

    async getProjectById(id: string) {
      return projectRepo.getById(id);
    },

    async listProjects(page: number, pageSize: number) {
      return projectRepo.listPage({ page, pageSize });
    },

    async createProject(input: {
      name: string;
      goal: string;
      language: string;
      market: string;
      defaultLimit?: number;
    }) {
      return projectRepo.create(input);
    },

    async archiveProject(id: string) {
      return projectRepo.archive(id);
    }
  };
}

function createDefaultCrawlJobQueue(): CrawlJobQueue {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("missing_REDIS_URL_for_crawl_queue");
  }
  return new BullMqCrawlQueue({ redisUrl });
}

function normalizePlatforms(platforms: Platform[] | undefined): Platform[] {
  const allowed = new Set<Platform>(["reddit", "youtube", "x"]);
  const defaults: Platform[] = ["reddit", "youtube", "x"];
  const selected = (platforms?.length ? platforms : defaults).filter((platform) =>
    allowed.has(platform)
  );
  return Array.from(new Set(selected));
}

// WHY: deterministic 报告从采集数据直接生成，不依赖 AI；确保 MVP 有可用输出。
function buildDeterministicReport(
  run: {
    name: string;
    includeKeywords: string[];
    excludeKeywords: string[];
    validCount: number;
    collectedCount: number;
    duplicateCount: number;
  },
  contents: Array<{
    authorName?: string;
    authorHandle?: string;
    url: string;
    text: string;
    metricsJson: Record<string, unknown> | null;
    publishedAt?: string;
  }>
): string {
  const topAuthors = getTopAuthors(contents, 10);
  const highEngagement = getHighEngagement(contents, 5);

  return `# ${run.name} – Analysis Report

## Overview

| Metric | Value |
|--------|-------|
| Collected | ${run.collectedCount} |
| Valid | ${run.validCount} |
| Duplicates | ${run.duplicateCount} |
| Include keywords | ${run.includeKeywords.join(", ")} |
| Exclude keywords | ${run.excludeKeywords.join(", ") || "—"} |

## Top Authors

${topAuthors.map((a) => `- **${a.name}** (${a.count} posts)`).join("\n") || "_No author data_"}

## High Engagement Samples

${highEngagement
  .map(
    (c, i) => `### ${i + 1}. ${c.authorName ?? "Unknown"}
> ${c.text.slice(0, 300)}${c.text.length > 300 ? "…" : ""}

[Source](${c.url})${c.publishedAt ? ` · ${c.publishedAt.slice(0, 10)}` : ""}
`
  )
  .join("\n") || "_No samples available_"}

---
_Generated ${new Date().toISOString().slice(0, 10)} · ${run.validCount} samples_
`;
}

function getTopAuthors(
  contents: Array<{ authorName?: string; authorHandle?: string }>,
  limit: number
) {
  const counts = new Map<string, number>();
  for (const c of contents) {
    const name = c.authorName ?? c.authorHandle;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function getHighEngagement(
  contents: Array<{
    authorName?: string;
    url: string;
    text: string;
    metricsJson: Record<string, unknown> | null;
    publishedAt?: string;
  }>,
  limit: number
) {
  return [...contents]
    .sort((a, b) => {
      const scoreA = getEngagementScore(a.metricsJson);
      const scoreB = getEngagementScore(b.metricsJson);
      return scoreB - scoreA;
    })
    .slice(0, limit);
}

function getEngagementScore(metrics: Record<string, unknown> | null): number {
  if (!metrics) return 0;
  const score = (metrics.score as number) ?? 0;
  const comments = (metrics.num_comments as number) ?? 0;
  return score + comments * 2;
}
