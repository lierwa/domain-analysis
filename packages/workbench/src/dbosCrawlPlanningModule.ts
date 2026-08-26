import { randomUUID } from "node:crypto";

import { DBOS } from "@dbos-inc/dbos-sdk";
import type { WorkbenchDb } from "@domain-analysis/db";
import {
  crawlPlanningRuns,
  crawlPlanningStageCheckpoints,
} from "@domain-analysis/db";
import {
  appendInterviewTimelineActivity,
  appendInterviewTimelineText,
  completeInterviewTimeline,
  crawlPlanningRunRequestSchema,
  failInterviewTimeline,
  type CaptureTask,
  type CrawlPlan,
  type CrawlPlanningRuntimeOutput,
  type InterviewMessageTimelinePart,
} from "@domain-analysis/shared";
import { and, asc, eq } from "drizzle-orm";

import { runCrawlPlanningWithStages } from "./codexCrawlPlanningRuntime";
import type { CaptureTaskModule } from "./captureTaskModule";
import {
  boundedError,
  createCrawlPlanningModule,
  CrawlPlanningError,
  finishAbnormal,
  finishCompleted,
  loadView,
  parseEvent,
  requireCurrentTask,
  requireTask,
  validatePlanningOutput,
  type CrawlPlanningModule,
  type CrawlPlanningModuleOptions,
  type CrawlPlanningRuntimeEvent,
} from "./crawlPlanningModule";
import {
  collectCrawlPlanningStage,
  type CollectedCrawlPlanningStage,
  type CrawlPlanningStageCommand,
  type CrawlPlanningStageRuntime,
} from "./crawlPlanningStageRuntime";

type ParentWorkflowInput = {
  runId: string;
  task: CaptureTask;
  instruction?: string;
  previousPlans: CrawlPlan[];
};
type ParentWorkflow = (input: ParentWorkflowInput) => Promise<void>;
type StageWorkflow = (command: CrawlPlanningStageCommand) => Promise<CollectedCrawlPlanningStage>;

export interface OpenDbosCrawlPlanningModuleOptions extends CrawlPlanningModuleOptions {
  systemDatabaseUrl: string;
  stages: CrawlPlanningStageRuntime;
  brandBatchSize?: number;
  applicationName?: string;
  systemDatabaseSchemaName?: string;
  workflowName?: string;
  stageWorkflowName?: string;
  queueName?: string;
  streamPollIntervalMs?: number;
}

export async function openDbosCrawlPlanningModule(
  db: WorkbenchDb,
  captureTasks: CaptureTaskModule,
  options: OpenDbosCrawlPlanningModuleOptions,
): Promise<CrawlPlanningModule> {
  if (DBOS.isInitialized()) {
    throw new CrawlPlanningError("invalid_state", "DBOS 已在当前进程启动");
  }
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((kind: string) => `${kind}-${randomUUID()}`);
  const brandBatchSize = requireBrandBatchSize(options.brandBatchSize);
  const queueName = options.queueName ?? "crawl-planning-stages-v1";
  const stage = DBOS.registerWorkflow(
    (command: CrawlPlanningStageCommand) => executeStage(command, options.stages),
    { name: options.stageWorkflowName ?? "crawlPlanningStageV1" },
  );
  const parent = DBOS.registerWorkflow(
    (input: ParentWorkflowInput) => executeParent(
      db, input, stage, queueName, brandBatchSize, now, createId, options.validateSource,
    ),
    { name: options.workflowName ?? "crawlPlanningV1" },
  );
  DBOS.setConfig({
    name: options.applicationName ?? "domain-analysis-crawl-planning",
    systemDatabaseUrl: options.systemDatabaseUrl,
    systemDatabaseSchemaName: options.systemDatabaseSchemaName ?? "domain_analysis_crawl_planning",
    runAdminServer: false,
    logLevel: "warn",
  });
  await DBOS.launch();
  // WHY：Stage Runtime 复用一条 App Server stdio 连接；成熟 DBOS Queue 负责跨任务单并发，
  // 不能让多个父 workflow 竞争客户端，也不在应用内另造互斥队列。
  await DBOS.registerQueue(queueName, { concurrency: 1 });
  await recoverRunningRuns(db, captureTasks, parent, now);
  const planPolicy = createCrawlPlanningModule(db, captureTasks, inertRuntime(), options);

  return {
    get: async (taskId) => {
      const task = await captureTasks.get(taskId);
      return task ? loadView(db, task) : null;
    },
    // WHY：公开确认/执行门继续复用既有领域模块，DBOS 不解释或放宽 Crawl Plan。
    requireExecutablePlan: (input) => planPolicy.requireExecutablePlan(input),
    run: (input) => startAndProjectRun(
      db, captureTasks, parent, input, now, createId, options.streamPollIntervalMs ?? 500,
    ),
    confirm: (input) => planPolicy.confirm(input),
    close: async () => {
      await DBOS.shutdown();
      await options.stages.close?.();
    },
  };
}

async function executeStage(
  command: CrawlPlanningStageCommand,
  stages: CrawlPlanningStageRuntime,
) {
  return DBOS.runStep(() => collectCrawlPlanningStage(stages, command), {
    name: `crawl-planning-stage:${command.kind}`,
    retriesAllowed: false,
  });
}

async function executeParent(
  db: WorkbenchDb,
  input: ParentWorkflowInput,
  stage: StageWorkflow,
  queueName: string,
  brandBatchSize: number,
  now: () => Date,
  createId: (kind: string) => string,
  validateSource: CrawlPlanningModuleOptions["validateSource"],
) {
  try {
    let completedOutput: CrawlPlanningRuntimeOutput | undefined;
    const durableStages = createDurableStages(db, input.runId, stage, queueName, now);
    for await (const event of runCrawlPlanningWithStages(durableStages, brandBatchSize, {
      task: input.task, instruction: input.instruction, previousPlans: input.previousPlans,
    })) {
      if (event.type === "interrupted") throw new Error("持久规划阶段意外返回中断");
      if (event.type === "completed") completedOutput = event.output;
    }
    if (!completedOutput) throw new Error("持久规划没有返回最终计划候选");
    await DBOS.runStep(async () => {
      const content = await validatePlanningOutput(
        input.task, completedOutput!, now().toISOString(), validateSource,
      );
      const timeline = completeInterviewTimeline(
        await loadCheckpointTimeline(db, input.runId), completedOutput!.assistantText,
      ).slice(-200);
      await finishCompleted(db, input.task, input.runId, content, timeline, now, createId);
    }, { name: "crawl-planning-finalize", retriesAllowed: true, maxAttempts: 3, intervalSeconds: 1 });
  } catch (error) {
    const message = boundedError(error);
    await DBOS.runStep(async () => {
      const timeline = failInterviewTimeline(await loadCheckpointTimeline(db, input.runId)).slice(-200);
      await finishAbnormal(db, input.runId, "failed", message, timeline, now);
    }, { name: "crawl-planning-fail", retriesAllowed: true, maxAttempts: 3, intervalSeconds: 1 });
    throw error;
  }
}

function createDurableStages(
  db: WorkbenchDb,
  runId: string,
  stage: StageWorkflow,
  queueName: string,
  now: () => Date,
): CrawlPlanningStageRuntime {
  let sequence = 0;
  const run = (async function* (command: CrawlPlanningStageCommand) {
    sequence += 1;
    const currentSequence = sequence;
    await DBOS.runStep(() => recordStageStarted(db, runId, currentSequence, command, now), {
      name: `crawl-planning-stage-start:${command.key}`, retriesAllowed: true, maxAttempts: 3,
    });
    try {
      const handle = await DBOS.startWorkflow(stage, {
        workflowID: `${runId}:${command.key}`,
        queueName,
      })(command);
      const collected = await handle.getResult();
      if (collected.kind !== command.kind) throw new Error(`持久阶段结果类型不匹配：${command.key}`);
      await DBOS.runStep(() => recordStageCompleted(db, runId, command.key, collected.events, now), {
        name: `crawl-planning-stage-complete:${command.key}`, retriesAllowed: true, maxAttempts: 3,
      });
      for (const event of collected.events) yield event;
      return { interrupted: false as const, value: collected.value };
    } catch (error) {
      const message = boundedError(error);
      await DBOS.runStep(() => recordStageFailed(db, runId, command.key, message, now), {
        name: `crawl-planning-stage-fail:${command.key}`, retriesAllowed: true, maxAttempts: 3,
      });
      throw error;
    }
  }) as CrawlPlanningStageRuntime["run"];
  return { run };
}

async function* startAndProjectRun(
  db: WorkbenchDb,
  captureTasks: CaptureTaskModule,
  parent: ParentWorkflow,
  input: { taskId: string; expectedTaskRevision: number; instruction?: string; signal?: AbortSignal },
  now: () => Date,
  createId: (kind: string) => string,
  pollIntervalMs: number,
) {
  const request = crawlPlanningRunRequestSchema.parse({
    expectedTaskRevision: input.expectedTaskRevision,
    ...(input.instruction ? { instruction: input.instruction } : {}),
  });
  const task = await requireTask(captureTasks, input.taskId);
  requireCurrentTask(task, request.expectedTaskRevision);
  const running = await db.query.crawlPlanningRuns.findFirst({ where: and(
    eq(crawlPlanningRuns.taskId, task.id), eq(crawlPlanningRuns.status, "running"),
  ) });
  if (running) throw new CrawlPlanningError("invalid_state", "该任务已有后台规划在运行");
  const runId = createId("crawl-planning-run");
  const startedAt = now().toISOString();
  const previousPlans = (await loadView(db, task)).plans;
  await db.insert(crawlPlanningRuns).values({
    id: runId, taskId: task.id, taskRevision: task.revision, instruction: request.instruction,
    status: "running", timelineParts: [], startedAt,
  });
  try {
    await DBOS.startWorkflow(parent, {
      workflowID: runId,
      workflowAttributes: { taskId: task.id, taskRevision: String(task.revision) },
    })({ runId, task, instruction: request.instruction, previousPlans });
  } catch (error) {
    const message = boundedError(error);
    const run = await finishAbnormal(db, runId, "failed", message, [], now);
    yield parseEvent({ type: "run.failed", taskId: task.id, runId, run, error: message });
    return;
  }
  yield parseEvent({ type: "run.started", taskId: task.id, runId });
  while (!input.signal?.aborted) {
    const view = await loadView(db, task);
    const run = view.runs.find((item) => item.id === runId);
    if (!run) throw new Error("后台抓取规划运行记录不存在");
    if (run.status === "completed") {
      const plan = view.plans.find((item) => item.planningRunId === runId);
      if (!plan) throw new Error("后台抓取规划完成但缺少计划草稿");
      yield parseEvent({ type: "run.completed", taskId: task.id, runId, run, plan });
      return;
    }
    if (run.status === "failed") {
      yield parseEvent({ type: "run.failed", taskId: task.id, runId, run, error: run.error! });
      return;
    }
    if (run.status === "interrupted") {
      yield parseEvent({ type: "run.interrupted", taskId: task.id, runId, run });
      return;
    }
    await delay(pollIntervalMs, input.signal);
  }
}

async function recoverRunningRuns(
  db: WorkbenchDb,
  captureTasks: CaptureTaskModule,
  parent: ParentWorkflow,
  now: () => Date,
) {
  const rows = await db.select().from(crawlPlanningRuns).where(eq(crawlPlanningRuns.status, "running"));
  for (const row of rows) {
    try {
      const workflow = await DBOS.getWorkflowStatus(row.id);
      if (workflow) {
        // WHY：launch 已自动恢复已存在 workflow；再次 start 会把 DBOS 内部队列误报为 queue 冲突。
        // Workbench 只在 DBOS 已进入不可恢复终态时收口领域状态，不从内部步骤表重建进度。
        if (["ERROR", "MAX_RECOVERY_ATTEMPTS_EXCEEDED", "CANCELLED", "SUCCESS"]
          .includes(workflow.status)) {
          throw new Error(`DBOS workflow 已终结但 Planning Run 仍在运行：${workflow.status}`);
        }
        continue;
      }
      const task = await requireTask(captureTasks, row.taskId);
      if (task.revision !== row.taskRevision || task.status !== "ready") {
        throw new Error("任务版本或状态已变化，不能恢复规划");
      }
      const previousPlans = (await loadView(db, task)).plans;
      await DBOS.startWorkflow(parent, { workflowID: row.id,
        workflowAttributes: { taskId: task.id, taskRevision: String(task.revision) } })({
        runId: row.id, task, instruction: row.instruction ?? undefined, previousPlans,
      });
    } catch (error) {
      const message = boundedError(error);
      const timeline = failInterviewTimeline(await loadCheckpointTimeline(db, row.id)).slice(-200);
      await finishAbnormal(db, row.id, "failed", message, timeline, now);
    }
  }
}

async function recordStageStarted(
  db: WorkbenchDb,
  runId: string,
  sequence: number,
  command: CrawlPlanningStageCommand,
  now: () => Date,
) {
  const timelineParts = appendInterviewTimelineText([], `\n\n${command.label}`);
  await db.insert(crawlPlanningStageCheckpoints).values({
    runId, stageKey: command.key, sequence, label: command.label,
    status: "running", timelineParts, startedAt: now().toISOString(),
  }).onConflictDoNothing({ target: [
    crawlPlanningStageCheckpoints.runId, crawlPlanningStageCheckpoints.stageKey,
  ] });
  await refreshRunTimeline(db, runId);
}

async function recordStageCompleted(
  db: WorkbenchDb,
  runId: string,
  stageKey: string,
  events: CrawlPlanningRuntimeEvent[],
  now: () => Date,
) {
  const existing = await db.query.crawlPlanningStageCheckpoints.findFirst({ where: and(
    eq(crawlPlanningStageCheckpoints.runId, runId), eq(crawlPlanningStageCheckpoints.stageKey, stageKey),
  ) });
  if (existing?.status === "completed") return;
  const timelineParts = eventsToTimeline(events).slice(-200);
  await db.update(crawlPlanningStageCheckpoints).set({
    status: "completed", timelineParts, error: null, finishedAt: now().toISOString(),
  }).where(and(eq(crawlPlanningStageCheckpoints.runId, runId),
    eq(crawlPlanningStageCheckpoints.stageKey, stageKey)));
  await refreshRunTimeline(db, runId);
}

async function recordStageFailed(
  db: WorkbenchDb,
  runId: string,
  stageKey: string,
  error: string,
  now: () => Date,
) {
  const row = await db.query.crawlPlanningStageCheckpoints.findFirst({ where: and(
    eq(crawlPlanningStageCheckpoints.runId, runId), eq(crawlPlanningStageCheckpoints.stageKey, stageKey),
  ) });
  if (!row || row.status === "completed") return;
  await db.update(crawlPlanningStageCheckpoints).set({
    status: "failed", timelineParts: failInterviewTimeline(row.timelineParts),
    error, finishedAt: now().toISOString(),
  }).where(and(eq(crawlPlanningStageCheckpoints.runId, runId),
    eq(crawlPlanningStageCheckpoints.stageKey, stageKey)));
  await refreshRunTimeline(db, runId);
}

function eventsToTimeline(events: CrawlPlanningRuntimeEvent[]) {
  let parts: InterviewMessageTimelinePart[] = [];
  for (const event of events) {
    if (event.type === "activity") parts = appendInterviewTimelineActivity(parts, event.activity);
    if (event.type === "text_delta") parts = appendInterviewTimelineText(parts, event.delta);
  }
  return parts;
}

async function refreshRunTimeline(db: WorkbenchDb, runId: string) {
  const timelineParts = await loadCheckpointTimeline(db, runId);
  await db.update(crawlPlanningRuns).set({ timelineParts: timelineParts.slice(-200) })
    .where(and(eq(crawlPlanningRuns.id, runId), eq(crawlPlanningRuns.status, "running")));
}

async function loadCheckpointTimeline(db: WorkbenchDb, runId: string) {
  const rows = await db.select({ timelineParts: crawlPlanningStageCheckpoints.timelineParts })
    .from(crawlPlanningStageCheckpoints)
    .where(eq(crawlPlanningStageCheckpoints.runId, runId))
    .orderBy(asc(crawlPlanningStageCheckpoints.sequence));
  return rows.flatMap((row) => row.timelineParts).slice(-200);
}

function inertRuntime() {
  return {
    async *run(): AsyncIterable<CrawlPlanningRuntimeEvent> {
      throw new Error("持久规划模块不使用前台 Runtime");
    },
  };
}

function requireBrandBatchSize(value: number | undefined) {
  const size = value ?? 3;
  if (!Number.isInteger(size) || size < 1 || size > 10) {
    throw new Error("品牌规划批量必须是 1 到 10 的整数");
  }
  return size;
}

function delay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
