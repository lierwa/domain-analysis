import type { WorkbenchDb } from "@domain-analysis/db";
import { sourceCollectionBatches, sourceCollectionRuns } from "@domain-analysis/db";
import { asc, and, eq } from "drizzle-orm";

import { acquireSourceExecutionLease, tryAcquireSourceExecutionLease } from "./sourceExecutionLease";
import { prepareSourceRunForResume } from "./sourceRequestAdmission";

export function acquireSourceBatchLease(db: WorkbenchDb, batchId: string) {
  return acquireSourceExecutionLease(db, "source-batch-lease", batchId,
    "Source Collection Batch 仍由活动执行进程持有");
}

export async function recoverInterruptedSourceBatches(db: WorkbenchDb, taskId?: string) {
  const batches = await db.select({ id: sourceCollectionBatches.id })
    .from(sourceCollectionBatches).where(taskId
      ? and(eq(sourceCollectionBatches.status, "running"), eq(sourceCollectionBatches.taskId, taskId))
      : eq(sourceCollectionBatches.status, "running"))
    .orderBy(asc(sourceCollectionBatches.startedAt));
  const recovered: string[] = [];
  for (const batch of batches) {
    const lease = await tryAcquireSourceExecutionLease(db, "source-batch-lease", batch.id);
    if (!lease) continue;
    try {
      const runs = await db.select({ id: sourceCollectionRuns.id }).from(sourceCollectionRuns)
        .where(and(eq(sourceCollectionRuns.executionBatchId, batch.id),
          eq(sourceCollectionRuns.status, "running")));
      for (const run of runs) await prepareSourceRunForResume(db, run.id);
      const changed = await db.update(sourceCollectionBatches).set({ status: "stopped",
        finishedAt: new Date().toISOString(), terminationReason: "execution_process_lost" })
        .where(and(eq(sourceCollectionBatches.id, batch.id),
          eq(sourceCollectionBatches.status, "running"))).returning({ id: sourceCollectionBatches.id });
      if (changed.length === 1) recovered.push(batch.id);
    } finally { await lease.release(); }
  }
  return recovered;
}
