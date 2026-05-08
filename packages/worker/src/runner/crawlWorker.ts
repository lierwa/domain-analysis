import {
  createAnalysisRunRepository,
  createCrawlTaskRepository,
  createRawContentRepository,
  type AppDb
} from "@domain-analysis/db";
import type { Platform, TaskStatus } from "@domain-analysis/shared";
import {
  createBrowserCollectionAdapter,
  type BrowserCollectionAdapter
} from "../adapters/browserRegistry";
import type { BrowserCollectionContext } from "../adapters/types";
import { getDefaultBrowserProfilePath } from "../config";
import { withSqliteRetry } from "./dbRetry";

export interface ProcessCrawlJobOptions {
  db: AppDb;
  runId: string;
  taskId: string;
  createAdapter?: (platform: Platform, context: BrowserCollectionContext) => BrowserCollectionAdapter;
}

export async function processCrawlJob({
  db,
  runId,
  taskId,
  createAdapter = createBrowserCollectionAdapter
}: ProcessCrawlJobOptions) {
  const runRepo = createAnalysisRunRepository(db);
  const taskRepo = createCrawlTaskRepository(db);
  const contentRepo = createRawContentRepository(db);
  const run = await withSqliteRetry(() => runRepo.getById(runId));
  if (!run) throw new Error("run_not_found");

  const task = (await withSqliteRetry(() => runRepo.listCrawlTasks(runId))).find((item) => item.id === taskId);
  if (!task) throw new Error("crawl_task_not_found");

  await withSqliteRetry(() => taskRepo.update(taskId, {
    status: "running",
    startedAt: task.startedAt ?? new Date().toISOString(),
    errorMessage: null
  }));

  try {
    const browserContext: BrowserCollectionContext = {
      browserMode: run.browserMode,
      browserProfilePath: process.env.BROWSER_PROFILE_PATH ?? getDefaultBrowserProfilePath(),
      maxScrolls: run.maxScrollsPerPlatform,
      maxItems: run.maxItemsPerPlatform
    };
    const adapter = createAdapter(task.platform as Platform, browserContext);
    const result = await adapter.collectPaginated({
      name: run.name,
      includeKeywords: run.includeKeywords,
      excludeKeywords: run.excludeKeywords,
      language: "en",
      limitPerRun: Math.min(task.targetCount, run.maxItemsPerPlatform ?? run.limit)
    });
    const inserted = await withSqliteRetry(() => contentRepo.createMany(
      result.items.map((item) => ({
        ...item,
        analysisProjectId: run.projectId,
        analysisRunId: runId,
        crawlTaskId: taskId,
        sourceId: task.sourceId,
        matchedKeywords: getMatchedKeywords(item.text, run.includeKeywords)
      }))
    ));
    const status = deriveTaskStatus(result.stopReason, inserted.items.length);
    await withSqliteRetry(() => taskRepo.update(taskId, {
      status,
      pagesCollected: result.pagesCollected,
      stopReason: result.stopReason,
      lastCursor: result.lastCursor ?? null,
      collectedCount: result.items.length,
      validCount: inserted.items.length,
      duplicateCount: inserted.duplicates,
      errorMessage: getTaskErrorMessage(result.stopReason, inserted.items.length, result.errorMessage),
      finishedAt: new Date().toISOString(),
      nextRequestAt: null
    }));
    await updateRunAfterTask(runId, runRepo);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_crawl_error";
    await withSqliteRetry(() => taskRepo.update(taskId, {
      status: message === "x_login_required" ? "login_required" : "failed",
      stopReason: message === "x_login_required" ? "login_required" : "error",
      errorMessage: message,
      finishedAt: new Date().toISOString()
    }));
    await updateRunAfterTask(runId, runRepo);
  }
}

function getMatchedKeywords(text: string, includeKeywords: string[]) {
  const lowerText = text.toLowerCase();
  return includeKeywords.filter((kw) => lowerText.includes(kw.toLowerCase()));
}

const terminalTaskStatuses = new Set([
  "success",
  "failed",
  "no_content",
  "login_required",
  "blocked",
  "rate_limited",
  "parse_failed"
]);

function deriveTaskStatus(stopReason: string, validCount: number): TaskStatus {
  if (stopReason === "login_required") return "login_required";
  if (stopReason === "blocked") return "blocked";
  if (stopReason === "rate_limited") return "rate_limited";
  if (stopReason === "parse_failed") return "parse_failed";
  if (stopReason === "error") return "failed";
  return validCount === 0 ? "no_content" : "success";
}

function getTaskErrorMessage(stopReason: string, validCount: number, errorMessage?: string) {
  if (errorMessage) return errorMessage;
  if (validCount > 0) return null;
  if (stopReason === "login_required") return "login_required";
  if (stopReason === "blocked") return "browser_collection_blocked";
  return "No public content matched this query, or the source returned an empty result.";
}

async function updateRunAfterTask(
  runId: string,
  runRepo: ReturnType<typeof createAnalysisRunRepository>
) {
  const tasks = await withSqliteRetry(() => runRepo.listCrawlTasks(runId));
  const collectedCount = tasks.reduce((sum, task) => sum + task.collectedCount, 0);
  const validCount = tasks.reduce((sum, task) => sum + task.validCount, 0);
  const duplicateCount = tasks.reduce((sum, task) => sum + task.duplicateCount, 0);
  const hasActive = tasks.some((task) => !terminalTaskStatuses.has(task.status));
  if (hasActive) {
    await withSqliteRetry(() => runRepo.update(runId, { collectedCount, validCount, duplicateCount }));
    return;
  }
  await withSqliteRetry(() => runRepo.update(runId, {
    status: validCount > 0 ? "content_ready" : "collection_failed",
    collectedCount,
    validCount,
    duplicateCount,
    errorMessage: validCount > 0 ? null : "all_platform_tasks_failed_or_empty",
    finishedAt: new Date().toISOString()
  }));
}
