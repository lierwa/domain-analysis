import { randomUUID } from "node:crypto";

import {
  sourceExecutionAcceptanceSchema,
  sourceExecutionPlanRequestSchema,
  type SourceExecutionAcceptance,
} from "@domain-analysis/shared";
import type {
  SourceDatasetModule,
  SourceExecutionModule,
  SourceExecutionRecoveryRequest,
} from "@domain-analysis/workbench";
import { makeWorkerUtils, run, type TaskList } from "graphile-worker";
import { Pool } from "pg";
import { z } from "zod";

const taskIdentifier = "execute_source_collection";
const queueIdentifier = "source_collection";
const recoveryTaskIdentifier = "schedule_source_recovery";
const commandBaseSchema = z.object({
  commandId: z.string().min(1).max(240),
  taskId: z.string().min(1).max(240),
  expectedTaskRevision: z.number().int().positive(),
  expectedPlanVersion: z.number().int().positive(),
});
const commandSchema = z.discriminatedUnion("kind", [
  commandBaseSchema.extend({ kind: z.literal("start"), planId: z.string().min(1).max(240) }).strict(),
  commandBaseSchema.extend({ kind: z.literal("resume"), runId: z.string().min(1).max(240) }).strict(),
]);

type StartInput = { taskId: string; planId: string; expectedTaskRevision: number; expectedPlanVersion: number };
type ResumeInput = { taskId: string; runId: string; expectedTaskRevision: number; expectedPlanVersion: number };

export interface SourceExecutionQueue {
  enqueueStart(input: StartInput): Promise<SourceExecutionAcceptance>;
  enqueueResume(input: ResumeInput): Promise<SourceExecutionAcceptance>;
  close(): Promise<void>;
}

export async function createSourceExecutionQueue(input: {
  connectionString: string;
  execution: SourceExecutionModule;
  datasets?: Pick<SourceDatasetModule, "listUnfinishedBatches" | "getActiveBatchForTask">;
  pgPool?: Pool;
}): Promise<SourceExecutionQueue> {
  const ownsPool = !input.pgPool;
  const pgPool = input.pgPool ?? createPgPool(input.connectionString);
  const workerUtils = await makeWorkerUtils({ pgPool });
  await workerUtils.migrate();
  await unlockTerminatedSourceWorkers(pgPool, workerUtils);
  let closed = false;

  async function enqueue(command: z.infer<typeof commandSchema>, options: EnqueueOptions = {}) {
    if (closed) throw new Error("来源执行队列已经关闭");
    await workerUtils.addJob(taskIdentifier, command, {
      queueName: queueIdentifier,
      jobKey: options.jobKey ?? command.commandId,
      jobKeyMode: options.jobKeyMode,
      runAt: options.runAt,
      // WHY：来源限制和 Provider 失败已经写入 Batch/Run；队列自动重试会制造第二轮真实请求。
      maxAttempts: 1,
    });
    return sourceExecutionAcceptanceSchema.parse({ status: "accepted", commandId: command.commandId });
  }

  const enqueueAutomaticResume = async (request: SourceExecutionRecoveryRequest) => {
    const commandId = `source-auto-resume-${request.runId}`;
    await enqueue(commandSchema.parse({ kind: "resume", commandId, taskId: request.taskId,
      runId: request.runId, expectedTaskRevision: request.expectedTaskRevision,
      expectedPlanVersion: request.expectedPlanVersion }), {
      jobKey: commandId, jobKeyMode: "preserve_run_at", runAt: request.runAt,
    });
  };
  const scheduleRecovery = async (inputValue: { batchId: string } | { commandId: string } | { runId: string }) => {
    const requests = await input.execution.automaticResumeRequests(inputValue);
    for (const request of requests) await enqueueAutomaticResume(request);
  };
  const scanUnfinishedBatches = async () => {
    if (!input.datasets) return;
    for (const batch of await input.datasets.listUnfinishedBatches()) {
      await scheduleRecovery({ batchId: batch.id });
    }
  };
  const runner = await run({
    pgPool,
    concurrency: 1,
    noHandleSignals: true,
    crontab: `* * * * * ${recoveryTaskIdentifier} ?queue=${queueIdentifier}&max=1`,
    taskList: createSourceExecutionTaskList(input.execution, async (command) => {
      await scheduleRecovery(command.kind === "start"
        ? { commandId: command.commandId } : { runId: command.runId });
    }, scanUnfinishedBatches),
  });

  await scanUnfinishedBatches();

  return {
    enqueueStart: async (raw) => {
      const request = sourceExecutionPlanRequestSchema.parse({
        expectedTaskRevision: raw.expectedTaskRevision,
        expectedPlanVersion: raw.expectedPlanVersion,
      });
      // WHY：202 之前先重读 confirmed plan 和 Provider readiness，避免明显无效命令只留在后台日志。
      await input.execution.prepare({ taskId: raw.taskId, planId: raw.planId, ...request });
      const active = await input.datasets?.getActiveBatchForTask(raw.taskId);
      if (active) return sourceExecutionAcceptanceSchema.parse({ status: "already_running",
        commandId: active.commandId ?? active.id, batchId: active.id });
      return enqueue(commandSchema.parse({ kind: "start", commandId: createCommandId(), ...raw }));
    },
    enqueueResume: async (raw) => enqueue(commandSchema.parse({
      kind: "resume", commandId: createCommandId(), ...raw,
    })),
    close: async () => {
      if (closed) return;
      closed = true;
      await runner.stop();
      await workerUtils.release();
      if (ownsPool) await pgPool.end();
    },
  };
}

async function unlockTerminatedSourceWorkers(
  pgPool: Pool,
  workerUtils: Awaited<ReturnType<typeof makeWorkerUtils>>,
) {
  const result = await pgPool.query<{ locked_by: string }>(`
    select distinct jobs.locked_by
    from graphile_worker.jobs jobs
    where jobs.queue_name = $1
      and jobs.task_identifier = $2
      and jobs.locked_by is not null
      and (
        exists (
          select 1 from workbench.source_collection_batches batches
          where batches.command_id = jobs.key
            and batches.status in ('completed', 'partial', 'failed', 'stopped')
        )
        or exists (
          select 1 from workbench.source_collection_runs runs
          where runs.execution_command_id = jobs.key
            and runs.status in ('completed', 'failed', 'stopped')
        )
      )
  `, [queueIdentifier, taskIdentifier]);
  const workerIds = result.rows.map((row) => row.locked_by);
  // WHY：Graphile 默认保留崩溃锁 4 小时；只释放已由 Batch 或 Run 终态证明退出的 Worker。
  // Resume 使用自己的 commandId 关联新 Run，不能误用最初 Start 的 Batch commandId。
  if (workerIds.length > 0) await workerUtils.forceUnlockWorkers(workerIds);
}

function createPgPool(connectionString: string) {
  const pool = new Pool({ connectionString });
  const ignoreHandledPoolError = () => undefined;
  pool.on("error", ignoreHandledPoolError);
  pool.on("connect", (client) => void client.on("error", ignoreHandledPoolError));
  return pool;
}

type EnqueueOptions = {
  runAt?: Date;
  jobKey?: string;
  jobKeyMode?: "preserve_run_at";
};

export function createSourceExecutionTaskList(
  execution: SourceExecutionModule,
  onCommandCompleted: (command: z.infer<typeof commandSchema>) => Promise<void> = async () => undefined,
  onRecoverySweep: () => Promise<void> = async () => undefined,
): TaskList {
  return {
    [taskIdentifier]: async (rawPayload: unknown) => {
      const command = commandSchema.parse(rawPayload);
      const events = command.kind === "start"
        ? execution.start({ taskId: command.taskId, planId: command.planId,
          expectedTaskRevision: command.expectedTaskRevision, expectedPlanVersion: command.expectedPlanVersion,
          commandId: command.commandId })
        : execution.resume({ taskId: command.taskId, runId: command.runId,
          expectedTaskRevision: command.expectedTaskRevision, expectedPlanVersion: command.expectedPlanVersion,
          commandId: command.commandId });
      // WHY：HTTP 已返回；完整消费领域流，Batch/Run 才能把终态写回唯一事实源。
      for await (const _event of events) { /* progress is read from Source Dataset */ }
      await onCommandCompleted(command);
    },
    [recoveryTaskIdentifier]: async () => { await onRecoverySweep(); },
  };
}

function createCommandId() { return `source-command-${randomUUID()}`; }
