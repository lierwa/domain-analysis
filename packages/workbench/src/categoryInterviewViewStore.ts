import {
  captureTaskDraftVersionSchema,
  categoryInterviewViewSchema,
  interviewDecisionSchema,
  interviewSessionSchema,
  interviewUnresolvedItemSchema,
  normalizedInterviewMessageSchema,
  type CaptureTaskDraftVersion,
  type CategoryInterviewView,
} from "@domain-analysis/shared";
import type { WorkbenchDb } from "@domain-analysis/db";
import {
  captureTaskDraftVersions,
  categoryInterviewDecisions,
  categoryInterviewMessages,
  categoryInterviewSessions,
  categoryInterviewUnresolvedItems,
} from "@domain-analysis/db";
import { asc, desc, eq } from "drizzle-orm";

import { CategoryInterviewError } from "./categoryInterviewRecords";

export async function loadCategoryInterviewView(
  db: WorkbenchDb,
  sessionId: string,
): Promise<CategoryInterviewView | null> {
  const session = await db.query.categoryInterviewSessions.findFirst({
    where: eq(categoryInterviewSessions.id, sessionId),
  });
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
    const { briefMarkdown, ...draftRow } = row;
    const parsed = captureTaskDraftVersionSchema.safeParse({
      ...omitNulls(normalizeTimestamps(draftRow)),
      markdown: briefMarkdown,
    });
    return parsed.success ? [parsed.data] : [];
  });
  const normalizedDecisions = decisions.map(normalizeDecision);
  const normalizedUnresolvedItems = unresolvedItems.map((item) => interviewUnresolvedItemSchema.parse(
    omitNulls(normalizeTimestamps(item)),
  ));
  return categoryInterviewViewSchema.parse({
    session: normalizeSession(session, taskDrafts, normalizedDecisions, normalizedUnresolvedItems),
    messages: messages.map((item) => normalizedInterviewMessageSchema.parse(omitNulls(normalizeTimestamps(item)))),
    decisions: normalizedDecisions,
    unresolvedItems: normalizedUnresolvedItems,
    taskDrafts,
  });
}

export async function loadCategoryInterviewViewByTaskId(db: WorkbenchDb, taskId: string) {
  const draft = await db.query.captureTaskDraftVersions.findFirst({
    where: eq(captureTaskDraftVersions.taskId, taskId),
    orderBy: [desc(captureTaskDraftVersions.version)],
  });
  return draft ? loadCategoryInterviewView(db, draft.sessionId) : null;
}

export async function requireCategoryInterviewView(db: WorkbenchDb, sessionId: string) {
  const view = await loadCategoryInterviewView(db, sessionId);
  if (!view) throw new CategoryInterviewError("not_found", `抓取任务对话不存在：${sessionId}`);
  return view;
}

function normalizeSession(
  row: typeof categoryInterviewSessions.$inferSelect,
  drafts: CaptureTaskDraftVersion[] = [],
  decisions: CategoryInterviewView["decisions"] = [],
  unresolvedItems: CategoryInterviewView["unresolvedItems"] = [],
) {
  const rawPhase = row.phase as string;
  const hasOpenOwnerDecision = decisions.some((item) => item.status === "proposed")
    || unresolvedItems.some((item) => item.owner === "user" && item.status === "open");
  const hasConfirmableDraft = !hasOpenOwnerDecision && drafts.some((item) => item.status === "draft");
  // WHY：历史 task_ready 只能在草稿仍可确认时保留；真实 active/running/failed 状态不能被旧草稿反向升级。
  const phase = rawPhase === "confirmed" ? "confirmed"
    : rawPhase === "task_ready" && hasConfirmableDraft ? "task_ready" : "active";
  return interviewSessionSchema.parse({ ...normalizeTimestamps(row), phase });
}

function normalizeDecision(row: typeof categoryInterviewDecisions.$inferSelect) {
  const options = row.options && row.options.length >= 2 ? row.options : [
    { label: row.selection ?? "历史记录", description: row.rationale, recommended: true },
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
