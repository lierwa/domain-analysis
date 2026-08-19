import { randomUUID } from "node:crypto";

import type { CaptureTaskContent } from "@domain-analysis/shared";
import {
  captureTaskDraftVersions,
  captureTasks,
  categoryInterviewDecisions,
  categoryInterviewMessages,
  categoryInterviewSessions,
  categoryInterviewUnresolvedItems,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  type WorkbenchDb,
} from "@domain-analysis/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildConfirmedCaptureTask,
  createCaptureTaskModule,
  createCategoryInterviewModule,
  type CategoryInterviewModule,
  type CategoryInterviewRuntime,
} from "../src";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("任务记录生命周期", () => {
  let db: WorkbenchDb | undefined;
  const sessionIds: string[] = [];
  const taskIds: string[] = [];

  afterEach(async () => {
    if (db) {
      for (const sessionId of sessionIds) await cleanupSession(db, sessionId);
      for (const taskId of taskIds) await db.delete(captureTasks).where(eq(captureTasks.id, taskId));
      await db.$client.end();
    }
    db = undefined;
    sessionIds.length = 0;
    taskIds.length = 0;
  });

  it("删除未完成采访时清理其私有消息，且不会再出现在记录列表", async () => {
    db = await openDb();
    const interviews = createCategoryInterviewModule(db, new UnusedRuntime());
    const view = await interviews.start({ initialRequest: "抓电视机" });
    sessionIds.push(view.session.id);
    await db.insert(categoryInterviewMessages).values({
      id: `message-${randomUUID()}`,
      sessionId: view.session.id,
      sequence: 1,
      role: "user",
      text: "抓电视机",
      deliveryStatus: "completed",
      createdAt: new Date().toISOString(),
    });

    await removable(interviews).remove(view.session.id);

    await expect(interviews.get(view.session.id)).resolves.toBeNull();
    await expect(interviews.list()).resolves.not.toContainEqual(expect.objectContaining({ id: view.session.id }));
    const messages = await db.select().from(categoryInterviewMessages)
      .where(eq(categoryInterviewMessages.sessionId, view.session.id));
    expect(messages).toHaveLength(0);
  });

  it("正式任务从活动列表归档，但保留任务行和关联采访历史", async () => {
    db = await openDb();
    const interviews = createCategoryInterviewModule(db, new UnusedRuntime());
    const view = await interviews.start({ initialRequest: "抓冰箱" });
    sessionIds.push(view.session.id);
    const task = buildConfirmedCaptureTask(taskContent(), new Date().toISOString());
    taskIds.push(task.id);
    await db.insert(captureTasks).values({
      id: task.id,
      name: task.name,
      originalRequest: task.content.originalRequest,
      marketScope: task.content.marketScope,
      status: task.status,
      revision: task.revision,
      content: task.content,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      confirmedAt: task.confirmedAt,
    });
    await db.insert(captureTaskDraftVersions).values({
      id: `draft-${randomUUID()}`,
      sessionId: view.session.id,
      version: 1,
      status: "confirmed",
      contentHash: "0".repeat(64),
      briefMarkdown: "# 冰箱采访范围\n\n覆盖中国大陆家用冰箱。",
      taskId: task.id,
      createdAt: task.createdAt,
      confirmedAt: task.confirmedAt,
    });
    const tasks = createCaptureTaskModule(db) as ReturnType<typeof createCaptureTaskModule> & {
      archive(taskId: string): Promise<void>;
    };

    await tasks.archive(task.id);

    await expect(tasks.get(task.id)).resolves.toBeNull();
    await expect(tasks.list()).resolves.not.toContainEqual(expect.objectContaining({ id: task.id }));
    const [stored] = await db.select().from(captureTasks).where(eq(captureTasks.id, task.id));
    expect(stored?.status).toBe("archived");
    await expect(interviews.get(view.session.id)).resolves.not.toBeNull();
    await expect(removable(interviews).remove(view.session.id)).rejects.toMatchObject({
      code: "invalid_state",
    });
    await expect(interviews.list()).resolves.not.toContainEqual(expect.objectContaining({ id: view.session.id }));
  });
});

function removable(interviews: CategoryInterviewModule) {
  return interviews as CategoryInterviewModule & { remove(sessionId: string): Promise<void> };
}

async function openDb() {
  await migrateWorkbenchDatabase(databaseUrl!);
  return createWorkbenchDb(databaseUrl!);
}

class UnusedRuntime implements CategoryInterviewRuntime {
  async *run(): ReturnType<CategoryInterviewRuntime["run"]> {
    throw new Error("该测试不应启动 Codex runtime");
  }

  async materialize(): ReturnType<CategoryInterviewRuntime["materialize"]> {
    throw new Error("该测试不应启动 Codex runtime");
  }
}

function taskContent(): CaptureTaskContent {
  return {
    originalRequest: "抓冰箱",
    category: { code: "refrigerator", label: "冰箱" },
    marketScope: "中国大陆家用冰箱",
    generalTopics: ["品牌与型号"],
    categoryTopics: ["能效与容量"],
    jd: { applicable: true, disposition: "pending", scope: [], rationale: "尚待确认" },
    sourceCandidates: [],
    excludedContent: [],
    unresolvedItems: [],
    decisionIds: [],
  };
}

async function cleanupSession(db: WorkbenchDb, sessionId: string) {
  await db.delete(categoryInterviewDecisions).where(eq(categoryInterviewDecisions.sessionId, sessionId));
  await db.delete(categoryInterviewUnresolvedItems).where(eq(categoryInterviewUnresolvedItems.sessionId, sessionId));
  await db.delete(captureTaskDraftVersions).where(eq(captureTaskDraftVersions.sessionId, sessionId));
  await db.delete(categoryInterviewMessages).where(eq(categoryInterviewMessages.sessionId, sessionId));
  await db.delete(categoryInterviewSessions).where(eq(categoryInterviewSessions.id, sessionId));
}
