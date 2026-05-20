import {
  createAnalysisBatchRepository,
  createAnalysisProjectRepository,
  createAnalysisRunRepository,
  createAnalyzedContentRepository,
  createCrawlTaskRepository,
  createRawContentRepository,
  createRunReportRepository,
  createSourceRepository,
  type AppDb
} from "@domain-analysis/db";
import type { AnalysisBatchStatus, AnalysisRunStatus, MediaPolicy, TaskStatus } from "@domain-analysis/shared";
import { mapCollectionErrorToTaskStatus, TaskQueue } from "@domain-analysis/worker";
import { buildDeterministicReport } from "./analysisReportBuilder";
import { logBusinessError, logBusinessInfo, type ServiceLoggingOptions } from "./businessLogger";
import { queueRunMediaDownloads } from "./runMediaService";

const queue = new TaskQueue();
const activeRunControllers = new Map<string, AbortController>();

// WHY: service 层编排业务流程，route 只做 HTTP 参数解析，repository 只做数据读写。
// TRADE-OFF: MVP 仍用进程内 TaskQueue；进程重启会丢 running 任务，后续再换持久化队列。

export function createAnalysisRunService(db: AppDb, options: ServiceLoggingOptions = {}) {
  const projectRepo = createAnalysisProjectRepository(db);
  const batchRepo = createAnalysisBatchRepository(db);
  const runRepo = createAnalysisRunRepository(db);
  const sourceRepo = createSourceRepository(db);
  const taskRepo = createCrawlTaskRepository(db);
  const contentRepo = createRawContentRepository(db);
  const reportRepo = createRunReportRepository(db);
  const insightRepo = createAnalyzedContentRepository(db);

  return {
    // ─── 创建 Analysis Run ────────────────────────────────────────────────────
    // WHY: 如果没有传 projectId，自动创建 project，降低用户操作步骤。
    async createRun(input: {
      projectId?: string;
      projectName?: string;
      collectionPlanId?: string;
      analysisBatchId?: string;
      runTrigger?: "manual" | "scheduled";
      platform: "reddit" | "x" | "youtube" | "tiktok" | "pinterest" | "web";
      goal: string;
      includeKeywords: string[];
      excludeKeywords: string[];
      language: string;
      market: string;
      mediaPolicy?: MediaPolicy;
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
        analysisBatchId: input.analysisBatchId,
        collectionPlanId: input.collectionPlanId,
        runTrigger: input.runTrigger ?? "manual",
        platform: input.platform,
        name: runName,
        goal: input.goal,
        includeKeywords: input.includeKeywords,
        excludeKeywords: input.excludeKeywords,
        language: input.language,
        market: input.market,
        mediaPolicy: input.mediaPolicy ?? "metadata_only",
        limit: input.limit
      });

      logBusinessInfo(options.logger, "analysis.run.created", {
        runId: run.id,
        batchId: run.analysisBatchId,
        platform: run.platform,
        mediaPolicy: run.mediaPolicy,
        status: run.status,
        targetCount: run.limit
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
      if (run.status === "collecting") {
        throw Object.assign(new Error("Cannot delete a collecting run"), { statusCode: 400 });
      }
      await runRepo.remove(id);
      if (run.analysisBatchId) await refreshBatchFromRuns(run.analysisBatchId, { batchRepo, runRepo });
      return run;
    },

    async stopRun(id: string) {
      const run = await runRepo.getById(id);
      if (!run) return null;
      if (run.status !== "collecting") return run;

      activeRunControllers.get(id)?.abort();
      const stoppedAt = new Date().toISOString();
      const activeTask = await runRepo.findActiveCrawlTask(id);
      if (activeTask) {
        await taskRepo.update(activeTask.id, {
          status: "cancelled",
          stopReason: "user_stopped",
          errorMessage: "Stopped by user.",
          finishedAt: stoppedAt
        });
      }

      const stopped = await runRepo.update(id, {
        status: "cancelled",
        errorMessage: "Stopped by user.",
        finishedAt: stoppedAt
      });
      if (run.analysisBatchId) await refreshBatchFromRuns(run.analysisBatchId, { batchRepo, runRepo });

      logBusinessInfo(options.logger, "analysis.run.cancelled", {
        runId: id,
        batchId: run.analysisBatchId,
        taskId: activeTask?.id,
        platform: run.platform,
        status: "cancelled"
      });

      return stopped;
    },

    // ─── 启动采集 ─────────────────────────────────────────────────────────────
    async startRun(runId: string) {
      const run = await runRepo.getById(runId);
      if (!run) throw Object.assign(new Error("run_not_found"), { statusCode: 404 });

      if (run.status !== "draft" && run.status !== "collection_failed" && run.status !== "login_required") {
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
      const source = await sourceRepo.getByPlatform(run.platform);
      if (!source || !source.enabled) {
        throw Object.assign(new Error(`${run.platform}_source_unavailable`), { statusCode: 503 });
      }

      await runRepo.update(runId, {
        status: "collecting" as AnalysisRunStatus,
        startedAt: new Date().toISOString(),
        errorMessage: null
      });
      if (run.analysisBatchId) {
        await batchRepo.update(run.analysisBatchId, {
          status: "collecting",
          startedAt: new Date().toISOString(),
          errorMessage: null
        });
      }

      const task = await taskRepo.create({
        analysisRunId: runId,
        sourceId: source.id,
        targetCount: determineTaskTargetCount({
          runLimit: run.limit,
          sourceDefaultLimit: source.defaultLimit
        })
      });

      await taskRepo.update(task.id, { status: "running", startedAt: new Date().toISOString() });

      // WHY: 生命周期日志比 GET 访问日志更能说明系统正在做什么，便于排查异步任务状态。
      logBusinessInfo(options.logger, "analysis.run.started", {
        runId,
        batchId: run.analysisBatchId,
        platform: run.platform,
        status: "collecting",
        targetCount: task.targetCount
      });
      logBusinessInfo(options.logger, "crawl.task.started", {
        runId,
        batchId: run.analysisBatchId,
        taskId: task.id,
        platform: run.platform,
        status: "running",
        targetCount: task.targetCount
      });

      const controller = new AbortController();
      activeRunControllers.set(runId, controller);

      // WHY: 采集异步执行，API 立即返回避免慢抓取阻塞用户界面和健康检查。
      void startCollection({
        runId,
        taskId: task.id,
        run,
        source,
        taskRepo,
        contentRepo,
        runRepo,
        batchRepo,
        queue,
        logger: options.logger,
        abortSignal: controller.signal
      });

      return runRepo.getById(runId);
    },

    // ─── 重试采集 ─────────────────────────────────────────────────────────────
    async retryRun(runId: string) {
      const run = await runRepo.getById(runId);
      if (!run) throw Object.assign(new Error("run_not_found"), { statusCode: 404 });

      if (run.status !== "collection_failed" && run.status !== "login_required") {
        throw Object.assign(new Error("Only collection_failed or login_required runs can be retried"), { statusCode: 400 });
      }

      return this.startRun(runId);
    },

    // ─── 生成报告 ─────────────────────────────────────────────────────────────
    // WHY: MVP 生成 deterministic markdown 报告，不依赖 AI；AI 报告作为后续增强。
    async generateReport(runId: string) {
      const run = await runRepo.getById(runId);
      if (!run) throw Object.assign(new Error("run_not_found"), { statusCode: 404 });

      if (!canGenerateReport(run.status)) {
        throw Object.assign(
          new Error("Report can only be generated after content is ready"),
          { statusCode: 400 }
        );
      }

      const contentsResult = await contentRepo.listByRunPage(runId, { page: 1, pageSize: 500 });
      const contents = contentsResult.items;

      const insights = await insightRepo.listByRun(runId);
      const markdown = buildDeterministicReport(run, contents, insights);

      const report = await reportRepo.create({
        projectId: run.projectId,
        analysisRunId: runId,
        title: `${run.name} – 中文分析报告`,
        type: "run_summary",
        contentMarkdown: markdown,
        contentJson: {
          runId,
          totalContents: contents.length,
          totalInsights: insights.length,
          generatedAt: new Date().toISOString()
        }
      });

      await runRepo.update(runId, { status: "report_ready", reportId: report.id });

      logBusinessInfo(options.logger, "report.generated", {
        runId,
        status: "report_ready",
        validCount: contents.length,
        targetCount: run.limit
      });

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

// WHY: report_ready 允许重生成，避免模板升级后用户只能看到旧报告。
// TRADE-OFF: 当前会生成一条新的 reports 记录，保留历史报告；后续可再做覆盖/版本管理。
function canGenerateReport(status: AnalysisRunStatus) {
  return ["content_ready", "insight_ready", "report_ready"].includes(status);
}

async function startCollection({
  runId,
  taskId,
  run,
  source,
  taskRepo,
  contentRepo,
  runRepo,
  batchRepo,
  queue,
  logger,
  abortSignal
}: {
  runId: string;
  taskId: string;
  run: {
    platform: "reddit" | "x" | "youtube" | "tiktok" | "pinterest" | "web";
    mediaPolicy: MediaPolicy;
    includeKeywords: string[];
    excludeKeywords: string[];
    limit: number;
    projectId: string;
    analysisBatchId?: string;
  };
  source: { id: string; defaultLimit: number };
  taskRepo: ReturnType<typeof createCrawlTaskRepository>;
  contentRepo: ReturnType<typeof createRawContentRepository>;
  runRepo: ReturnType<typeof createAnalysisRunRepository>;
  batchRepo: ReturnType<typeof createAnalysisBatchRepository>;
  queue: TaskQueue;
  logger?: ServiceLoggingOptions["logger"];
  abortSignal?: AbortSignal;
}) {
  const startedAt = Date.now();
  try {
    const result = await queue.add(
      {
        id: taskId,
        kind: "crawl",
        payload: {
          platform: run.platform,
          query: {
            name: run.includeKeywords.join(" "),
            includeKeywords: run.includeKeywords,
            excludeKeywords: run.excludeKeywords,
            language: "en",
            limitPerRun: determineTaskTargetCount({
              runLimit: run.limit,
              sourceDefaultLimit: source.defaultLimit
            })
          }
        }
      },
      { signal: abortSignal }
    );

    if (await isRunCancelled(runId, runRepo)) {
      await ensureTaskCancelled(taskId, taskRepo);
      return;
    }

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
        ),
        rawJson: {
          ...(item.rawJson ?? {}),
          media: {
            status: run.mediaPolicy === "download_images" ? "pending" : "skipped",
            assets: []
          }
        }
      }))
    );

    const completion = determineCollectionCompletion({
      collectedCount,
      validCount: inserted.items.length,
      duplicateCount: inserted.duplicates
    });

    await taskRepo.update(taskId, {
      status: completion.taskStatus,
      collectedCount,
      validCount: inserted.items.length,
      duplicateCount: inserted.duplicates,
      pagesCollected: result?.metadata?.pagesCollected,
      stopReason: result?.metadata?.stopReason,
      lastRequestAt: result?.metadata?.pagesCollected ? new Date().toISOString() : undefined,
      errorMessage: completion.errorMessage,
      finishedAt: new Date().toISOString()
    });

    await runRepo.update(runId, {
      status: completion.runStatus,
      collectedCount,
      validCount: inserted.items.length,
      duplicateCount: inserted.duplicates,
      errorMessage: completion.errorMessage,
      finishedAt: new Date().toISOString()
    });
    if (run.analysisBatchId) await refreshBatchFromRuns(run.analysisBatchId, { batchRepo, runRepo });

    logBusinessInfo(logger, "crawl.task.completed", {
      runId,
      batchId: run.analysisBatchId,
      taskId,
      platform: run.platform,
      status: completion.taskStatus,
      targetCount: determineTaskTargetCount({
        runLimit: run.limit,
        sourceDefaultLimit: source.defaultLimit
      }),
      collectedCount,
      validCount: inserted.items.length,
      duplicateCount: inserted.duplicates,
      durationMs: Date.now() - startedAt
    });

    if (run.mediaPolicy === "download_images" && inserted.items.length > 0) {
      // WHY: 媒体后处理放到异步分支，先保证文本数据和任务状态可用，避免前台“等图”阻塞。
      // TRADE-OFF: 用户会先看到 pending/processing 状态，待后台完成后再刷新为缩略图。
      void queueRunMediaDownloads({
        runId,
        contentRepo,
        logger
      }).catch((error) => {
        logBusinessError(logger, "analysis.media.queue_failed", {
          runId,
          batchId: run.analysisBatchId,
          taskId,
          platform: run.platform,
          errorMessage: error instanceof Error ? error.message : "unknown_media_queue_error"
        });
      });
    }
  } catch (error) {
    if (await isRunCancelled(runId, runRepo)) {
      await ensureTaskCancelled(taskId, taskRepo);
      return;
    }

    const message = error instanceof Error ? error.message : "unknown_crawl_error";
    const taskStatus = mapCollectionErrorToTaskStatus(error);
    const completion = determineCollectionFailureCompletion({ taskStatus, message });
    await taskRepo.update(taskId, {
      status: completion.taskStatus,
      errorMessage: completion.errorMessage,
      finishedAt: completion.finishedAt
    });
    await runRepo.update(runId, {
      status: completion.runStatus,
      errorMessage: completion.errorMessage,
      finishedAt: completion.finishedAt
    });
    if (run.analysisBatchId) await refreshBatchFromRuns(run.analysisBatchId, { batchRepo, runRepo });

    logBusinessError(logger, "crawl.task.failed", {
      runId,
      batchId: run.analysisBatchId,
      taskId,
      platform: run.platform,
      status: completion.taskStatus,
      errorMessage: completion.errorMessage,
      durationMs: Date.now() - startedAt
    });
  } finally {
    if (activeRunControllers.get(runId)?.signal === abortSignal) activeRunControllers.delete(runId);
  }
}

async function isRunCancelled(
  runId: string,
  runRepo: ReturnType<typeof createAnalysisRunRepository>
) {
  return (await runRepo.getById(runId))?.status === "cancelled";
}

async function ensureTaskCancelled(
  taskId: string,
  taskRepo: ReturnType<typeof createCrawlTaskRepository>
) {
  await taskRepo.update(taskId, {
    status: "cancelled",
    stopReason: "user_stopped",
    errorMessage: "Stopped by user.",
    finishedAt: new Date().toISOString()
  });
}

export async function refreshBatchFromRuns(
  batchId: string,
  repos: {
    batchRepo: ReturnType<typeof createAnalysisBatchRepository>;
    runRepo: ReturnType<typeof createAnalysisRunRepository>;
  }
) {
  const runs = await repos.runRepo.listByBatch(batchId);
  const status = deriveBatchStatus(runs);
  const collectedCount = runs.reduce((sum, run) => sum + run.collectedCount, 0);
  const validCount = runs.reduce((sum, run) => sum + run.validCount, 0);
  const duplicateCount = runs.reduce((sum, run) => sum + run.duplicateCount, 0);
  const finishedStatuses: AnalysisBatchStatus[] = [
    "partial_ready",
    "content_ready",
    "no_content",
    "collection_failed",
    "cancelled"
  ];

  await repos.batchRepo.update(batchId, {
    status,
    collectedCount,
    validCount,
    duplicateCount,
    errorMessage: runs.find((run) => run.errorMessage)?.errorMessage ?? null,
    finishedAt: finishedStatuses.includes(status) ? new Date().toISOString() : null
  });
}

export function deriveBatchStatus(
  runs: Array<{ status: AnalysisRunStatus; validCount: number }>
): AnalysisBatchStatus {
  if (runs.length === 0) return "draft";
  if (runs.some((run) => run.status === "collecting")) return "collecting";

  const hasValid = runs.some((run) => run.validCount > 0);
  const hasLoginRequired = runs.some((run) => run.status === "login_required");
  const hasFailure = runs.some((run) => run.status === "collection_failed");
  if (hasValid && (hasFailure || hasLoginRequired)) return "partial_ready";
  if (hasLoginRequired) return "login_required";
  if (hasValid) return "content_ready";
  if (hasFailure) return "collection_failed";
  if (runs.every((run) => run.status === "cancelled")) return "cancelled";
  return "no_content";
}

export function determineTaskTargetCount({
  runLimit,
  sourceDefaultLimit
}: {
  runLimit: number;
  sourceDefaultLimit: number;
}) {
  // WHY: 用户创建 run 时输入的 limit 是本次任务目标，source.defaultLimit 只能作为未指定时的默认值。
  // TRADE-OFF: 低频采集仍由 adapter/平台限流控制，不在这里静默改小用户目标，避免 UI 与真实任务不一致。
  return runLimit || sourceDefaultLimit;
}

export function determineCollectionCompletion({
  collectedCount,
  validCount,
  duplicateCount
}: {
  collectedCount: number;
  validCount: number;
  duplicateCount: number;
}): {
  taskStatus: TaskStatus;
  runStatus: AnalysisRunStatus;
  errorMessage: string | null;
} {
  if (validCount > 0) {
    return { taskStatus: "success", runStatus: "content_ready", errorMessage: null };
  }

  if (collectedCount > 0 && duplicateCount === collectedCount) {
    return {
      taskStatus: "no_content",
      runStatus: "no_content",
      errorMessage: "Collected items were all duplicate content already stored in the library."
    };
  }

  return {
    taskStatus: "no_content",
    runStatus: "no_content",
    errorMessage: "No public posts matched this query, or the source returned an empty result."
  };
}

export function determineCollectionFailureCompletion({
  taskStatus,
  message
}: {
  taskStatus: TaskStatus;
  message: string;
}): {
  taskStatus: TaskStatus;
  runStatus: AnalysisRunStatus;
  errorMessage: string;
  finishedAt: string | null;
} {
  // WHY: login_required 是等待用户补登录的可恢复节点，不是采集器失败。
  // TRADE-OFF: task 不再 running，但 run 不写 finishedAt，UI 可以明确展示“继续”而不是“重试失败”。
  if (taskStatus === "login_required") {
    return {
      taskStatus,
      runStatus: "login_required",
      errorMessage: "X login is required. Complete login in the opened browser, then continue this run.",
      finishedAt: null
    };
  }

  return {
    taskStatus,
    runStatus: "collection_failed",
    errorMessage: message,
    finishedAt: new Date().toISOString()
  };
}
