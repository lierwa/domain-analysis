import type { SourceCollectionRun } from "@domain-analysis/shared";

import type { SourceDatasetModule } from "./sourceDatasetModule";
import { SourceExecutionError } from "./sourceExecutionError";
import { sourceBatchOutcome } from "./sourceExecutionOutcome";

export function latestRunsBySource(runs: SourceCollectionRun[]) {
  const latest = new Map<string, SourceCollectionRun>();
  for (const run of runs) {
    if (run.sourceCollectionPlanSourceKey) latest.set(run.sourceCollectionPlanSourceKey, run);
  }
  return latest;
}

export async function isSafeAutomaticRecovery(datasets: SourceDatasetModule, run: SourceCollectionRun) {
  if (run.failureCategory !== "execution_process_lost" || run.snapshotCount > 0) return false;
  const view = await datasets.getRun(run.id);
  if (!view) return false;
  return !view.requestAttempts.some((attempt) => attempt.state === "started"
    || (attempt.state === "cancelled" && attempt.restrictionReason === "request_outcome_unknown"));
}

export async function findResumeRootRunId(datasets: SourceDatasetModule, run: SourceCollectionRun) {
  const seen = new Set<string>();
  let current = run;
  while (current.resumedFromRunId) {
    if (seen.has(current.id)) throw new SourceExecutionError("invalid_state", "Source Run 恢复链形成循环");
    seen.add(current.id);
    const parent = await datasets.getRun(current.resumedFromRunId);
    if (!parent) throw new SourceExecutionError("invalid_state", "Source Run 恢复链不完整");
    current = parent.run;
  }
  return current.id;
}

export async function finalizeResumedBatch(
  datasets: SourceDatasetModule,
  batchId: string,
  aborted: boolean,
) {
  const batch = await datasets.getBatch(batchId);
  if (!batch || batch.status !== "running") return;
  const latest = [...latestRunsBySource(await datasets.listBatchRuns(batchId)).values()];
  const counts = { completed: 0, failed: Math.max(0, batch.plannedSourceCount - latest.length), stopped: 0 };
  for (const run of latest) {
    if (run.status === "completed") counts.completed += 1;
    else if (run.status === "stopped") counts.stopped += 1;
    else counts.failed += 1;
  }
  await datasets.finishBatch({ batchId, ...sourceBatchOutcome(counts, batch.plannedSourceCount, aborted) });
  await datasets.setBatchRecoveryState(batchId, "completed");
}
