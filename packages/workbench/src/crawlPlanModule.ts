import { createHash, randomUUID } from "node:crypto";

import { sourceCollectionPlans, type WorkbenchDb } from "@domain-analysis/db";
import {
  brandRankingPlanningAuditSchema,
  crawlPlanContentSchema,
  crawlPlanSchema,
  type CrawlPlan,
  type CrawlPlanContent,
} from "@domain-analysis/shared";
import { and, desc, eq } from "drizzle-orm";

import type { CaptureTaskModule } from "./captureTaskModule";
import type { CrawlPlanExecutionReader } from "./sourceExecutionModule";

export interface CrawlPlanModule extends CrawlPlanExecutionReader {
  publishDraft(input: {
    taskId: string;
    expectedTaskRevision: number;
    planningRunId: string;
    content: CrawlPlanContent;
  }): Promise<CrawlPlan>;
  confirmDraft(input: {
    taskId: string;
    expectedTaskRevision: number;
    planId: string;
  }): Promise<CrawlPlan>;
  publishConfirmed(input: {
    taskId: string;
    expectedTaskRevision: number;
    content: CrawlPlanContent;
  }): Promise<CrawlPlan>;
  listForTask(taskId: string): Promise<CrawlPlan[]>;
  latestConfirmed(taskId: string): Promise<CrawlPlan | null>;
}

export class CrawlPlanError extends Error {
  constructor(
    readonly code: "not_found" | "revision_conflict" | "invalid_state",
    message: string,
  ) {
    super(message);
    this.name = "CrawlPlanError";
  }
}

export function createCrawlPlanModule(
  db: WorkbenchDb,
  tasks: CaptureTaskModule,
  now: () => Date = () => new Date(),
): CrawlPlanModule {
  return {
    publishDraft: async (input) => {
      const task = await requireReadyTask(tasks, input.taskId, input.expectedTaskRevision);
      const content = requireTaskContent(input.content, task.id, task.revision);
      const contentHash = digest(JSON.stringify(content));
      const existing = await db.query.sourceCollectionPlans.findFirst({
        where: and(eq(sourceCollectionPlans.taskId, task.id), eq(sourceCollectionPlans.contentHash, contentHash)),
      });
      if (existing) return normalizePlan(existing);

      return db.transaction(async (transaction) => {
        const [latest] = await transaction.select({ version: sourceCollectionPlans.version })
          .from(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, task.id))
          .orderBy(desc(sourceCollectionPlans.version)).limit(1);
        const version = (latest?.version ?? 0) + 1;
        const timestamp = now().toISOString();
        // WHY：一个任务只展示最新待确认草稿；已确认版本在新草稿获批前仍保持可执行。
        await transaction.update(sourceCollectionPlans).set({ status: "superseded" })
          .where(and(eq(sourceCollectionPlans.taskId, task.id), eq(sourceCollectionPlans.status, "draft")));
        const [row] = await transaction.insert(sourceCollectionPlans).values({
          id: `crawl-plan-${randomUUID()}`,
          taskId: task.id,
          taskRevision: task.revision,
          planningRunId: input.planningRunId,
          version,
          status: "draft",
          contentHash,
          content,
          createdAt: timestamp,
        }).returning();
        if (!row) throw new Error("来源计划草稿写入后没有返回记录");
        return normalizePlan(row);
      });
    },
    confirmDraft: async (input) => {
      const task = await requireReadyTask(tasks, input.taskId, input.expectedTaskRevision);
      return db.transaction(async (transaction) => {
        const [candidate] = await transaction.select().from(sourceCollectionPlans)
          .where(and(eq(sourceCollectionPlans.id, input.planId), eq(sourceCollectionPlans.taskId, task.id)))
          .limit(1);
        if (!candidate) throw new CrawlPlanError("not_found", "Crawl Plan Draft 不存在");
        if (candidate.taskRevision !== task.revision) throw revisionConflict(task.id);
        if (candidate.status === "confirmed") return normalizePlan(candidate);
        if (candidate.status !== "draft") {
          throw new CrawlPlanError("invalid_state", "只有当前 Crawl Plan Draft 可以确认");
        }
        const candidateContent = crawlPlanContentSchema.parse(candidate.content);
        if (candidateContent.executionChecklistVersion !== 5) {
          throw new CrawlPlanError("invalid_state", "该草稿使用旧规划协议，请重新运行 Planning Run");
        }
        requireCurrentPlanningAudit(candidateContent);
        if (candidateContent.planningBlockers.length > 0) {
          throw new CrawlPlanError("invalid_state", `计划仍有确认阻塞：${candidateContent.planningBlockers[0]}`);
        }
        const timestamp = now().toISOString();
        await transaction.update(sourceCollectionPlans).set({ status: "superseded" })
          .where(and(eq(sourceCollectionPlans.taskId, task.id), eq(sourceCollectionPlans.status, "confirmed")));
        const [confirmed] = await transaction.update(sourceCollectionPlans)
          .set({ status: "confirmed", confirmedAt: timestamp })
          .where(eq(sourceCollectionPlans.id, candidate.id)).returning();
        if (!confirmed) throw new Error("来源计划确认后没有返回记录");
        return normalizePlan(confirmed);
      });
    },
    publishConfirmed: async (input) => publishConfirmed(db, tasks, now, input),
    listForTask: async (taskId) => {
      const rows = await db.select().from(sourceCollectionPlans)
        .where(eq(sourceCollectionPlans.taskId, taskId))
        .orderBy(desc(sourceCollectionPlans.version));
      return rows.map(normalizePlan);
    },
    latestConfirmed: async (taskId) => {
      const row = await db.query.sourceCollectionPlans.findFirst({
        where: and(eq(sourceCollectionPlans.taskId, taskId), eq(sourceCollectionPlans.status, "confirmed")),
        orderBy: [desc(sourceCollectionPlans.version)],
      });
      return row ? normalizePlan(row) : null;
    },
    requireExecutablePlan: async (input) => {
      const task = await requireReadyTask(tasks, input.taskId, input.expectedTaskRevision);
      const row = await db.query.sourceCollectionPlans.findFirst({
        where: and(eq(sourceCollectionPlans.id, input.planId), eq(sourceCollectionPlans.taskId, task.id)),
      });
      if (!row) throw new CrawlPlanError("not_found", "已确认来源计划不存在");
      const plan = normalizePlan(row);
      if (plan.version !== input.expectedPlanVersion || plan.taskRevision !== task.revision) {
        throw revisionConflict(task.id);
      }
      if (plan.status !== "confirmed") {
        throw new CrawlPlanError("invalid_state", "只有当前已确认来源计划可以启动");
      }
      if (plan.content.executionChecklistVersion !== 5) {
        throw new CrawlPlanError("invalid_state", "已确认计划使用旧规划协议，请重新运行 Planning Run");
      }
      requireCurrentPlanningAudit(plan.content);
      if (plan.content.planningBlockers.length > 0) {
        throw new CrawlPlanError("invalid_state", `计划仍有执行阻塞：${plan.content.planningBlockers[0]}`);
      }
      const blocker = plan.content.sources.flatMap((source) => source.executionBlockers)[0];
      if (blocker) throw new CrawlPlanError("invalid_state", `来源仍有执行阻塞：${blocker}`);
      return plan;
    },
  };
}

function requireCurrentPlanningAudit(content: CrawlPlanContent) {
  const parsed = brandRankingPlanningAuditSchema.safeParse(content.researchAudit);
  if (!parsed.success) {
    throw new CrawlPlanError("invalid_state", "计划缺少当前协议的品牌排行榜审计，请重新运行 Planning Run");
  }
  return parsed.data;
}

async function publishConfirmed(
  db: WorkbenchDb,
  tasks: CaptureTaskModule,
  now: () => Date,
  input: { taskId: string; expectedTaskRevision: number; content: CrawlPlanContent },
) {
  const task = await requireReadyTask(tasks, input.taskId, input.expectedTaskRevision);
  const content = requireTaskContent(input.content, task.id, task.revision);
  if (content.planningBlockers.length > 0) {
    throw new CrawlPlanError("invalid_state", "受阻 Crawl Plan Draft 不能直接发布为已确认计划");
  }
  const contentHash = digest(JSON.stringify(content));
  const existing = await db.query.sourceCollectionPlans.findFirst({
    where: and(eq(sourceCollectionPlans.taskId, task.id), eq(sourceCollectionPlans.contentHash, contentHash)),
  });
  if (existing) return normalizePlan(existing);
  return db.transaction(async (transaction) => {
    const [latest] = await transaction.select({ version: sourceCollectionPlans.version })
      .from(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, task.id))
      .orderBy(desc(sourceCollectionPlans.version)).limit(1);
    const timestamp = now().toISOString();
    await transaction.update(sourceCollectionPlans).set({ status: "superseded" })
      .where(and(eq(sourceCollectionPlans.taskId, task.id), eq(sourceCollectionPlans.status, "confirmed")));
    const [row] = await transaction.insert(sourceCollectionPlans).values({
      id: `crawl-plan-${randomUUID()}`,
      taskId: task.id,
      taskRevision: task.revision,
      version: (latest?.version ?? 0) + 1,
      status: "confirmed",
      contentHash,
      content,
      createdAt: timestamp,
      confirmedAt: timestamp,
    }).returning();
    if (!row) throw new Error("已确认来源计划写入后没有返回记录");
    return normalizePlan(row);
  });
}

async function requireReadyTask(tasks: CaptureTaskModule, taskId: string, expectedRevision: number) {
  const task = await tasks.get(taskId);
  if (!task) throw new CrawlPlanError("not_found", `Capture Task 不存在：${taskId}`);
  if (task.revision !== expectedRevision) throw revisionConflict(taskId);
  if (task.status !== "ready" || !task.confirmedAt) {
    throw new CrawlPlanError("invalid_state", "只有已确认的 Capture Task 可以制定或执行来源计划");
  }
  return task;
}

function requireTaskContent(contentInput: CrawlPlanContent, taskId: string, taskRevision: number) {
  const content = crawlPlanContentSchema.parse(contentInput);
  if (content.taskId !== taskId || content.taskRevision !== taskRevision) throw revisionConflict(taskId);
  return content;
}

function normalizePlan(row: typeof sourceCollectionPlans.$inferSelect): CrawlPlan {
  const { planningRunId, confirmedAt, ...persisted } = row;
  return crawlPlanSchema.parse({
    ...persisted,
    ...(planningRunId ? { planningRunId } : {}),
    createdAt: new Date(row.createdAt).toISOString(),
    ...(confirmedAt ? { confirmedAt: new Date(confirmedAt).toISOString() } : {}),
  });
}

function revisionConflict(taskId: string) {
  return new CrawlPlanError("revision_conflict", `抓取任务或计划版本已经变化：${taskId}`);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
