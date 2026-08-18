import { randomUUID } from "node:crypto";

import { captureTaskSchema, type CaptureTask, type CaptureTaskContent } from "@domain-analysis/shared";
import type { WorkbenchDb } from "@domain-analysis/db";
import { captureTasks } from "@domain-analysis/db";
import { desc, eq } from "drizzle-orm";

export interface CaptureTaskModule {
  list(): Promise<CaptureTask[]>;
  get(taskId: string): Promise<CaptureTask | null>;
}

export class CaptureTaskError extends Error {
  constructor(readonly code: "not_found" | "invalid_state", message: string) {
    super(message);
    this.name = "CaptureTaskError";
  }
}

export function createCaptureTaskModule(db: WorkbenchDb): CaptureTaskModule {
  return {
    list: async () => (await db.select().from(captureTasks).orderBy(desc(captureTasks.updatedAt)))
      .map(normalizeTask),
    get: async (taskId) => {
      const row = await db.query.captureTasks.findFirst({ where: eq(captureTasks.id, taskId) });
      return row ? normalizeTask(row) : null;
    },
  };
}

export function buildConfirmedCaptureTask(
  content: CaptureTaskContent,
  timestamp: string,
  id = `capture-task-${randomUUID()}`,
  revision = 1,
  createdAt = timestamp,
) {
  return captureTaskSchema.parse({
    id,
    name: `${content.category.label}抓取任务`,
    status: "ready",
    revision,
    content,
    createdAt,
    updatedAt: timestamp,
    confirmedAt: timestamp,
  });
}

function normalizeTask(row: typeof captureTasks.$inferSelect): CaptureTask {
  const content = row.content ?? legacyTaskContent(row);
  // WHY：旧记录没有确认时间，不能仅凭历史 ready 字符串伪装成已验收的新抓取任务。
  const status = row.status === "ready" && !row.confirmedAt ? "draft" : row.status;
  return captureTaskSchema.parse({
    id: row.id,
    name: row.name,
    status,
    revision: row.revision,
    content,
    createdAt: normalizeTimestamp(row.createdAt),
    updatedAt: normalizeTimestamp(row.updatedAt),
    ...(row.confirmedAt ? { confirmedAt: normalizeTimestamp(row.confirmedAt) } : {}),
  });
}

function legacyTaskContent(row: typeof captureTasks.$inferSelect): CaptureTaskContent {
  return {
    originalRequest: row.originalRequest,
    category: { code: "legacy", label: row.name },
    marketScope: row.marketScope,
    generalTopics: ["保留历史抓取数据；重新确认前不启动新抓取"],
    categoryTopics: [],
    jd: { applicable: false, disposition: "pending", scope: [], rationale: "历史记录尚未完成新抓取任务验收" },
    sourceCandidates: [],
    excludedContent: [],
    unresolvedItems: [{ key: "legacy.scope", description: "需要重新通过对话确认抓取范围", owner: "user" }],
    decisionIds: [],
  };
}

function normalizeTimestamp(value: string) {
  return new Date(value).toISOString();
}
