import {
  createAnalysisRunRepository,
  createCrawlTaskRepository,
  type AppDb
} from "@domain-analysis/db";

export interface RecoverStaleCollectionRunsOptions {
  now: Date;
  staleAfterMs: number;
}

export async function recoverStaleCollectionRuns(
  db: AppDb,
  options: RecoverStaleCollectionRunsOptions
) {
  const nowIso = options.now.toISOString();
  const cutoffIso = new Date(options.now.getTime() - options.staleAfterMs).toISOString();
  const runRepo = createAnalysisRunRepository(db);
  const taskRepo = createCrawlTaskRepository(db);
  const runsPage = await runRepo.listPage({ page: 1, pageSize: 1000 }, { status: "collecting" });
  const staleRunIds = runsPage.items
    .filter((run) => Boolean(run.startedAt && run.startedAt <= cutoffIso))
    .map((run) => run.id);

  if (staleRunIds.length === 0) {
    return { recoveredRuns: 0, recoveredTasks: 0 };
  }

  const allTasks = await taskRepo.list();
  const staleTasks = allTasks.filter(
    (task) =>
      staleRunIds.includes(task.analysisRunId) &&
      (task.status === "pending" || task.status === "running")
  );

  // WHY: worker/API 崩溃或 DB 路径错配后，running 不会自然完成；启动恢复必须显式落终态，避免 UI 永久 collecting。
  for (const task of staleTasks) {
    await taskRepo.update(task.id, {
      status: "failed",
      errorMessage: "stale_collection_recovered",
      stopReason: "error",
      finishedAt: nowIso,
    });
  }

  for (const runId of staleRunIds) {
    await runRepo.update(runId, {
      status: "collection_failed",
      errorMessage: "stale_collection_recovered",
      finishedAt: nowIso
    });
  }

  return { recoveredRuns: staleRunIds.length, recoveredTasks: staleTasks.length };
}
