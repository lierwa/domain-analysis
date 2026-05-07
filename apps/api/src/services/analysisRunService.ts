import {
  createAnalysisProjectRepository,
  createAnalysisRunRepository,
  createCrawlTaskRepository,
  createRawContentRepository,
  createRunReportRepository,
  createSourceRepository,
  type AppDb
} from "@domain-analysis/db";
import type { AnalysisRunStatus } from "@domain-analysis/shared";
import { TaskQueue } from "@domain-analysis/worker";

const queue = new TaskQueue();

// WHY: service 层编排业务流程，route 只做 HTTP 参数解析，repository 只做数据读写。
// TRADE-OFF: MVP 仍用进程内 TaskQueue；进程重启会丢 running 任务，后续再换持久化队列。

export function createAnalysisRunService(db: AppDb) {
  const projectRepo = createAnalysisProjectRepository(db);
  const runRepo = createAnalysisRunRepository(db);
  const sourceRepo = createSourceRepository(db);
  const taskRepo = createCrawlTaskRepository(db);
  const contentRepo = createRawContentRepository(db);
  const reportRepo = createRunReportRepository(db);

  return {
    // ─── 创建 Analysis Run ────────────────────────────────────────────────────
    // WHY: 如果没有传 projectId，自动创建 project，降低用户操作步骤。
    async createRun(input: {
      projectId?: string;
      projectName?: string;
      goal: string;
      includeKeywords: string[];
      excludeKeywords: string[];
      language: string;
      market: string;
      limit: number;
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
        name: runName,
        goal: input.goal,
        includeKeywords: input.includeKeywords,
        excludeKeywords: input.excludeKeywords,
        language: input.language,
        market: input.market,
        limit: input.limit
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
      const source = await sourceRepo.getByPlatform("reddit");
      if (!source || !source.enabled) {
        throw Object.assign(new Error("reddit_source_unavailable"), { statusCode: 503 });
      }

      await runRepo.update(runId, {
        status: "collecting" as AnalysisRunStatus,
        startedAt: new Date().toISOString(),
        errorMessage: null
      });

      const task = await taskRepo.create({
        analysisRunId: runId,
        sourceId: source.id,
        targetCount: Math.min(run.limit, source.defaultLimit)
      });

      await taskRepo.update(task.id, { status: "running", startedAt: new Date().toISOString() });

      // WHY: 采集异步执行，API 立即返回避免慢抓取阻塞用户界面和健康检查。
      void startCollection({ runId, taskId: task.id, run, source, taskRepo, contentRepo, runRepo, queue });

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

// ─── 采集执行（私有）────────────────────────────────────────────────────────────

async function startCollection({
  runId,
  taskId,
  run,
  source,
  taskRepo,
  contentRepo,
  runRepo,
  queue
}: {
  runId: string;
  taskId: string;
  run: { includeKeywords: string[]; excludeKeywords: string[]; limit: number; projectId: string };
  source: { id: string; defaultLimit: number };
  taskRepo: ReturnType<typeof createCrawlTaskRepository>;
  contentRepo: ReturnType<typeof createRawContentRepository>;
  runRepo: ReturnType<typeof createAnalysisRunRepository>;
  queue: TaskQueue;
}) {
  try {
    const result = await queue.add({
      id: taskId,
      kind: "crawl",
      payload: {
        platform: "reddit",
        query: {
          name: run.includeKeywords.join(" "),
          includeKeywords: run.includeKeywords,
          excludeKeywords: run.excludeKeywords,
          language: "en",
          limitPerRun: Math.min(run.limit, source.defaultLimit)
        }
      }
    });

    const collectedCount = result?.items?.length ?? 0;

    const inserted = await contentRepo.createMany(
      (result?.items ?? []).map((item) => ({
        ...item,
        analysisProjectId: run.projectId,
        analysisRunId: runId,
        crawlTaskId: taskId,
        sourceId: source.id,
        // WHY: matchedKeywords 记录哪些 includeKeywords 命中，便于 content tab 展示。
        matchedKeywords: run.includeKeywords.filter((kw) =>
          item.text.toLowerCase().includes(kw.toLowerCase())
        )
      }))
    );

    await taskRepo.update(taskId, {
      status: collectedCount === 0 ? "no_content" : "success",
      collectedCount,
      validCount: inserted.items.length,
      duplicateCount: inserted.duplicates,
      errorMessage:
        collectedCount === 0
          ? "No public posts matched this query, or the source returned an empty result."
          : null,
      finishedAt: new Date().toISOString()
    });

    await runRepo.update(runId, {
      status: "content_ready",
      collectedCount,
      validCount: inserted.items.length,
      duplicateCount: inserted.duplicates,
      finishedAt: new Date().toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_crawl_error";
    await taskRepo.update(taskId, {
      status: "failed",
      errorMessage: message,
      finishedAt: new Date().toISOString()
    });
    await runRepo.update(runId, {
      status: "collection_failed",
      errorMessage: message,
      finishedAt: new Date().toISOString()
    });
  }
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
