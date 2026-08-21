import { randomUUID } from "node:crypto";

import { sourceExecutionAcceptanceSchema, startCrawlPlanSchema,
  type SourceExecutionAcceptance } from "@domain-analysis/shared";
import type { SourceExecutionModule } from "@domain-analysis/workbench";
import { makeWorkerUtils, run, type TaskList } from "graphile-worker";
import { z } from "zod";

const defaultTaskIdentifier = "execute_source_collection";
const defaultQueueIdentifier = "source_collection";
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
  taskIdentifier?: string;
  queueIdentifier?: string;
}): Promise<SourceExecutionQueue> {
  const taskIdentifier = input.taskIdentifier ?? defaultTaskIdentifier;
  const queueIdentifier = input.queueIdentifier ?? defaultQueueIdentifier;
  const workerUtils = await makeWorkerUtils({ connectionString: input.connectionString });
  await workerUtils.migrate();
  const runner = await run({
    connectionString: input.connectionString,
    concurrency: 1,
    noHandleSignals: true,
    crontab: "",
    taskList: createSourceExecutionTaskList(input.execution, taskIdentifier),
  });
  let closed = false;

  async function enqueue(command: z.infer<typeof commandSchema>) {
    if (closed) throw new Error("来源执行队列已经关闭");
    await workerUtils.addJob(taskIdentifier, command, {
      queueName: queueIdentifier,
      jobKey: command.commandId,
      // WHY：来源限制和 Provider 失败已经写入 Batch/Run；自动重试会制造第二轮真实请求。
      maxAttempts: 1,
    });
    return sourceExecutionAcceptanceSchema.parse({ status: "accepted", commandId: command.commandId });
  }

  return {
    enqueueStart: async (raw) => {
      const request = startCrawlPlanSchema.parse({ expectedTaskRevision: raw.expectedTaskRevision,
        expectedPlanVersion: raw.expectedPlanVersion });
      // WHY：202 之前先重读 confirmed plan 和 Provider readiness，避免明显无效命令只在后台日志失败。
      await input.execution.prepare({ taskId: raw.taskId, planId: raw.planId, ...request });
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
    },
  };
}

export function createSourceExecutionTaskList(
  execution: SourceExecutionModule,
  taskIdentifier = defaultTaskIdentifier,
): TaskList {
  return {
    [taskIdentifier]: async (rawPayload) => {
      const command = commandSchema.parse(rawPayload);
      const events = command.kind === "start"
        ? execution.start({ taskId: command.taskId, planId: command.planId,
          expectedTaskRevision: command.expectedTaskRevision, expectedPlanVersion: command.expectedPlanVersion })
        : execution.resume({ taskId: command.taskId, runId: command.runId,
          expectedTaskRevision: command.expectedTaskRevision, expectedPlanVersion: command.expectedPlanVersion });
      // WHY：HTTP 已经返回；消费完整领域流才能让 Batch/Run 自己持久化终态，事件不再绑定浏览器连接。
      for await (const _event of events) {
        // 用户进度只从 Source Dataset 读取，Graphile job 不成为第二套状态投影。
      }
    },
  };
}

function createCommandId() {
  return `source-command-${randomUUID()}`;
}
