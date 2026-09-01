import { randomUUID } from "node:crypto";

import {
  crawlPlanningRuns,
  sourceCollectionPlans,
  type WorkbenchDb,
} from "@domain-analysis/db";
import {
  appendInterviewTimelineActivity,
  appendInterviewTimelineText,
  completeInterviewTimeline,
  crawlPlanContentSchema,
  crawlPlanningEventSchema,
  crawlPlanningRunRequestSchema,
  crawlPlanningRunSchema,
  crawlPlanningViewSchema,
  failInterviewTimeline,
  type CaptureTask,
  type CrawlPlanContent,
  type CrawlPlanningEvent,
  type CrawlPlanningRun,
  type CrawlPlanningView,
  type InterviewMessageTimelinePart,
  type InterviewTurnActivity,
  type SourceCoverageAssessment,
} from "@domain-analysis/shared";
import { and, desc, eq } from "drizzle-orm";

import type { CaptureTaskModule } from "./captureTaskModule";
import type { CrawlPlanModule } from "./crawlPlanModule";
import type { SourceCoverageModule } from "./sourceCoverageModule";

export type CrawlPlanningRuntimeEvent =
  | { type: "activity"; activity: InterviewTurnActivity }
  | { type: "text_delta"; delta: string }
  | { type: "completed"; assistantText: string; content: CrawlPlanContent }
  | { type: "interrupted" };

export interface CrawlPlanningRuntime {
  run(input: {
    task: CaptureTask;
    instruction?: string;
    coverage: SourceCoverageAssessment;
    signal?: AbortSignal;
  }): AsyncIterable<CrawlPlanningRuntimeEvent>;
  close?(): Promise<void>;
}

export interface CrawlPlanningModule {
  get(taskId: string): Promise<CrawlPlanningView | null>;
  run(input: {
    taskId: string;
    expectedTaskRevision: number;
    instruction?: string;
    signal?: AbortSignal;
  }): AsyncIterable<CrawlPlanningEvent>;
  confirm(input: {
    taskId: string;
    planId: string;
    expectedTaskRevision: number;
  }): Promise<CrawlPlanningView>;
}

export class CrawlPlanningError extends Error {
  constructor(
    readonly code: "not_found" | "revision_conflict" | "invalid_state",
    message: string,
  ) {
    super(message);
    this.name = "CrawlPlanningError";
  }
}

export function createCrawlPlanningModule(
  db: WorkbenchDb,
  tasks: CaptureTaskModule,
  plans: CrawlPlanModule,
  runtime: CrawlPlanningRuntime,
  coverage: SourceCoverageModule,
  validateSource?: (source: CrawlPlanContent["sources"][number]) => void,
  now: () => Date = () => new Date(),
): CrawlPlanningModule {
  const get = (taskId: string) => loadView(db, tasks, plans, taskId);
  return {
    get,
    run: (input) => runPlanning({ db, tasks, plans, runtime, coverage, validateSource, now, input }),
    confirm: async (input) => {
      await plans.confirmDraft(input);
      const view = await get(input.taskId);
      if (!view) throw new CrawlPlanningError("not_found", `Capture Task 不存在：${input.taskId}`);
      return view;
    },
  };
}

type PlanningContext = {
  db: WorkbenchDb;
  tasks: CaptureTaskModule;
  plans: CrawlPlanModule;
  runtime: CrawlPlanningRuntime;
  coverage: SourceCoverageModule;
  validateSource?: (source: CrawlPlanContent["sources"][number]) => void;
  now: () => Date;
  input: { taskId: string; expectedTaskRevision: number; instruction?: string; signal?: AbortSignal };
};

async function* runPlanning(context: PlanningContext): AsyncGenerator<CrawlPlanningEvent> {
  const request = crawlPlanningRunRequestSchema.parse({
    expectedTaskRevision: context.input.expectedTaskRevision,
    ...(context.input.instruction ? { instruction: context.input.instruction } : {}),
  });
  const task = await requireReadyTask(context.tasks, context.input.taskId, request.expectedTaskRevision);
  const coverage = await context.coverage.assessTask(task.id);
  if (coverage.status === "in_progress") {
    throw new CrawlPlanningError("invalid_state", "现有来源仍在执行，终态后才能规划资料缺口");
  }
  if (coverage.status === "satisfied") {
    throw new CrawlPlanningError("invalid_state", "该任务的阶段 1 原始资料已经达到最低覆盖门");
  }
  const active = await context.db.query.crawlPlanningRuns.findFirst({
    where: and(eq(crawlPlanningRuns.taskId, task.id), eq(crawlPlanningRuns.status, "running")),
  });
  if (active) throw new CrawlPlanningError("invalid_state", "该任务已有 Planning Run 正在执行");

  const runId = `crawl-planning-run-${randomUUID()}`;
  const startedAt = context.now().toISOString();
  let timelineParts: InterviewMessageTimelinePart[] = [];
  await context.db.insert(crawlPlanningRuns).values({
    id: runId,
    taskId: task.id,
    taskRevision: task.revision,
    instruction: request.instruction,
    status: "running",
    timelineParts,
    startedAt,
  });
  yield parseEvent({ type: "run.started", taskId: task.id, runId });

  try {
    for await (const event of context.runtime.run({ task, instruction: request.instruction,
      coverage, signal: context.input.signal })) {
      if (event.type === "activity") {
        timelineParts = boundedParts(appendInterviewTimelineActivity(timelineParts, event.activity));
        await updateTimeline(context.db, runId, timelineParts);
        yield parseEvent({ type: "run.activity", taskId: task.id, runId, activity: event.activity });
        continue;
      }
      if (event.type === "text_delta") {
        timelineParts = boundedParts(appendInterviewTimelineText(timelineParts, event.delta));
        await updateTimeline(context.db, runId, timelineParts);
        yield parseEvent({ type: "assistant.delta", taskId: task.id, runId, delta: event.delta });
        continue;
      }
      if (event.type === "interrupted") {
        const finishedAt = context.now().toISOString();
        await context.db.update(crawlPlanningRuns).set({ status: "interrupted", timelineParts, finishedAt })
          .where(eq(crawlPlanningRuns.id, runId));
        const run = normalizeRun({ id: runId, taskId: task.id, taskRevision: task.revision,
          instruction: request.instruction, status: "interrupted", timelineParts, startedAt, finishedAt });
        yield parseEvent({ type: "run.interrupted", taskId: task.id, runId, run });
        return;
      }

      yield await completePlanningRun(context, task, runId, startedAt, request.instruction,
        timelineParts, event);
      return;
    }
    throw new Error("Planning Runtime 未返回完成结果");
  } catch (error) {
    const publicError = boundedError(error);
    timelineParts = boundedParts(failInterviewTimeline(timelineParts));
    const finishedAt = context.now().toISOString();
    await context.db.update(crawlPlanningRuns).set({ status: "failed", timelineParts,
      error: publicError, finishedAt }).where(eq(crawlPlanningRuns.id, runId));
    const run = normalizeRun({ id: runId, taskId: task.id, taskRevision: task.revision,
      instruction: request.instruction, status: "failed", timelineParts, error: publicError,
      startedAt, finishedAt });
    yield parseEvent({ type: "run.failed", taskId: task.id, runId, run, error: publicError });
  }
}

async function completePlanningRun(
  context: PlanningContext,
  task: CaptureTask,
  runId: string,
  startedAt: string,
  instruction: string | undefined,
  timelineParts: InterviewMessageTimelinePart[],
  event: Extract<CrawlPlanningRuntimeEvent, { type: "completed" }>,
) {
  const content = crawlPlanContentSchema.parse(event.content);
  if (content.taskId !== task.id || content.taskRevision !== task.revision) {
    throw new CrawlPlanningError("revision_conflict", "规划结果与当前 Capture Task revision 不一致");
  }
  for (const source of content.sources) context.validateSource?.(source);
  const plan = await context.plans.publishDraft({ taskId: task.id,
    expectedTaskRevision: task.revision, planningRunId: runId, content });
  const completedParts = boundedParts(completeInterviewTimeline(timelineParts, event.assistantText));
  const finishedAt = context.now().toISOString();
  await context.db.update(crawlPlanningRuns).set({ status: "completed", timelineParts: completedParts, finishedAt })
    .where(eq(crawlPlanningRuns.id, runId));
  const run = normalizeRun({ id: runId, taskId: task.id, taskRevision: task.revision,
    instruction, status: "completed", timelineParts: completedParts, planId: plan.id,
    startedAt, finishedAt });
  return parseEvent({ type: "run.completed", taskId: task.id, runId, run, plan });
}

async function loadView(
  db: WorkbenchDb,
  tasks: CaptureTaskModule,
  plans: CrawlPlanModule,
  taskId: string,
): Promise<CrawlPlanningView | null> {
  const task = await tasks.get(taskId);
  if (!task) return null;
  const [runRows, taskPlans] = await Promise.all([
    db.select().from(crawlPlanningRuns).where(eq(crawlPlanningRuns.taskId, taskId))
      .orderBy(desc(crawlPlanningRuns.startedAt)),
    plans.listForTask(taskId),
  ]);
  const planByRun = new Map(taskPlans.flatMap((plan) => plan.planningRunId
    ? [[plan.planningRunId, plan.id] as const] : []));
  return crawlPlanningViewSchema.parse({
    taskId,
    taskRevision: task.revision,
    runs: runRows.map((row) => normalizeRun({ ...row, planId: planByRun.get(row.id) })),
    plans: taskPlans,
  });
}

async function requireReadyTask(tasks: CaptureTaskModule, taskId: string, expectedRevision: number) {
  const task = await tasks.get(taskId);
  if (!task) throw new CrawlPlanningError("not_found", `Capture Task 不存在：${taskId}`);
  if (task.revision !== expectedRevision) {
    throw new CrawlPlanningError("revision_conflict", "Capture Task 已经更新，请刷新后重试");
  }
  if (task.status !== "ready" || !task.confirmedAt) {
    throw new CrawlPlanningError("invalid_state", "只有已确认的 Capture Task 可以启动 Planning Run");
  }
  return task;
}

function normalizeRun(input: {
  id: string;
  taskId: string;
  taskRevision: number;
  instruction?: string | null;
  status: string;
  timelineParts: unknown;
  planId?: string;
  error?: string | null;
  startedAt: string | Date;
  finishedAt?: string | Date | null;
}): CrawlPlanningRun {
  return crawlPlanningRunSchema.parse({
    ...input,
    instruction: input.instruction ?? undefined,
    error: input.error ?? undefined,
    timelineParts: input.timelineParts,
    startedAt: new Date(input.startedAt).toISOString(),
    finishedAt: input.finishedAt ? new Date(input.finishedAt).toISOString() : undefined,
  });
}

function boundedParts(parts: InterviewMessageTimelinePart[]) {
  return parts.length <= 200 ? parts : parts.slice(-200);
}

function updateTimeline(db: WorkbenchDb, runId: string, timelineParts: InterviewMessageTimelinePart[]) {
  return db.update(crawlPlanningRuns).set({ timelineParts }).where(eq(crawlPlanningRuns.id, runId));
}

function parseEvent(event: CrawlPlanningEvent) {
  return crawlPlanningEventSchema.parse(event);
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").trim().slice(0, 2_000) || "抓取规划失败";
}
