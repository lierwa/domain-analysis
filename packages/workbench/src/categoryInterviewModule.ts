import { randomUUID } from "node:crypto";

import {
  categoryInterviewRuntimeOutputSchema,
  categoryInterviewViewSchema,
  categoryResearchBriefVersionSchema,
  interviewDecisionSchema,
  interviewSessionSchema,
  interviewTimelineEventSchema,
  interviewUnresolvedItemSchema,
  normalizedInterviewMessageSchema,
  type CategoryInterviewRuntimeOutput,
  type CategoryInterviewView,
  type CategoryResearchBriefVersion,
  type InterviewDecision,
  type InterviewTimelineEvent,
  type InterviewTurnRequest,
  type InterviewSession,
  type ProductProjectView,
} from "@domain-analysis/shared";
import type { ProductKnowledgeDb } from "@domain-analysis/db";
import {
  categoryInterviewDecisions,
  categoryInterviewMessages,
  categoryInterviewSessions,
  categoryInterviewUnresolvedItems,
  categoryResearchBriefVersions,
} from "@domain-analysis/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { contentHash } from "./contentHash";
import { projectDraftFromBrief } from "./categoryProjectDraft";
import type { ProductProjectModule } from "./productProjectModule";

export type CategoryInterviewRuntimeEvent =
  | { type: "text_delta"; delta: string }
  | { type: "completed"; output: CategoryInterviewRuntimeOutput }
  | { type: "interrupted" };

export interface CategoryInterviewRuntime {
  run(input: CategoryInterviewRuntimeInput): AsyncIterable<CategoryInterviewRuntimeEvent>;
}

export interface CategoryInterviewRuntimeInput {
  session: CategoryInterviewView;
  trigger:
    | { type: "user_message"; text: string }
    | { type: "decision_confirmed"; decision: InterviewDecision };
  signal?: AbortSignal;
}

export interface CategoryInterviewModule {
  list(): Promise<InterviewSession[]>;
  start(input: { categoryHint: string }): Promise<CategoryInterviewView>;
  get(sessionId: string): Promise<CategoryInterviewView | null>;
  getConfirmedBriefForProject(projectId: string): Promise<CategoryResearchBriefVersion | null>;
  runTurn(input: RunInterviewTurnInput): AsyncIterable<InterviewTimelineEvent>;
  confirmDecision(input: ConfirmInterviewDecisionInput): Promise<CategoryInterviewView>;
  confirmBrief(input: ConfirmCategoryBriefInput): Promise<ConfirmedCategoryBriefResult>;
}

export type RunInterviewTurnInput = InterviewTurnRequest & {
  sessionId: string;
  signal?: AbortSignal;
};

export interface ConfirmInterviewDecisionInput {
  sessionId: string;
  decisionId: string;
  expectedRevision: number;
}

export interface ConfirmCategoryBriefInput {
  sessionId: string;
  briefId: string;
  expectedRevision: number;
}

export interface ConfirmedCategoryBriefResult {
  interview: CategoryInterviewView;
  brief: CategoryResearchBriefVersion;
  project: ProductProjectView;
}

export interface CategoryInterviewModuleOptions {
  now?: () => Date;
  createId?: (kind: string) => string;
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
  db: ProductKnowledgeDb,
  productProjects: ProductProjectModule,
  runtime: CategoryInterviewRuntime,
  options: CategoryInterviewModuleOptions = {},
): CategoryInterviewModule {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((kind) => `${kind}-${randomUUID()}`);
  return {
    list: () => listSessions(db),
    start: (input) => start(db, input.categoryHint, now, createId),
    get: (sessionId) => loadView(db, sessionId),
    getConfirmedBriefForProject: (projectId) => getConfirmedBriefForProject(db, projectId),
    runTurn: (input) => runTurn(db, runtime, input, now, createId),
    confirmDecision: (input) => confirmDecision(db, input, now, createId),
    confirmBrief: (input) => confirmBrief(db, productProjects, input, now, createId),
  };
}

async function getConfirmedBriefForProject(db: ProductKnowledgeDb, projectId: string) {
  const row = await db.query.categoryResearchBriefVersions.findFirst({
    where: and(
      eq(categoryResearchBriefVersions.projectId, projectId),
      eq(categoryResearchBriefVersions.status, "confirmed"),
    ),
    orderBy: [desc(categoryResearchBriefVersions.version)],
  });
  return row
    ? categoryResearchBriefVersionSchema.parse(omitNulls(normalizeTimestamps(row)))
    : null;
}

async function listSessions(db: ProductKnowledgeDb) {
  const sessions = await db.select().from(categoryInterviewSessions)
    .orderBy(desc(categoryInterviewSessions.updatedAt));
  return sessions.map((session) => {
    return interviewSessionSchema.parse(normalizeTimestamps(session));
  });
}

async function start(
  db: ProductKnowledgeDb,
  categoryHint: string,
  now: () => Date,
  createId: (kind: string) => string,
) {
  const timestamp = now().toISOString();
  const session = interviewSessionSchema.parse({
    id: createId("interview-session"), categoryHint, phase: "active", turnState: "idle",
    revision: 1, createdAt: timestamp, updatedAt: timestamp,
  });
  await db.insert(categoryInterviewSessions).values(session);
  return categoryInterviewViewSchema.parse({
    session, messages: [], decisions: [], unresolvedItems: [], briefs: [],
  });
}

async function* runTurn(
  db: ProductKnowledgeDb,
  runtime: CategoryInterviewRuntime,
  input: RunInterviewTurnInput,
  now: () => Date,
  createId: (kind: string) => string,
): AsyncIterable<InterviewTimelineEvent> {
  const initial = await requireView(db, input.sessionId);
  requireRevision(initial, input.expectedRevision);
  if (initial.session.phase === "confirmed") throw invalidState("已确认采访不能继续追加消息");
  if (input.trigger === "user_message" && input.retryMessageId
    && !["interrupted", "failed"].includes(initial.session.turnState)) {
    throw invalidState("只有中断或失败的采访 turn 可以重试");
  }
  const confirmedDecision = input.trigger === "decision_confirmed"
    ? initial.decisions.find((decision) => decision.id === input.decisionId && decision.status === "confirmed")
    : undefined;
  if (input.trigger === "decision_confirmed" && !confirmedDecision) {
    throw invalidState("确认后继续必须引用当前会话中的已确认决定");
  }
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
      if (event.type === "text_delta") {
        partialText += event.delta;
        yield parseEvent({ type: "assistant.delta", sessionId: input.sessionId, turnId, delta: event.delta });
        continue;
      }
      if (event.type === "interrupted") {
        await finishAbnormalTurn(db, input.sessionId, runtimeView.session.revision, partialText, "interrupted", undefined, now, createId);
        yield parseEvent({ type: "turn.interrupted", sessionId: input.sessionId, turnId });
        return;
      }
      const completed = await finishTurn(
        db, runtimeView, event.output, now, createId,
      );
      yield parseEvent({ type: "assistant.message.completed", sessionId: input.sessionId, turnId, message: completed.message });
      yield parseEvent({
        type: "interview.state.changed", sessionId: input.sessionId, turnId,
        revision: completed.view.session.revision,
        phase: completed.view.session.phase,
        turnState: completed.view.session.turnState,
      });
      yield parseEvent({ type: "turn.completed", sessionId: input.sessionId, turnId });
      return;
    }
    throw new CategoryInterviewError("runtime_failed", "采访运行时未返回完成或中断事件");
  } catch (error) {
    if (error instanceof CategoryInterviewError && error.code !== "runtime_failed") throw error;
    const errorMessage = boundedError(error);
    await finishAbnormalTurn(
      db, input.sessionId, runtimeView.session.revision, partialText, "failed", errorMessage, now, createId,
    );
    yield parseEvent({
      type: "turn.failed", sessionId: input.sessionId, turnId,
      error: errorMessage,
    });
  }
}

async function beginTurn(
  db: ProductKnowledgeDb,
  view: CategoryInterviewView,
  input: RunInterviewTurnInput,
  now: () => Date,
  createId: (kind: string) => string,
) {
  const timestamp = now().toISOString();
  const retryMessage = input.trigger === "user_message" && input.retryMessageId
    ? view.messages.find((message) => message.id === input.retryMessageId && message.role === "user")
    : undefined;
  if (input.trigger === "user_message" && input.retryMessageId
    && (!retryMessage || retryMessage.text !== input.text)) {
    throw invalidState("重试必须引用同一会话中的原始用户消息");
  }
  const message = input.trigger === "user_message"
    ? normalizedInterviewMessageSchema.parse({
      id: createId("interview-message"), sessionId: view.session.id,
      sequence: view.messages.length + 1, role: "user", text: input.text,
      deliveryStatus: "completed", createdAt: timestamp,
    })
    : undefined;
  await db.transaction(async (transaction) => {
    const updated = await transaction.update(categoryInterviewSessions).set({
      turnState: "running", revision: view.session.revision + 1, updatedAt: timestamp,
    }).where(and(
      eq(categoryInterviewSessions.id, view.session.id),
      eq(categoryInterviewSessions.revision, view.session.revision),
    )).returning({ id: categoryInterviewSessions.id });
    if (updated.length !== 1) throw revisionConflict(view.session.id);
    // WHY：确认按钮是 Workbench action，不是用户说了一句“继续”；系统推进不得污染 Chat Timeline 的用户事实。
    if (message && !retryMessage) await transaction.insert(categoryInterviewMessages).values(message);
  });
}

async function finishTurn(
  db: ProductKnowledgeDb,
  view: CategoryInterviewView,
  rawOutput: CategoryInterviewRuntimeOutput,
  now: () => Date,
  createId: (kind: string) => string,
) {
  const output = categoryInterviewRuntimeOutputSchema.parse(rawOutput);
  const timestamp = now().toISOString();
  const message = normalizedInterviewMessageSchema.parse({
    id: createId("interview-message"), sessionId: view.session.id,
    sequence: view.messages.length + 1, role: "assistant", text: output.assistantText,
    deliveryStatus: "completed", createdAt: timestamp,
  });
  await db.transaction(async (transaction) => {
    await transaction.insert(categoryInterviewMessages).values(message);
    if (output.proposedDecision) {
      await transaction.insert(categoryInterviewDecisions).values({
        id: createId("interview-decision"), sessionId: view.session.id,
        ...output.proposedDecision, status: "proposed", sourceMessageId: message.id, createdAt: timestamp,
      });
    }
    for (const item of output.unresolvedItems) {
      await transaction.insert(categoryInterviewUnresolvedItems).values({
        id: createId("interview-unresolved"), sessionId: view.session.id,
        ...item, status: "open", createdAt: timestamp,
      }).onConflictDoNothing();
    }
    if (output.resolvedUnresolvedKeys.length > 0) {
      await transaction.update(categoryInterviewUnresolvedItems).set({ status: "resolved", resolvedAt: timestamp })
        .where(and(
          eq(categoryInterviewUnresolvedItems.sessionId, view.session.id),
          eq(categoryInterviewUnresolvedItems.status, "open"),
          inArray(categoryInterviewUnresolvedItems.key, output.resolvedUnresolvedKeys),
        ));
    }
    if (output.briefCandidate) {
      const existing = await transaction.select().from(categoryResearchBriefVersions)
        .where(eq(categoryResearchBriefVersions.sessionId, view.session.id));
      await transaction.insert(categoryResearchBriefVersions).values({
        id: createId("category-brief"), sessionId: view.session.id, version: existing.length + 1,
        status: "draft", contentHash: contentHash(output.briefCandidate), content: output.briefCandidate,
        createdAt: timestamp,
      });
    }
    const nextPhase = output.briefCandidate ? "brief_ready" : view.session.phase;
    const updated = await transaction.update(categoryInterviewSessions).set({
      phase: nextPhase, turnState: "idle",
      revision: view.session.revision + 1, updatedAt: timestamp,
    }).where(and(
      eq(categoryInterviewSessions.id, view.session.id),
      eq(categoryInterviewSessions.revision, view.session.revision),
    )).returning({ id: categoryInterviewSessions.id });
    if (updated.length !== 1) throw revisionConflict(view.session.id);
  });
  return { message, view: await requireView(db, view.session.id) };
}

async function finishAbnormalTurn(
  db: ProductKnowledgeDb,
  sessionId: string,
  expectedRevision: number,
  partialText: string,
  status: "interrupted" | "failed",
  errorMessage: string | undefined,
  now: () => Date,
  createId: (kind: string) => string,
) {
  const view = await requireView(db, sessionId);
  const timestamp = now().toISOString();
  await db.transaction(async (transaction) => {
    if (partialText || errorMessage) {
      await transaction.insert(categoryInterviewMessages).values({
        id: createId("interview-message"), sessionId, sequence: view.messages.length + 1,
        role: "assistant", text: partialText || "本轮采访失败。",
        deliveryStatus: status, error: errorMessage, createdAt: timestamp,
      });
    }
    const updated = await transaction.update(categoryInterviewSessions).set({
      turnState: status, revision: expectedRevision + 1, updatedAt: timestamp,
    }).where(and(
      eq(categoryInterviewSessions.id, sessionId),
      eq(categoryInterviewSessions.revision, expectedRevision),
    )).returning({ id: categoryInterviewSessions.id });
    if (updated.length !== 1) throw revisionConflict(sessionId);
  });
}

async function confirmDecision(
  db: ProductKnowledgeDb,
  input: ConfirmInterviewDecisionInput,
  now: () => Date,
  createId: (kind: string) => string,
) {
  const view = await requireView(db, input.sessionId);
  requireRevision(view, input.expectedRevision);
  const proposal = view.decisions.find((decision) => decision.id === input.decisionId && decision.status === "proposed");
  if (!proposal) throw invalidState("只能确认当前会话中的待确认决定");
  const timestamp = now().toISOString();
  const confirmed = interviewDecisionSchema.parse({
    ...proposal, id: createId("interview-decision"), status: "confirmed",
    supersedesDecisionId: proposal.id, createdAt: timestamp, confirmedAt: timestamp,
  });
  await db.transaction(async (transaction) => {
    await transaction.insert(categoryInterviewDecisions).values(confirmed);
    const updated = await transaction.update(categoryInterviewSessions).set({
      revision: view.session.revision + 1, updatedAt: timestamp,
    }).where(and(
      eq(categoryInterviewSessions.id, input.sessionId),
      eq(categoryInterviewSessions.revision, input.expectedRevision),
    )).returning({ id: categoryInterviewSessions.id });
    if (updated.length !== 1) throw revisionConflict(input.sessionId);
  });
  return requireView(db, input.sessionId);
}

async function confirmBrief(
  db: ProductKnowledgeDb,
  productProjects: ProductProjectModule,
  input: ConfirmCategoryBriefInput,
  now: () => Date,
  createId: (kind: string) => string,
): Promise<ConfirmedCategoryBriefResult> {
  const view = await requireView(db, input.sessionId);
  requireRevision(view, input.expectedRevision);
  const draft = view.briefs.find((brief) => brief.id === input.briefId && brief.status === "draft");
  if (!draft) throw invalidState("只能确认当前会话中的任务书草稿");
  const confirmedIds = new Set(view.decisions.filter((decision) => decision.status === "confirmed").map((decision) => decision.id));
  if (draft.content.decisionIds.some((id) => !confirmedIds.has(id))) {
    throw invalidState("任务书引用了尚未确认的采访决定");
  }
  const entrypointReferenceIds = new Set(draft.content.investigatedFacts
    .filter((fact) => fact.kind === "source_entrypoint")
    .flatMap((fact) => fact.factReferenceIds));
  const assignedReferenceIds = new Set(draft.content.sourceAssignments
    .map((assignment) => assignment.factReferenceId));
  if (draft.content.sourceAssignments.length === 0
    || [...entrypointReferenceIds].some((id) => !assignedReferenceIds.has(id))) {
    throw invalidState("任务书必须把每个正式来源入口显式分配给路线和知识需求");
  }
  const timestamp = now().toISOString();
  const confirmedId = createId("category-brief");
  const project = await productProjects.saveDraft(projectDraftFromBrief(draft, confirmedId));
  const brief = categoryResearchBriefVersionSchema.parse({
    ...draft, id: confirmedId, version: draft.version + 1, status: "confirmed",
    projectId: project.project.id, createdAt: timestamp, confirmedAt: timestamp,
  });
  await db.transaction(async (transaction) => {
    await transaction.update(categoryResearchBriefVersions).set({ status: "superseded" })
      .where(eq(categoryResearchBriefVersions.id, draft.id));
    await transaction.insert(categoryResearchBriefVersions).values({
      ...brief, content: brief.content,
    });
    const updated = await transaction.update(categoryInterviewSessions).set({
      phase: "confirmed", turnState: "idle", revision: view.session.revision + 1, updatedAt: timestamp,
    }).where(and(
      eq(categoryInterviewSessions.id, input.sessionId),
      eq(categoryInterviewSessions.revision, input.expectedRevision),
    )).returning({ id: categoryInterviewSessions.id });
    if (updated.length !== 1) throw revisionConflict(input.sessionId);
  });
  return { interview: await requireView(db, input.sessionId), brief, project };
}

async function loadView(db: ProductKnowledgeDb, sessionId: string): Promise<CategoryInterviewView | null> {
  const session = await db.query.categoryInterviewSessions.findFirst({
    where: eq(categoryInterviewSessions.id, sessionId),
  });
  if (!session) return null;
  const [messages, decisions, unresolvedItems, briefs] = await Promise.all([
    db.select().from(categoryInterviewMessages).where(eq(categoryInterviewMessages.sessionId, sessionId))
      .orderBy(asc(categoryInterviewMessages.sequence)),
    db.select().from(categoryInterviewDecisions).where(eq(categoryInterviewDecisions.sessionId, sessionId))
      .orderBy(asc(categoryInterviewDecisions.createdAt), asc(categoryInterviewDecisions.id)),
    db.select().from(categoryInterviewUnresolvedItems).where(eq(categoryInterviewUnresolvedItems.sessionId, sessionId))
      .orderBy(asc(categoryInterviewUnresolvedItems.createdAt)),
    db.select().from(categoryResearchBriefVersions).where(eq(categoryResearchBriefVersions.sessionId, sessionId))
      .orderBy(asc(categoryResearchBriefVersions.version)),
  ]);
  return categoryInterviewViewSchema.parse({
    session: normalizeTimestamps(session),
    messages: messages.map((message) => omitNulls(normalizeTimestamps(message))),
    decisions: decisions.map((decision) => omitNulls(normalizeTimestamps(decision))),
    unresolvedItems: unresolvedItems.map((item) => omitNulls(normalizeTimestamps(item))),
    briefs: briefs.map((brief) => omitNulls(normalizeTimestamps(brief))),
  });
}

async function requireView(db: ProductKnowledgeDb, sessionId: string) {
  const view = await loadView(db, sessionId);
  if (!view) throw new CategoryInterviewError("not_found", `采访会话不存在：${sessionId}`);
  return view;
}

function normalizeTimestamps<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [
    key,
    key.endsWith("At") && typeof field === "string" ? new Date(field).toISOString() : field,
  ]));
}

function omitNulls(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null));
}

function requireRevision(view: CategoryInterviewView, expectedRevision: number) {
  if (view.session.revision !== expectedRevision) throw revisionConflict(view.session.id);
}

function revisionConflict(sessionId: string) {
  return new CategoryInterviewError("revision_conflict", `采访版本已变化，请重新读取：${sessionId}`);
}

function invalidState(message: string) {
  return new CategoryInterviewError("invalid_state", message);
}

function parseEvent(input: InterviewTimelineEvent) {
  return interviewTimelineEventSchema.parse(input);
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2000) || "采访运行时失败";
}
