import { randomUUID } from "node:crypto";

import type { WorkbenchDb } from "@domain-analysis/db";
import { crawlPlanningRuns, sourceCollectionPlans } from "@domain-analysis/db";
import {
  appendInterviewTimelineActivity,
  appendInterviewTimelineText,
  confirmCrawlPlanSchema,
  crawlPlanContentSchema,
  crawlPlanSchema,
  crawlPlanningEventSchema,
  crawlPlanningRunRequestSchema,
  crawlPlanningRunSchema,
  crawlPlanningRuntimeOutputSchema,
  crawlPlanningViewSchema,
  completeInterviewTimeline,
  failInterviewTimeline,
  type CaptureTask,
  type CrawlPlan,
  type CrawlPlanningEvent,
  type CrawlPlanningRuntimeOutput,
  type CrawlPlanningView,
  type InterviewMessageTimelinePart,
  type InterviewTurnActivity,
} from "@domain-analysis/shared";
import { and, desc, eq, isNotNull } from "drizzle-orm";

import type { CaptureTaskModule } from "./captureTaskModule";
import { contentHash } from "./contentHash";

export type CrawlPlanningRuntimeEvent =
  | { type: "activity"; activity: InterviewTurnActivity }
  | { type: "text_delta"; delta: string }
  | { type: "completed"; output: CrawlPlanningRuntimeOutput }
  | { type: "interrupted" };

export interface CrawlPlanningRuntime {
  run(input: {
    task: CaptureTask;
    instruction?: string;
    previousPlans: CrawlPlan[];
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
    readonly code: "not_found" | "revision_conflict" | "invalid_state" | "runtime_failed",
    message: string,
  ) {
    super(message);
    this.name = "CrawlPlanningError";
  }
}

export function createCrawlPlanningModule(
  db: WorkbenchDb,
  captureTasks: CaptureTaskModule,
  runtime: CrawlPlanningRuntime,
  options: { now?: () => Date; createId?: (kind: string) => string; validateSource?: (source: CrawlPlan["content"]["sources"][number]) => void | Promise<void> } = {},
): CrawlPlanningModule {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((kind) => `${kind}-${randomUUID()}`);
  return {
    get: async (taskId) => {
      const task = await captureTasks.get(taskId);
      return task ? loadView(db, task) : null;
    },
    run: (input) => runPlanning(db, captureTasks, runtime, input, now, createId),
    confirm: (input) => confirmPlan(db, captureTasks, input, now, options.validateSource),
  };
}

async function* runPlanning(
  db: WorkbenchDb,
  captureTasks: CaptureTaskModule,
  runtime: CrawlPlanningRuntime,
  input: { taskId: string; expectedTaskRevision: number; instruction?: string; signal?: AbortSignal },
  now: () => Date,
  createId: (kind: string) => string,
): AsyncIterable<CrawlPlanningEvent> {
  const request = crawlPlanningRunRequestSchema.parse({
    expectedTaskRevision: input.expectedTaskRevision,
    ...(input.instruction ? { instruction: input.instruction } : {}),
  });
  const task = await requireTask(captureTasks, input.taskId);
  requireCurrentTask(task, request.expectedTaskRevision);
  const runId = createId("crawl-planning-run");
  const startedAt = now().toISOString();
  await db.insert(crawlPlanningRuns).values({
    id: runId, taskId: task.id, taskRevision: task.revision, instruction: request.instruction,
    status: "running", timelineParts: [], startedAt,
  });
  yield parseEvent({ type: "run.started", taskId: task.id, runId });

  let partialText = "";
  let timelineParts: InterviewMessageTimelinePart[] = [];
  try {
    const previousPlans = (await loadView(db, task)).plans;
    for await (const event of runtime.run({
      task, instruction: request.instruction, previousPlans, signal: input.signal,
    })) {
      if (event.type === "activity") {
        timelineParts = appendInterviewTimelineActivity(timelineParts, event.activity);
        yield parseEvent({ type: "run.activity", taskId: task.id, runId, activity: event.activity });
        continue;
      }
      if (event.type === "text_delta") {
        partialText += event.delta;
        timelineParts = appendInterviewTimelineText(timelineParts, event.delta);
        yield parseEvent({ type: "assistant.delta", taskId: task.id, runId, delta: event.delta });
        continue;
      }
      if (event.type === "interrupted") {
        const run = await finishAbnormal(db, runId, "interrupted", undefined,
          failInterviewTimeline(timelineParts), now);
        yield parseEvent({ type: "run.interrupted", taskId: task.id, runId, run });
        return;
      }
      const completed = await finishCompleted(db, task, runId, event.output,
        completeInterviewTimeline(timelineParts, event.output.assistantText), now, createId);
      yield parseEvent({ type: "run.completed", taskId: task.id, runId, ...completed });
      return;
    }
    throw new Error("抓取规划运行时未返回完成事件");
  } catch (error) {
    const message = boundedError(error);
    const parts = partialText ? failInterviewTimeline(timelineParts) : timelineParts;
    const run = await finishAbnormal(db, runId,
      input.signal?.aborted ? "interrupted" : "failed",
      input.signal?.aborted ? undefined : message, parts, now);
    if (run.status === "interrupted") {
      yield parseEvent({ type: "run.interrupted", taskId: task.id, runId, run });
    } else {
      yield parseEvent({ type: "run.failed", taskId: task.id, runId, run, error: message });
    }
  }
}

async function finishCompleted(
  db: WorkbenchDb,
  task: CaptureTask,
  runId: string,
  rawOutput: CrawlPlanningRuntimeOutput,
  timelineParts: InterviewMessageTimelinePart[],
  now: () => Date,
  createId: (kind: string) => string,
) {
  const output = crawlPlanningRuntimeOutputSchema.parse(rawOutput);
  requireTopicCoverage(task, output);
  const timestamp = now().toISOString();
  const content = crawlPlanContentSchema.parse({
    ...output.planCandidate,
    // WHY：当前运行只证明 App Server 搜索发生过；模型不能自行提升观察等级、可访问性或伪造观察时间。
    sources: output.planCandidate.sources.map((source) => ({
      ...source, observationLevel: "search_discovered", accessState: "unknown", observedAt: timestamp,
    })),
    taskId: task.id,
    taskRevision: task.revision,
  });
  const planId = createId("crawl-plan");
  await db.transaction(async (transaction) => {
    const rows = await transaction.select({ version: sourceCollectionPlans.version })
      .from(sourceCollectionPlans)
      .where(and(eq(sourceCollectionPlans.taskId, task.id), isNotNull(sourceCollectionPlans.planningRunId)));
    const version = Math.max(0, ...rows.map((row) => row.version)) + 1;
    await transaction.update(sourceCollectionPlans).set({ status: "superseded" })
      .where(and(eq(sourceCollectionPlans.taskId, task.id), eq(sourceCollectionPlans.status, "draft"),
        isNotNull(sourceCollectionPlans.planningRunId)));
    await transaction.insert(sourceCollectionPlans).values({
      id: planId, taskId: task.id, taskRevision: task.revision, planningRunId: runId,
      version, status: "draft", contentHash: contentHash(content), content, createdAt: timestamp,
    });
    await transaction.update(crawlPlanningRuns).set({
      status: "completed", timelineParts, finishedAt: timestamp,
    }).where(eq(crawlPlanningRuns.id, runId));
  });
  const view = await loadView(db, task);
  const run = view.runs.find((item) => item.id === runId);
  const plan = view.plans.find((item) => item.id === planId);
  if (!run || !plan) throw new Error("抓取计划完成后无法读取持久化结果");
  return { run, plan };
}

async function finishAbnormal(
  db: WorkbenchDb,
  runId: string,
  status: "interrupted" | "failed",
  error: string | undefined,
  timelineParts: InterviewMessageTimelinePart[],
  now: () => Date,
) {
  await db.update(crawlPlanningRuns).set({
    status, timelineParts, error, finishedAt: now().toISOString(),
  }).where(eq(crawlPlanningRuns.id, runId));
  const row = await db.query.crawlPlanningRuns.findFirst({ where: eq(crawlPlanningRuns.id, runId) });
  if (!row) throw new Error("抓取规划运行记录不存在");
  return normalizeRun(row);
}

async function confirmPlan(
  db: WorkbenchDb,
  captureTasks: CaptureTaskModule,
  input: { taskId: string; planId: string; expectedTaskRevision: number },
  now: () => Date,
  validateSource?: (source: CrawlPlan["content"]["sources"][number]) => void | Promise<void>,
) {
  const confirmation = confirmCrawlPlanSchema.parse({ expectedTaskRevision: input.expectedTaskRevision });
  const task = await requireTask(captureTasks, input.taskId);
  requireCurrentTask(task, confirmation.expectedTaskRevision);
  const plan = await db.query.sourceCollectionPlans.findFirst({
    where: and(eq(sourceCollectionPlans.id, input.planId), eq(sourceCollectionPlans.taskId, task.id),
      isNotNull(sourceCollectionPlans.planningRunId)),
  });
  if (!plan) throw new CrawlPlanningError("not_found", `抓取计划不存在：${input.planId}`);
  if (plan.taskRevision !== task.revision) throw revisionConflict(task.id);
  if (plan.status !== "draft") throw new CrawlPlanningError("invalid_state", "只有当前草稿计划可以确认");
  const parsed = crawlPlanContentSchema.parse(plan.content);
  for (const source of parsed.sources) {
    if (source.executionBlockers.length > 0) throw new CrawlPlanningError("invalid_state", `计划仍有执行阻塞：${source.executionBlockers.join("；")}`);
    try {
      await validateSource?.(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CrawlPlanningError("invalid_state", `来源执行预检失败：${message.slice(0, 1_500)}`);
    }
  }
  const timestamp = now().toISOString();
  await db.transaction(async (transaction) => {
    await transaction.update(sourceCollectionPlans).set({ status: "superseded" })
      .where(and(eq(sourceCollectionPlans.taskId, task.id), eq(sourceCollectionPlans.status, "confirmed"),
        isNotNull(sourceCollectionPlans.planningRunId)));
    const changed = await transaction.update(sourceCollectionPlans).set({
      status: "confirmed", confirmedAt: timestamp,
    }).where(and(eq(sourceCollectionPlans.id, plan.id), eq(sourceCollectionPlans.status, "draft")))
      .returning({ id: sourceCollectionPlans.id });
    if (changed.length !== 1) throw new CrawlPlanningError("invalid_state", "抓取计划状态已改变，请刷新后重试");
  });
  return loadView(db, task);
}

async function loadView(db: WorkbenchDb, task: CaptureTask): Promise<CrawlPlanningView> {
  const [runRows, planRows] = await Promise.all([
    db.select().from(crawlPlanningRuns).where(eq(crawlPlanningRuns.taskId, task.id))
      .orderBy(desc(crawlPlanningRuns.startedAt)),
    db.select().from(sourceCollectionPlans)
      .where(and(eq(sourceCollectionPlans.taskId, task.id), isNotNull(sourceCollectionPlans.planningRunId)))
      .orderBy(desc(sourceCollectionPlans.version)),
  ]);
  const plans = planRows.map(normalizePlan);
  const planIds = new Map(plans.map((plan) => [plan.planningRunId, plan.id]));
  return crawlPlanningViewSchema.parse({
    taskId: task.id, taskRevision: task.revision,
    runs: runRows.map((row) => normalizeRun(row, planIds.get(row.id))), plans,
  });
}

function normalizePlan(row: typeof sourceCollectionPlans.$inferSelect): CrawlPlan {
  if (!row.planningRunId) throw new Error("新抓取计划缺少 planning run");
  return crawlPlanSchema.parse({
    id: row.id, taskId: row.taskId, taskRevision: row.taskRevision,
    planningRunId: row.planningRunId, version: row.version, status: row.status,
    contentHash: row.contentHash, content: row.content,
    createdAt: new Date(row.createdAt).toISOString(),
    ...(row.confirmedAt ? { confirmedAt: new Date(row.confirmedAt).toISOString() } : {}),
  });
}

function normalizeRun(row: typeof crawlPlanningRuns.$inferSelect, planId?: string) {
  return crawlPlanningRunSchema.parse({
    id: row.id, taskId: row.taskId, taskRevision: row.taskRevision, status: row.status,
    timelineParts: row.timelineParts ?? [],
    ...(row.instruction ? { instruction: row.instruction } : {}),
    ...(planId ? { planId } : {}),
    ...(row.error ? { error: row.error } : {}),
    startedAt: new Date(row.startedAt).toISOString(),
    ...(row.finishedAt ? { finishedAt: new Date(row.finishedAt).toISOString() } : {}),
  });
}

function requireTopicCoverage(task: CaptureTask, output: CrawlPlanningRuntimeOutput) {
  const requiredTopics = new Set([...task.content.generalTopics, ...task.content.categoryTopics]);
  const coveredTopics = new Set<string>();
  for (const source of output.planCandidate.sources) {
    for (const target of source.targets) {
      for (const topic of target.taskTopics) {
        if (!requiredTopics.has(topic)) {
          throw new CrawlPlanningError("invalid_state", `抓取目标引用了任务中不存在的内容方向：${topic}`);
        }
        coveredTopics.add(topic);
      }
    }
  }
  const missing = [...requiredTopics].filter((topic) => !coveredTopics.has(topic));
  if (missing.length > 0) {
    throw new CrawlPlanningError("invalid_state", `抓取计划没有覆盖任务内容方向：${missing.join("、")}`);
  }
}

async function requireTask(captureTasks: CaptureTaskModule, taskId: string) {
  const task = await captureTasks.get(taskId);
  if (!task) throw new CrawlPlanningError("not_found", `抓取任务不存在：${taskId}`);
  return task;
}

function requireCurrentTask(task: CaptureTask, expectedRevision: number) {
  if (task.revision !== expectedRevision) throw revisionConflict(task.id);
  if (task.status !== "ready") throw new CrawlPlanningError("invalid_state", "抓取任务尚未确认，不能制定计划");
}

function revisionConflict(taskId: string) {
  return new CrawlPlanningError("revision_conflict", `抓取任务已更新，请刷新后重试：${taskId}`);
}

function parseEvent(event: CrawlPlanningEvent) {
  return crawlPlanningEventSchema.parse(event);
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000) || "抓取规划失败";
}
