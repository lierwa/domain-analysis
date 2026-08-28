import {
  DEFAULT_TASK_MODEL_SELECTION,
  categoryInterviewViewSchema,
  interviewSessionSchema,
  taskModelSelectionSchema,
  type CategoryInterviewView,
  type TaskModelSelection,
} from "@domain-analysis/shared";
import {
  categoryInterviewSessions,
  type WorkbenchDb,
} from "@domain-analysis/db";
import { and, eq } from "drizzle-orm";

import { CategoryInterviewError } from "./categoryInterviewRecords";
import { requireCategoryInterviewView } from "./categoryInterviewViewStore";

export async function startCategoryInterviewSession(
  db: WorkbenchDb,
  input: { initialRequest: string; modelSelection?: TaskModelSelection },
  now: () => Date,
  createId: (kind: string) => string,
): Promise<CategoryInterviewView> {
  const modelSelection = taskModelSelectionSchema.parse(
    input.modelSelection ?? DEFAULT_TASK_MODEL_SELECTION,
  );
  const timestamp = now().toISOString();
  const session = interviewSessionSchema.parse({
    id: createId("interview-session"), initialRequest: input.initialRequest, modelSelection,
    phase: "active", turnState: "idle",
    revision: 1, createdAt: timestamp, updatedAt: timestamp,
  });
  await db.insert(categoryInterviewSessions).values({
    id: session.id,
    initialRequest: session.initialRequest,
    modelId: session.modelSelection.modelId,
    reasoningEffort: session.modelSelection.reasoningEffort,
    phase: session.phase,
    turnState: session.turnState,
    revision: session.revision,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
  return categoryInterviewViewSchema.parse({
    session, messages: [], decisions: [], unresolvedItems: [], taskDrafts: [],
  });
}

export async function updateCategoryInterviewModelSelection(
  db: WorkbenchDb,
  input: { sessionId: string; expectedRevision: number; modelSelection: TaskModelSelection },
  now: () => Date,
): Promise<CategoryInterviewView> {
  const current = await requireCategoryInterviewView(db, input.sessionId);
  if (current.session.revision !== input.expectedRevision) throw revisionConflict(input.sessionId);
  if (current.session.turnState === "running") throw invalidState("采访运行期间不能切换模型");
  const modelSelection = taskModelSelectionSchema.parse(input.modelSelection);
  const changed = await db.update(categoryInterviewSessions).set({
    modelId: modelSelection.modelId,
    reasoningEffort: modelSelection.reasoningEffort,
    revision: current.session.revision + 1,
    updatedAt: now().toISOString(),
  }).where(and(
    eq(categoryInterviewSessions.id, input.sessionId),
    eq(categoryInterviewSessions.revision, input.expectedRevision),
  )).returning({ id: categoryInterviewSessions.id });
  if (changed.length !== 1) throw revisionConflict(input.sessionId);
  return requireCategoryInterviewView(db, input.sessionId);
}

function revisionConflict(sessionId: string) {
  return new CategoryInterviewError("revision_conflict", `抓取任务对话已更新，请刷新后重试：${sessionId}`);
}

function invalidState(message: string) {
  return new CategoryInterviewError("invalid_state", message);
}
