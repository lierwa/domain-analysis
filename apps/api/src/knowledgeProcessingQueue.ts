import type { KnowledgeProcessingModule } from "@domain-analysis/workbench";
import { makeWorkerUtils, run } from "graphile-worker";
import { Pool } from "pg";

export async function createKnowledgeProcessingQueue(connectionString: string, processing: KnowledgeProcessingModule) {
  const pgPool = new Pool({ connectionString });
  const handledPoolError = () => undefined;
  pgPool.on("error", handledPoolError);
  pgPool.on("connect", client => { client.on("error", handledPoolError); });
  const workerUtils = await makeWorkerUtils({ pgPool });
  await workerUtils.migrate();
  await processing.recoverInterrupted();
  const workers = await pgPool.query<{ locked_by: string }>(`select distinct jobs.locked_by from graphile_worker.jobs jobs
    where jobs.queue_name='knowledge_processing' and jobs.task_identifier='execute_knowledge_processing'
    and jobs.locked_by is not null and (
      exists(select 1 from workbench.knowledge_runs r where jobs.key='extract:'||r.id||':'||r.generation
        and r.status in ('completed','partial','stopped','failed'))
      or exists(select 1 from workbench.knowledge_versions v where jobs.key='build:'||v.id
        and v.status in ('ready','published','failed')))`);
  // WHY：沿用来源队列的崩溃恢复边界，只释放领域终态已确认失去执行者的任务。
  if (workers.rows.length) await workerUtils.forceUnlockWorkers(workers.rows.map(row => row.locked_by));
  const runner = await run({ pgPool, concurrency: 1, noHandleSignals: true,
    taskList: { execute_knowledge_processing: async (value: unknown) => processing.execute(value) } });
  return { async close() { await runner.stop(); await workerUtils.release(); await pgPool.end(); } };
}
