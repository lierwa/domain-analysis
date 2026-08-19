import { interviewSessionSchema, type InterviewSession } from "@domain-analysis/shared";
import {
  captureTaskDraftVersions,
  categoryInterviewDecisions,
  categoryInterviewMessages,
  categoryInterviewSessions,
  categoryInterviewUnresolvedItems,
  type WorkbenchDb,
} from "@domain-analysis/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";

export class CategoryInterviewError extends Error {
  constructor(
    readonly code: "not_found" | "revision_conflict" | "invalid_state" | "runtime_failed",
    message: string,
  ) {
    super(message);
    this.name = "CategoryInterviewError";
  }
}

export async function listStandaloneInterviewSessions(db: WorkbenchDb): Promise<InterviewSession[]> {
  const rows = await db.select().from(categoryInterviewSessions).orderBy(desc(categoryInterviewSessions.updatedAt));
  const linkedRows = await db.select({ sessionId: captureTaskDraftVersions.sessionId })
    .from(captureTaskDraftVersions)
    .where(isNotNull(captureTaskDraftVersions.taskId));
  const linkedSessionIds = new Set(linkedRows.map((row) => row.sessionId));
  // WHY：正式任务由 Capture Task 记录代表；这里只列独立未完成采访，避免修订中的同一任务重复出现两次。
  return rows
    .filter((row) => row.phase !== "confirmed" && !linkedSessionIds.has(row.id))
    .map((row) => interviewSessionSchema.parse({
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    }));
}

export async function removeStandaloneInterviewSession(db: WorkbenchDb, sessionId: string) {
  const session = await db.query.categoryInterviewSessions.findFirst({
    where: eq(categoryInterviewSessions.id, sessionId),
  });
  if (!session) throw new CategoryInterviewError("not_found", `采访会话不存在：${sessionId}`);
  if (session.turnState === "running") {
    throw new CategoryInterviewError("invalid_state", "采访正在运行，停止后才能删除");
  }
  const linkedTask = await db.query.captureTaskDraftVersions.findFirst({
    where: and(
      eq(captureTaskDraftVersions.sessionId, sessionId),
      isNotNull(captureTaskDraftVersions.taskId),
    ),
  });
  if (linkedTask) {
    throw new CategoryInterviewError("invalid_state", "已关联正式任务的采访记录不能单独删除，请删除正式任务记录");
  }

  await db.transaction(async (transaction) => {
    // WHY：未确认采访只拥有自己的对话事实；按外键顺序整体删除，避免留下不可恢复的半条记录。
    await transaction.delete(categoryInterviewDecisions)
      .where(eq(categoryInterviewDecisions.sessionId, sessionId));
    await transaction.delete(categoryInterviewUnresolvedItems)
      .where(eq(categoryInterviewUnresolvedItems.sessionId, sessionId));
    await transaction.delete(captureTaskDraftVersions)
      .where(eq(captureTaskDraftVersions.sessionId, sessionId));
    await transaction.delete(categoryInterviewMessages)
      .where(eq(categoryInterviewMessages.sessionId, sessionId));
    await transaction.delete(categoryInterviewSessions)
      .where(eq(categoryInterviewSessions.id, sessionId));
  });
}
