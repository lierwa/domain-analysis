import { randomUUID } from "node:crypto";

import {
  captureTaskContentSchema,
  captureTaskSchema,
  type CaptureTask,
  type CaptureTaskContent,
} from "@domain-analysis/shared";
import type { WorkbenchDb } from "@domain-analysis/db";
import { captureTasks } from "@domain-analysis/db";
import { and, desc, eq, ne } from "drizzle-orm";

export interface CaptureTaskModule {
  list(): Promise<CaptureTask[]>;
  get(taskId: string): Promise<CaptureTask | null>;
  archive(taskId: string): Promise<void>;
}

export class CaptureTaskError extends Error {
  constructor(readonly code: "not_found" | "invalid_state", message: string) {
    super(message);
    this.name = "CaptureTaskError";
  }
}

export function createCaptureTaskModule(db: WorkbenchDb): CaptureTaskModule {
  return {
    list: async () => (await db.select().from(captureTasks)
      .where(ne(captureTasks.status, "archived"))
      .orderBy(desc(captureTasks.updatedAt)))
      .map(normalizeTask),
    get: async (taskId) => {
      const row = await db.query.captureTasks.findFirst({
        where: and(eq(captureTasks.id, taskId), ne(captureTasks.status, "archived")),
      });
      return row ? normalizeTask(row) : null;
    },
    archive: async (taskId) => {
      const rows = await db.update(captureTasks).set({
        // WHY：正式任务可能已经关联版本历史和原始数据；“删除记录”只移出活动工作区，不能物理抹掉审计事实。
        status: "archived",
        updatedAt: new Date().toISOString(),
      }).where(eq(captureTasks.id, taskId)).returning({ id: captureTasks.id });
      if (rows.length === 0) throw new CaptureTaskError("not_found", `抓取任务不存在：${taskId}`);
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
  // WHY：数据库原文是不可变审计事实；当前读模型只投影现行通用契约，旧扩展字段不再进入业务规则。
  const content = row.content ? captureTaskContentSchema.strip().parse(row.content) : legacyTaskContent(row);
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
    sourceCandidates: [],
    excludedContent: [],
    unresolvedItems: [{ key: "legacy.scope", description: "需要重新通过对话确认抓取范围", owner: "user" }],
    decisionIds: [],
  };
}

function normalizeTimestamp(value: string) {
  return new Date(value).toISOString();
}
