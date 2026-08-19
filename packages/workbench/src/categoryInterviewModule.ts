import { randomUUID } from "node:crypto";

import {
  appendInterviewTimelineActivity,
  appendInterviewTimelineText,
  categoryInterviewRuntimeOutputSchema,
  categoryInterviewViewSchema,
  completeInterviewTimeline,
  failInterviewTimeline,
  interviewSessionSchema,
  interviewTimelineEventSchema,
  normalizedInterviewMessageSchema,
  type CaptureTask,
  type CaptureTaskDraftVersion,
  type CategoryInterviewRuntimeOutput,
  type CategoryInterviewView,
  type InterviewMessageTimelinePart,
  type NormalizedInterviewMessage,
  type InterviewSession,
  type InterviewTimelineEvent,
  type InterviewTurnActivity,
  type InterviewTurnRequest,
} from "@domain-analysis/shared";
import type { WorkbenchDb } from "@domain-analysis/db";
import {
  captureTaskDraftVersions,
  captureTasks,
  categoryInterviewDecisions,
  categoryInterviewMessages,
  categoryInterviewSessions,
  categoryInterviewUnresolvedItems,
} from "@domain-analysis/db";
import { and, eq, inArray } from "drizzle-orm";

import { buildConfirmedCaptureTask } from "./captureTaskModule";
import {
  CategoryInterviewError,
  listStandaloneInterviewSessions,
  removeStandaloneInterviewSession,
} from "./categoryInterviewRecords";
import {
  loadCategoryInterviewView,
  loadCategoryInterviewViewByTaskId,
  requireCategoryInterviewView,
} from "./categoryInterviewViewStore";
import { contentHash } from "./contentHash";
import { prepareInterviewTurn } from "./categoryInterviewTurnPolicy";

export { CategoryInterviewError } from "./categoryInterviewRecords";

export type CategoryInterviewRuntimeEvent =
  | { type: "activity"; activity: InterviewTurnActivity }
  | { type: "text_delta"; delta: string }
  | { type: "completed"; output: CategoryInterviewRuntimeOutput }
  | { type: "interrupted" };

export interface CategoryInterviewRuntime {
  run(input: CategoryInterviewRuntimeInput): AsyncIterable<CategoryInterviewRuntimeEvent>;
  close?(): Promise<void>;
}

export interface CategoryInterviewRuntimeInput {
  session: CategoryInterviewView;
  trigger: { type: "user_message"; text: string };
  signal?: AbortSignal;
}

export interface CategoryInterviewModule {
  list(): Promise<InterviewSession[]>;
  start(input: { initialRequest: string }): Promise<CategoryInterviewView>;
  get(sessionId: string): Promise<CategoryInterviewView | null>;
  getByTaskId(taskId: string): Promise<CategoryInterviewView | null>;
  remove(sessionId: string): Promise<void>;
  runTurn(input: InterviewTurnRequest & { sessionId: string; signal?: AbortSignal }): AsyncIterable<InterviewTimelineEvent>;
  confirmTaskDraft(input: { sessionId: string; draftId: string; expectedRevision: number }): Promise<{
    interview: CategoryInterviewView;
    draft: CaptureTaskDraftVersion;
    task: CaptureTask;
  }>;
}

export function createCategoryInterviewModule(
  db: WorkbenchDb,
  runtime: CategoryInterviewRuntime,
  options: { now?: () => Date; createId?: (kind: string) => string } = {},
): CategoryInterviewModule {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((kind) => `${kind}-${randomUUID()}`);
  return {
    list: async () => {
      const sessions = await listStandaloneInterviewSessions(db);
      const views = await Promise.all(sessions.map((session) => loadCategoryInterviewView(db, session.id)));
      return views.flatMap((view) => view ? [view.session] : []);
    },
    start: (input) => start(db, input.initialRequest, now, createId),
    get: (sessionId) => loadCategoryInterviewView(db, sessionId),
    getByTaskId: (taskId) => loadCategoryInterviewViewByTaskId(db, taskId),
    remove: (sessionId) => removeStandaloneInterviewSession(db, sessionId),
    runTurn: (input) => runTurn(db, runtime, input, now, createId),
    confirmTaskDraft: (input) => confirmTaskDraft(db, input, now, createId),
  };
}

async function start(
  db: WorkbenchDb,
  initialRequest: string,
  now: () => Date,
  createId: (kind: string) => string,
) {
  const timestamp = now().toISOString();
  const session = interviewSessionSchema.parse({
    id: createId("interview-session"), initialRequest, phase: "active", turnState: "idle",
    revision: 1, createdAt: timestamp, updatedAt: timestamp,
  });
  await db.insert(categoryInterviewSessions).values(session);
  return categoryInterviewViewSchema.parse({
    session, messages: [], decisions: [], unresolvedItems: [], taskDrafts: [],
  });
}

async function* runTurn(
  db: WorkbenchDb,
  runtime: CategoryInterviewRuntime,
  input: InterviewTurnRequest & { sessionId: string; signal?: AbortSignal },
  now: () => Date,
  createId: (kind: string) => string,
): AsyncIterable<InterviewTimelineEvent> {
  const initial = await requireCategoryInterviewView(db, input.sessionId);
  requireRevision(initial, input.expectedRevision);
  if (initial.session.turnState === "running") throw invalidState("已有采访回合正在运行");
  const retryMessage = requireRetryMessage(initial, input);

  const turnId = createId("interview-turn");
  const sourceUserMessageId = await beginTurn(db, initial, input, retryMessage, now, createId);
  const runtimeView = await requireCategoryInterviewView(db, input.sessionId);
  let partialText = "";
  let timelineParts: InterviewMessageTimelinePart[] = [];
  try {
    yield parseEvent({ type: "turn.started", sessionId: input.sessionId, turnId });
    for await (const event of runtime.run({
      session: runtimeView,
      trigger: { type: "user_message", text: input.text },
      signal: input.signal,
    })) {
      if (event.type === "activity") {
        timelineParts = appendInterviewTimelineActivity(timelineParts, event.activity);
        yield parseEvent({ type: "turn.activity", sessionId: input.sessionId, turnId, activity: event.activity });
        continue;
      }
      if (event.type === "text_delta") {
        partialText += event.delta;
        timelineParts = appendInterviewTimelineText(timelineParts, event.delta);
        yield parseEvent({ type: "assistant.delta", sessionId: input.sessionId, turnId, delta: event.delta });
        continue;
      }
      if (event.type === "interrupted") {
        await finishAbnormal(db, runtimeView, partialText, "interrupted", undefined,
          failInterviewTimeline(timelineParts), now, createId);
        yield parseEvent({ type: "turn.interrupted", sessionId: input.sessionId, turnId });
        return;
      }
      const completed = await finishTurn(db, runtimeView, sourceUserMessageId, event.output,
        completeInterviewTimeline(timelineParts, event.output.assistantText),
        now, createId);
      yield parseEvent({ type: "assistant.message.completed", sessionId: input.sessionId, turnId, message: completed.message });
      yield parseEvent({ type: "interview.state.changed", sessionId: input.sessionId, turnId,
        revision: completed.view.session.revision, phase: completed.view.session.phase,
        turnState: completed.view.session.turnState });
      yield parseEvent({ type: "turn.completed", sessionId: input.sessionId, turnId });
      return;
    }
    throw new Error("采访运行时未返回完成事件");
  } catch (error) {
    const message = boundedError(error);
    await finishAbnormal(db, runtimeView, partialText, "failed", message,
      failInterviewTimeline(timelineParts), now, createId);
    yield parseEvent({ type: "turn.failed", sessionId: input.sessionId, turnId, error: message });
  }
}

async function beginTurn(
  db: WorkbenchDb,
  view: CategoryInterviewView,
  input: InterviewTurnRequest,
  retry: NormalizedInterviewMessage | undefined,
  now: () => Date,
  createId: (kind: string) => string,
) {
  const timestamp = now().toISOString();
  const sourceUserMessageId = retry?.id ?? createId("interview-message");
  await db.transaction(async (transaction) => {
    const changed = await transaction.update(categoryInterviewSessions).set({
      // WHY：任何新输入都可能修订草稿；先退出 task_ready，只有本轮明确保持或产出新草稿后才能再次确认。
      phase: "active",
      turnState: "running", revision: view.session.revision + 1, updatedAt: timestamp,
    }).where(and(eq(categoryInterviewSessions.id, view.session.id),
      eq(categoryInterviewSessions.revision, view.session.revision))).returning({ id: categoryInterviewSessions.id });
    if (changed.length !== 1) throw revisionConflict(view.session.id);
    if (!retry) {
      await transaction.insert(categoryInterviewMessages).values({
        id: sourceUserMessageId, sessionId: view.session.id,
        sequence: view.messages.length + 1, role: "user", text: input.text,
        deliveryStatus: "completed", createdAt: timestamp,
      });
    }
  });
  return sourceUserMessageId;
}

function requireRetryMessage(view: CategoryInterviewView, input: InterviewTurnRequest) {
  if (!input.retryMessageId) return undefined;
  if (view.session.turnState !== "failed" && view.session.turnState !== "interrupted") {
    throw invalidState("只有最近一次失败或中断的用户输入可以重试");
  }
  const candidate = view.messages.find((item) => item.id === input.retryMessageId
    && item.role === "user" && item.text === input.text);
  const latestUser = [...view.messages].reverse().find((item) => item.role === "user");
  const completedAfter = candidate && view.messages.some((item) => item.sequence > candidate.sequence
    && item.role === "assistant" && item.deliveryStatus === "completed");
  if (!candidate || candidate.id !== latestUser?.id || completedAfter) {
    throw invalidState("重试必须引用最近一次未成功处理的用户原文");
  }
  return candidate;
}

async function finishTurn(
  db: WorkbenchDb,
  view: CategoryInterviewView,
  sourceUserMessageId: string,
  rawOutput: CategoryInterviewRuntimeOutput,
  timelineParts: InterviewMessageTimelinePart[],
  now: () => Date,
  createId: (kind: string) => string,
) {
  const parsedOutput = categoryInterviewRuntimeOutputSchema.parse(rawOutput);
  const timestamp = now().toISOString();
  const current = await requireCategoryInterviewView(db, view.session.id);
  if (current.session.revision !== view.session.revision || current.session.turnState !== "running") {
    throw revisionConflict(view.session.id);
  }
  const { output, decisionChange, nextPhase } = prepareInterviewTurn(
    current, parsedOutput, timestamp, createId, sourceUserMessageId,
  );
  const message = normalizedInterviewMessageSchema.parse({
    id: createId("interview-message"), sessionId: view.session.id,
    sequence: current.messages.length + 1, role: "assistant", text: output.assistantText,
    deliveryStatus: "completed", timelineParts, createdAt: timestamp,
  });
  const rawDrafts = await db.select().from(captureTaskDraftVersions)
    .where(eq(captureTaskDraftVersions.sessionId, view.session.id));
  const proposedDecision = output.proposedDecision;

  await db.transaction(async (transaction) => {
    await transaction.insert(categoryInterviewMessages).values(message);
    if (decisionChange) {
      await transaction.update(categoryInterviewDecisions).set({ status: "superseded" })
        .where(and(
          eq(categoryInterviewDecisions.id, decisionChange.proposed.id),
          eq(categoryInterviewDecisions.status, "proposed"),
        ));
      if (decisionChange.confirmed) {
        await transaction.insert(categoryInterviewDecisions).values(decisionChange.confirmed);
      }
    }
    if (proposedDecision) {
      await transaction.insert(categoryInterviewDecisions).values({
        id: createId("interview-decision"), sessionId: view.session.id,
        ...proposedDecision, status: "proposed", sourceMessageId: message.id, createdAt: timestamp,
      });
    }
    for (const item of output.unresolvedItems) {
      await transaction.insert(categoryInterviewUnresolvedItems).values({
        id: createId("interview-unresolved"), sessionId: view.session.id,
        ...item, status: "open", createdAt: timestamp,
      }).onConflictDoUpdate({
        target: [categoryInterviewUnresolvedItems.sessionId, categoryInterviewUnresolvedItems.key],
        set: { description: item.description, owner: item.owner, status: "open", resolution: null, resolvedAt: null },
      });
    }
    if (output.resolvedUnresolvedKeys.length > 0) {
      await transaction.update(categoryInterviewUnresolvedItems).set({ status: "resolved", resolvedAt: timestamp })
        .where(and(eq(categoryInterviewUnresolvedItems.sessionId, view.session.id),
          inArray(categoryInterviewUnresolvedItems.key, output.resolvedUnresolvedKeys)));
    }
    if (decisionChange) {
      await transaction.update(categoryInterviewUnresolvedItems).set({
        status: "resolved",
        resolution: decisionChange.confirmed?.selection ?? decisionChange.withdrawalRationale,
        resolvedAt: timestamp,
      }).where(and(
        eq(categoryInterviewUnresolvedItems.sessionId, view.session.id),
        eq(categoryInterviewUnresolvedItems.key, decisionChange.proposed.key),
      ));
    }
    if (output.taskCandidate) {
      await transaction.update(captureTaskDraftVersions).set({ status: "superseded" })
        .where(and(eq(captureTaskDraftVersions.sessionId, view.session.id),
          eq(captureTaskDraftVersions.status, "draft")));
      await transaction.insert(captureTaskDraftVersions).values({
        id: createId("capture-task-draft"), sessionId: view.session.id,
        version: Math.max(0, ...rawDrafts.map((item) => item.version)) + 1,
        status: "draft", contentHash: contentHash(output.taskCandidate), content: output.taskCandidate,
        createdAt: timestamp,
      });
    }
    const changed = await transaction.update(categoryInterviewSessions).set({
      phase: nextPhase, turnState: "idle", revision: current.session.revision + 1, updatedAt: timestamp,
    }).where(and(eq(categoryInterviewSessions.id, view.session.id),
      eq(categoryInterviewSessions.revision, current.session.revision))).returning({ id: categoryInterviewSessions.id });
    if (changed.length !== 1) throw revisionConflict(view.session.id);
  });
  return { message, view: await requireCategoryInterviewView(db, view.session.id) };
}

async function confirmTaskDraft(
  db: WorkbenchDb,
  input: { sessionId: string; draftId: string; expectedRevision: number },
  now: () => Date,
  createId: (kind: string) => string,
) {
  const view = await requireCategoryInterviewView(db, input.sessionId);
  requireRevision(view, input.expectedRevision);
  if (view.session.phase !== "task_ready" || view.session.turnState !== "idle") {
    throw invalidState("只有当前待确认草稿可以生成抓取任务");
  }
  const draft = view.taskDrafts
    .filter((item) => item.status === "draft")
    .sort((left, right) => right.version - left.version)[0];
  if (!draft || draft.id !== input.draftId) throw invalidState("只有最新待确认草稿可以生成抓取任务");
  const confirmedIds = new Set(view.decisions.filter((item) => item.status === "confirmed").map((item) => item.id));
  if (draft.content.decisionIds.some((id) => !confirmedIds.has(id))) throw invalidState("抓取任务引用了尚未确认的负责人取舍");
  const timestamp = now().toISOString();
  const previousDraft = [...view.taskDrafts].reverse().find((item) => item.status === "confirmed" && item.taskId);
  const previousTask = previousDraft?.taskId
    ? await db.query.captureTasks.findFirst({ where: eq(captureTasks.id, previousDraft.taskId) })
    : undefined;
  const task = buildConfirmedCaptureTask(
    draft.content,
    timestamp,
    previousTask?.id ?? createId("capture-task"),
    draft.version,
    previousTask ? new Date(previousTask.createdAt).toISOString() : timestamp,
  );
  await db.transaction(async (transaction) => {
    if (previousTask) {
      const changedTask = await transaction.update(captureTasks).set({
        name: task.name,
        originalRequest: task.content.originalRequest,
        marketScope: task.content.marketScope,
        status: task.status,
        revision: task.revision,
        content: task.content,
        updatedAt: task.updatedAt,
        confirmedAt: task.confirmedAt,
      }).where(eq(captureTasks.id, previousTask.id)).returning({ id: captureTasks.id });
      if (changedTask.length !== 1) throw invalidState("原抓取任务不存在，无法生成修订版");
    } else {
      await transaction.insert(captureTasks).values({
        ...task,
        originalRequest: task.content.originalRequest,
        marketScope: task.content.marketScope,
      });
    }
    const changedDraft = await transaction.update(captureTaskDraftVersions).set({
      status: "confirmed", taskId: task.id, confirmedAt: timestamp,
    }).where(and(eq(captureTaskDraftVersions.id, draft.id),
      eq(captureTaskDraftVersions.status, "draft"))).returning({ id: captureTaskDraftVersions.id });
    if (changedDraft.length !== 1) throw invalidState("待确认抓取任务草稿已更新");
    const changed = await transaction.update(categoryInterviewSessions).set({
      phase: "confirmed", revision: view.session.revision + 1, updatedAt: timestamp,
    }).where(and(eq(categoryInterviewSessions.id, input.sessionId),
      eq(categoryInterviewSessions.revision, input.expectedRevision))).returning({ id: categoryInterviewSessions.id });
    if (changed.length !== 1) throw revisionConflict(input.sessionId);
  });
  const interview = await requireCategoryInterviewView(db, input.sessionId);
  const confirmedDraft = interview.taskDrafts.find((item) => item.id === draft.id)!;
  return { interview, draft: confirmedDraft, task };
}

async function finishAbnormal(
  db: WorkbenchDb,
  view: CategoryInterviewView,
  text: string,
  status: "interrupted" | "failed",
  error: string | undefined,
  timelineParts: InterviewMessageTimelinePart[],
  now: () => Date,
  createId: (kind: string) => string,
) {
  const current = await requireCategoryInterviewView(db, view.session.id);
  // WHY：异常收尾也必须持有本轮 revision lease；旧回合不能把后来恢复或修订出的新状态覆盖成 failed。
  if (current.session.revision !== view.session.revision || current.session.turnState !== "running") return;
  const timestamp = now().toISOString();
  await db.transaction(async (transaction) => {
    if (text) await transaction.insert(categoryInterviewMessages).values({
      id: createId("interview-message"), sessionId: view.session.id,
      sequence: current.messages.length + 1, role: "assistant", text,
      deliveryStatus: status, error, timelineParts, createdAt: timestamp,
    });
    const changed = await transaction.update(categoryInterviewSessions).set({
      turnState: status, revision: current.session.revision + 1, updatedAt: timestamp,
    }).where(and(eq(categoryInterviewSessions.id, view.session.id),
      eq(categoryInterviewSessions.revision, view.session.revision),
      eq(categoryInterviewSessions.turnState, "running"))).returning({ id: categoryInterviewSessions.id });
    if (changed.length !== 1) throw revisionConflict(view.session.id);
  });
}

function requireRevision(view: CategoryInterviewView, expected: number) {
  if (view.session.revision !== expected) throw revisionConflict(view.session.id);
}

function revisionConflict(sessionId: string) {
  return new CategoryInterviewError("revision_conflict", `抓取任务对话已更新，请刷新后重试：${sessionId}`);
}

function invalidState(message: string) {
  return new CategoryInterviewError("invalid_state", message);
}

function boundedError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000) || "抓取任务对话运行失败";
}

function parseEvent(event: unknown) {
  return interviewTimelineEventSchema.parse(event);
}
