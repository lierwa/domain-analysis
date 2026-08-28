import type { WorkbenchDb } from "@domain-analysis/db";
import { sourceCollectionBatches, sourceCollectionRuns } from "@domain-analysis/db";
import { asc, and, eq, isNotNull, or } from "drizzle-orm";

import { acquireSourceExecutionLease, tryAcquireSourceExecutionLease } from "./sourceExecutionLease";
import { prepareSourceRunForResume } from "./sourceRequestAdmission";

export function acquireSourceBatchLease(db: WorkbenchDb, batchId: string) {
  return acquireSourceExecutionLease(db, "source-batch-lease", batchId,
    "Source Collection Batch 仍由活动执行进程持有");
}

export async function recoverInterruptedSourceBatches(db: WorkbenchDb, taskId?: string) {
  const runningBatches = await db.select({ id: sourceCollectionBatches.id })
    .from(sourceCollectionBatches).where(taskId
      ? and(or(eq(sourceCollectionBatches.status, "running"),
          eq(sourceCollectionBatches.recoveryState, "running")), eq(sourceCollectionBatches.taskId, taskId))
      : or(eq(sourceCollectionBatches.status, "running"), eq(sourceCollectionBatches.recoveryState, "running")))
    .orderBy(asc(sourceCollectionBatches.startedAt));
  const batchesWithRunningRuns = await db.select({ id: sourceCollectionRuns.executionBatchId })
    .from(sourceCollectionRuns).innerJoin(sourceCollectionBatches,
      eq(sourceCollectionBatches.id, sourceCollectionRuns.executionBatchId))
    .where(taskId
      ? and(eq(sourceCollectionRuns.status, "running"), isNotNull(sourceCollectionRuns.executionBatchId),
          eq(sourceCollectionBatches.taskId, taskId))
      : and(eq(sourceCollectionRuns.status, "running"), isNotNull(sourceCollectionRuns.executionBatchId)));
  const batchIds = [...new Set([...runningBatches.map((batch) => batch.id),
    ...batchesWithRunningRuns.flatMap((batch) => batch.id ? [batch.id] : [])])];
  const recovered: string[] = [];
  for (const batchId of batchIds) {
    const lease = await tryAcquireSourceExecutionLease(db, "source-batch-lease", batchId);
    if (!lease) continue;
    try {
      const runs = await db.select({ id: sourceCollectionRuns.id }).from(sourceCollectionRuns)
        .where(and(eq(sourceCollectionRuns.executionBatchId, batchId),
          eq(sourceCollectionRuns.status, "running")));
      for (const run of runs) await prepareSourceRunForResume(db, run.id);
      const changed = await db.update(sourceCollectionBatches).set({ status: "stopped",
        recoveryState: "pending", finishedAt: new Date().toISOString(),
        terminationReason: "execution_process_lost" })
        .where(and(eq(sourceCollectionBatches.id, batchId), or(
          eq(sourceCollectionBatches.status, "running"),
          eq(sourceCollectionBatches.recoveryState, "running"))))
        .returning({ id: sourceCollectionBatches.id });
      if (changed.length === 1 || runs.length > 0) recovered.push(batchId);
    } finally { await lease.release(); }
  }
  return recovered;
}
