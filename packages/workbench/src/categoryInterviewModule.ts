import { randomUUID } from "node:crypto";

import {
  captureTaskDraftVersionSchema,
  categoryInterviewRuntimeOutputSchema,
  categoryInterviewViewSchema,
  interviewDecisionSchema,
  interviewSessionSchema,
  interviewTimelineEventSchema,
  normalizedInterviewMessageSchema,
  type CaptureTask,
  type CaptureTaskDraftVersion,
  type CategoryInterviewRuntimeOutput,
  type CategoryInterviewView,
  type InterviewDecision,
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
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { buildConfirmedCaptureTask } from "./captureTaskModule";
import { contentHash } from "./contentHash";

export type CategoryInterviewRuntimeEvent =
  | { type: "activity"; activity: InterviewTurnActivity }
  | { type: "text_delta"; delta: string }
  | { type: "completed"; output: CategoryInterviewRuntimeOutput }
  | { type: "interrupted" };

export interface CategoryInterviewRuntime {
  run(input: CategoryInterviewRuntimeInput): AsyncIterable<CategoryInterviewRuntimeEvent>;
}

export interface CategoryInterviewRuntimeInput {
  session: CategoryInterviewView;
  trigger: { type: "user_message"; text: string } | { type: "decision_confirmed"; decision: InterviewDecision };
  signal?: AbortSignal;
}

export interface CategoryInterviewModule {
  list(): Promise<InterviewSession[]>;
  start(input: { initialRequest: string }): Promise<CategoryInterviewView>;
  get(sessionId: string): Promise<CategoryInterviewView | null>;
  getByTaskId(taskId: string): Promise<CategoryInterviewView | null>;
  runTurn(input: InterviewTurnRequest & { sessionId: string; signal?: AbortSignal }): AsyncIterable<InterviewTimelineEvent>;
  confirmDecision(input: {
    sessionId: string;
    decisionId: string;
    selection: string;
    expectedRevision: number;
  }): Promise<CategoryInterviewView>;
  confirmTaskDraft(input: { sessionId: string; draftId: string; expectedRevision: number }): Promise<{
    interview: CategoryInterviewView;
    draft: CaptureTaskDraftVersion;
    task: CaptureTask;
  }>;
}

export class CategoryInterviewError extends Error {
  constructor(
    readonly code: "not_found" | "revision_conflict" | "invalid_state" | "runtime_failed",
    message: string,
  ) {
    super(message);
    this.name = "CategoryInterviewError";
  }
}

export function createCategoryInterviewModule(
  db: WorkbenchDb,
  runtime: CategoryInterviewRuntime,
  options: { now?: () => Date; createId?: (kind: string) => string } = {},
): CategoryInterviewModule {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((kind) => `${kind}-${randomUUID()}`);
  return {
    list: () => listSessions(db),
    start: (input) => start(db, input.initialRequest, now, createId),
    get: (sessionId) => loadView(db, sessionId),
    getByTaskId: (taskId) => loadViewByTaskId(db, taskId),
    runTurn: (input) => runTurn(db, runtime, input, now, createId),
    confirmDecision: (input) => confirmDecision(db, input, now, createId),
    confirmTaskDraft: (input) => confirmTaskDraft(db, input, now, createId),
  };
}

async function listSessions(db: WorkbenchDb) {
  const rows = await db.select().from(categoryInterviewSessions).orderBy(desc(categoryInterviewSessions.updatedAt));
  return rows.map((row) => normalizeSession(row));
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
  const initial = await requireView(db, input.sessionId);
  requireRevision(initial, input.expectedRevision);
  if (initial.session.phase === "confirmed" && input.trigger !== "user_message") {
    throw invalidState("已确认抓取任务只能由新的修改要求开启修订");
  }
  const confirmedDecision = input.trigger === "decision_confirmed"
    ? initial.decisions.find((item) => item.id === input.decisionId && item.status === "confirmed")
    : undefined;
  if (input.trigger === "decision_confirmed" && !confirmedDecision) throw invalidState("找不到已确认决定");

  const turnId = createId("interview-turn");
  await beginTurn(db, initial, input, now, createId);
  yield parseEvent({ type: "turn.started", sessionId: input.sessionId, turnId });
  const runtimeView = await requireView(db, input.sessionId);
  let partialText = "";
  try {
    for await (const event of runtime.run({
      session: runtimeView,
      trigger: input.trigger === "user_message"
        ? { type: "user_message", text: input.text }
        : { type: "decision_confirmed", decision: confirmedDecision! },
      signal: input.signal,
    })) {
      if (event.type === "activity") {
        yield parseEvent({ type: "turn.activity", sessionId: input.sessionId, turnId, activity: event.activity });
        continue;
      }
      if (event.type === "text_delta") {
        partialText += event.delta;
        yield parseEvent({ type: "assistant.delta", sessionId: input.sessionId, turnId, delta: event.delta });
        continue;
      }
      if (event.type === "interrupted") {
        await finishAbnormal(db, runtimeView, partialText, "interrupted", undefined, now, createId);
        yield parseEvent({ type: "turn.interrupted", sessionId: input.sessionId, turnId });
        return;
      }
      const completed = await finishTurn(db, runtimeView, event.output, now, createId);
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
    await finishAbnormal(db, runtimeView, partialText, "failed", message, now, createId);
    yield parseEvent({ type: "turn.failed", sessionId: input.sessionId, turnId, error: message });
  }
}

async function beginTurn(
  db: WorkbenchDb,
  view: CategoryInterviewView,
  input: InterviewTurnRequest,
  now: () => Date,
  createId: (kind: string) => string,
) {
  const timestamp = now().toISOString();
  const retry = input.trigger === "user_message" && input.retryMessageId
    ? view.messages.find((item) => item.id === input.retryMessageId && item.role === "user" && item.text === input.text)
    : undefined;
  if (input.trigger === "user_message" && input.retryMessageId && !retry) throw invalidState("重试必须引用原始用户消息");
  await db.transaction(async (transaction) => {
    const changed = await transaction.update(categoryInterviewSessions).set({
      // WHY：已确认版本保持不变；新的用户消息只重新打开采访会话，后续生成新草稿版本。
      phase: view.session.phase === "confirmed" ? "active" : view.session.phase,
      turnState: "running", revision: view.session.revision + 1, updatedAt: timestamp,
    }).where(and(eq(categoryInterviewSessions.id, view.session.id),
      eq(categoryInterviewSessions.revision, view.session.revision))).returning({ id: categoryInterviewSessions.id });
    if (changed.length !== 1) throw revisionConflict(view.session.id);
    if (input.trigger === "user_message" && !retry) {
      await transaction.insert(categoryInterviewMessages).values({
        id: createId("interview-message"), sessionId: view.session.id,
        sequence: view.messages.length + 1, role: "user", text: input.text,
        deliveryStatus: "completed", createdAt: timestamp,
      });
    }
  });
}

async function finishTurn(
  db: WorkbenchDb,
  view: CategoryInterviewView,
  rawOutput: CategoryInterviewRuntimeOutput,
  now: () => Date,
  createId: (kind: string) => string,
) {
  const output = categoryInterviewRuntimeOutputSchema.parse(rawOutput);
  const timestamp = now().toISOString();
  const current = await requireView(db, view.session.id);
  const message = normalizedInterviewMessageSchema.parse({
    id: createId("interview-message"), sessionId: view.session.id,
    sequence: current.messages.length + 1, role: "assistant", text: output.assistantText,
    deliveryStatus: "completed", createdAt: timestamp,
  });
  const rawDrafts = await db.select().from(captureTaskDraftVersions)
    .where(eq(captureTaskDraftVersions.sessionId, view.session.id));
  const nextPhase = output.taskCandidate ? "task_ready" : current.session.phase;
  const proposedDecision = proposedDecisionOf(output);

  await db.transaction(async (transaction) => {
    await transaction.insert(categoryInterviewMessages).values(message);
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
  return { message, view: await requireView(db, view.session.id) };
}

function proposedDecisionOf(output: CategoryInterviewRuntimeOutput) {
  if (output.proposedDecision) return output.proposedDecision;
  if (!output.question) return undefined;
  const recommended = output.question.options.find((option) => option.recommended);
  if (!recommended) return undefined;
  // WHY：Skill 允许单独返回 question；在 Workbench 事实边界统一成 proposal，避免文案有问题但 UI 没有可确认选项。
  return {
    key: output.question.key,
    question: output.question.text,
    options: output.question.options,
    selection: recommended.label,
    rationale: output.question.rationale,
  };
}

async function confirmDecision(
  db: WorkbenchDb,
  input: { sessionId: string; decisionId: string; selection: string; expectedRevision: number },
  now: () => Date,
  createId: (kind: string) => string,
) {
  const view = await requireView(db, input.sessionId);
  requireRevision(view, input.expectedRevision);
  const proposed = view.decisions.find((item) => item.id === input.decisionId && item.status === "proposed");
  if (!proposed) throw invalidState("待确认决定不存在或已处理");
  const selectedOption = proposed.options.find((option) => option.label === input.selection);
  if (!selectedOption) throw invalidState("确认值必须来自当前问题提供的选项");
  const timestamp = now().toISOString();
  await db.transaction(async (transaction) => {
    await transaction.update(categoryInterviewDecisions).set({ status: "superseded" })
      .where(eq(categoryInterviewDecisions.id, proposed.id));
    await transaction.insert(categoryInterviewDecisions).values({
      ...proposed, id: createId("interview-decision"), status: "confirmed",
      selection: selectedOption.label, rationale: selectedOption.description,
      supersedesDecisionId: proposed.id, createdAt: timestamp, confirmedAt: timestamp,
    });
    const changed = await transaction.update(categoryInterviewSessions).set({
      revision: view.session.revision + 1, updatedAt: timestamp,
    }).where(and(eq(categoryInterviewSessions.id, input.sessionId),
      eq(categoryInterviewSessions.revision, input.expectedRevision))).returning({ id: categoryInterviewSessions.id });
    if (changed.length !== 1) throw revisionConflict(input.sessionId);
  });
  return requireView(db, input.sessionId);
}

async function confirmTaskDraft(
  db: WorkbenchDb,
  input: { sessionId: string; draftId: string; expectedRevision: number },
  now: () => Date,
  createId: (kind: string) => string,
) {
  const view = await requireView(db, input.sessionId);
  requireRevision(view, input.expectedRevision);
  const draft = view.taskDrafts.find((item) => item.id === input.draftId && item.status === "draft");
  if (!draft) throw invalidState("待确认抓取任务草稿不存在");
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
    await transaction.update(captureTaskDraftVersions).set({
      status: "confirmed", taskId: task.id, confirmedAt: timestamp,
    }).where(eq(captureTaskDraftVersions.id, draft.id));
    const changed = await transaction.update(categoryInterviewSessions).set({
      phase: "confirmed", revision: view.session.revision + 1, updatedAt: timestamp,
    }).where(and(eq(categoryInterviewSessions.id, input.sessionId),
      eq(categoryInterviewSessions.revision, input.expectedRevision))).returning({ id: categoryInterviewSessions.id });
    if (changed.length !== 1) throw revisionConflict(input.sessionId);
  });
  const interview = await requireView(db, input.sessionId);
  const confirmedDraft = interview.taskDrafts.find((item) => item.id === draft.id)!;
  return { interview, draft: confirmedDraft, task };
}

async function finishAbnormal(
  db: WorkbenchDb,
  view: CategoryInterviewView,
  text: string,
  status: "interrupted" | "failed",
  error: string | undefined,
  now: () => Date,
  createId: (kind: string) => string,
) {
  const current = await requireView(db, view.session.id);
  const timestamp = now().toISOString();
  await db.transaction(async (transaction) => {
    if (text) await transaction.insert(categoryInterviewMessages).values({
      id: createId("interview-message"), sessionId: view.session.id,
      sequence: current.messages.length + 1, role: "assistant", text,
      deliveryStatus: status, error, createdAt: timestamp,
    });
    await transaction.update(categoryInterviewSessions).set({
      turnState: status, revision: current.session.revision + 1, updatedAt: timestamp,
    }).where(and(eq(categoryInterviewSessions.id, view.session.id),
      eq(categoryInterviewSessions.revision, current.session.revision)));
  });
}

async function loadView(db: WorkbenchDb, sessionId: string): Promise<CategoryInterviewView | null> {
  const session = await db.query.categoryInterviewSessions.findFirst({ where: eq(categoryInterviewSessions.id, sessionId) });
  if (!session) return null;
  const [messages, decisions, unresolvedItems, rawDrafts] = await Promise.all([
    db.select().from(categoryInterviewMessages).where(eq(categoryInterviewMessages.sessionId, sessionId))
      .orderBy(asc(categoryInterviewMessages.sequence)),
    db.select().from(categoryInterviewDecisions).where(eq(categoryInterviewDecisions.sessionId, sessionId))
      .orderBy(asc(categoryInterviewDecisions.createdAt)),
    db.select().from(categoryInterviewUnresolvedItems).where(eq(categoryInterviewUnresolvedItems.sessionId, sessionId))
      .orderBy(asc(categoryInterviewUnresolvedItems.createdAt)),
    db.select().from(captureTaskDraftVersions).where(eq(captureTaskDraftVersions.sessionId, sessionId))
      .orderBy(asc(captureTaskDraftVersions.version)),
  ]);
  const taskDrafts = rawDrafts.flatMap((row) => {
    const parsed = captureTaskDraftVersionSchema.safeParse(omitNulls(normalizeTimestamps(row)));
    return parsed.success ? [parsed.data] : [];
  });
  return categoryInterviewViewSchema.parse({
    session: normalizeSession(session, taskDrafts),
    messages: messages.map((item) => normalizedInterviewMessageSchema.parse(omitNulls(normalizeTimestamps(item)))),
    decisions: decisions.map(normalizeDecision),
    unresolvedItems: unresolvedItems.map((item) => omitNulls(normalizeTimestamps(item))),
    taskDrafts,
  });
}

async function loadViewByTaskId(db: WorkbenchDb, taskId: string) {
  const draft = await db.query.captureTaskDraftVersions.findFirst({
    where: eq(captureTaskDraftVersions.taskId, taskId),
    orderBy: [desc(captureTaskDraftVersions.version)],
  });
  return draft ? loadView(db, draft.sessionId) : null;
}

async function requireView(db: WorkbenchDb, sessionId: string) {
  const view = await loadView(db, sessionId);
  if (!view) throw new CategoryInterviewError("not_found", `抓取任务对话不存在：${sessionId}`);
  return view;
}

function normalizeSession(row: typeof categoryInterviewSessions.$inferSelect, drafts: CaptureTaskDraftVersion[] = []) {
  const rawPhase = row.phase as string;
  const phase = rawPhase === "confirmed" ? "confirmed" : drafts.some((item) => item.status === "draft") ? "task_ready" : "active";
  return interviewSessionSchema.parse({ ...normalizeTimestamps(row), phase });
}

function normalizeDecision(row: typeof categoryInterviewDecisions.$inferSelect) {
  const options = row.options && row.options.length >= 2 ? row.options : [
    { label: row.selection, description: row.rationale, recommended: true },
    { label: "重新讨论", description: "历史决定未保存完整选项，需要时重新讨论。", recommended: false },
  ];
  return interviewDecisionSchema.parse(omitNulls(normalizeTimestamps({ ...row, options })));
}

function normalizeTimestamps<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const result: Record<string, unknown> = { ...value };
  for (const key of ["createdAt", "updatedAt", "confirmedAt", "resolvedAt"] as const) {
    const item = result[key];
    if (typeof item === "string") result[key] = new Date(item).toISOString();
  }
  return result;
}

function omitNulls<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null));
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
