import { randomUUID } from "node:crypto";

import type {
  CaptureTaskContent,
  CrawlPlanningRuntimeOutput,
} from "@domain-analysis/shared";
import {
  captureTasks,
  crawlPlanningRuns,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  sourceCollectionPlans,
  sourceCollectionRuns,
  sourceSnapshots,
  sourceObjects,
  type WorkbenchDb,
} from "@domain-analysis/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildConfirmedCaptureTask,
  createCaptureTaskModule,
  createCrawlPlanningModule,
  createSourceDatasetModule,
  createSourceExecutionModule,
  type CrawlPlanningModule,
  type CrawlPlanningRuntime,
  type CrawlPlanningRuntimeEvent,
} from "../src";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("抓取计划版本与确认", () => {
  let db: WorkbenchDb | undefined;
  let taskId: string | undefined;

  afterEach(async () => {
    if (db && taskId) {
      const runs = await db.select({ id: sourceCollectionRuns.id }).from(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId));
      for (const run of runs) await db.delete(sourceSnapshots).where(eq(sourceSnapshots.runId, run.id));
      await db.delete(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId));
      await db.delete(sourceObjects).where(eq(sourceObjects.taskId, taskId));
      await db.delete(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, taskId));
      await db.delete(crawlPlanningRuns).where(eq(crawlPlanningRuns.taskId, taskId));
      await db.delete(captureTasks).where(eq(captureTasks.id, taskId));
    }
    await db?.$client.end();
    db = undefined;
    taskId = undefined;
  });

  it("追加计划版本并确认当前草稿，但不创建 Source Run", async () => {
    const opened = await openModules();
    db = opened.db;
    taskId = opened.task.id;
    opened.runtime.push(validOutput(40));
    await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));
    let view = (await opened.planning.get(taskId))!;
    expect(view.plans[0]).toMatchObject({ version: 1, status: "draft", taskRevision: 1 });
    expect(view.plans[0]?.content.sources[0]).toMatchObject({
      observationLevel: "search_discovered", accessState: "unknown", observedAt: "2026-08-19T08:30:00.000Z",
    });
    expect(view.runs[0]).toMatchObject({ status: "completed", planId: view.plans[0]!.id });

    opened.runtime.push(validOutput(20));
    await collect(opened.planning.run({
      taskId, expectedTaskRevision: 1, instruction: "评价样本改成 20 条",
    }));
    view = (await opened.planning.get(taskId))!;
    expect(view.plans.map((plan) => [plan.version, plan.status])).toEqual([
      [2, "draft"], [1, "superseded"],
    ]);

    view = await opened.planning.confirm({
      taskId, planId: view.plans[0]!.id, expectedTaskRevision: 1,
    });
    expect(view.plans[0]?.status).toBe("confirmed");
    expect(await db.select().from(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId))).toHaveLength(0);
  });

  it("任务 topic 缺失时失败关闭且不保存计划", async () => {
    const opened = await openModules();
    db = opened.db;
    taskId = opened.task.id;
    const output = validOutput(40);
    output.planCandidate.sources[0]!.targets = output.planCandidate.sources[0]!.targets.slice(0, 1);
    opened.runtime.push(output);

    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));
    const view = (await opened.planning.get(taskId))!;

    expect(events).toContainEqual(expect.objectContaining({ type: "run.failed" }));
    expect(view.plans).toHaveLength(0);
    expect(view.runs[0]).toMatchObject({ status: "failed" });
  });

  it("未知 topic 失败关闭，中断运行持久化后可以重试", async () => {
    const opened = await openModules();
    db = opened.db;
    taskId = opened.task.id;
    const invalid = validOutput(40);
    invalid.planCandidate.sources[0]!.targets[0]!.taskTopics = ["不存在的内容方向"];
    opened.runtime.push(invalid);
    await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    opened.runtime.interruptNext();
    const interrupted = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));
    let view = (await opened.planning.get(taskId))!;
    const interruptedEvent = interrupted.find((event) => event.type === "run.interrupted");
    expect(interruptedEvent).toMatchObject({ type: "run.interrupted" });
    expect(view.runs.find((run) => run.id === interruptedEvent?.runId)).toMatchObject({ status: "interrupted" });
    expect(view.plans).toHaveLength(0);

    opened.runtime.push(validOutput(20));
    await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));
    view = (await opened.planning.get(taskId))!;
    expect(view.plans[0]).toMatchObject({ version: 1, status: "draft" });
  });

  it("任务 revision 改变后拒绝确认旧计划", async () => {
    const opened = await openModules();
    db = opened.db;
    taskId = opened.task.id;
    opened.runtime.push(validOutput(40));
    await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));
    const view = (await opened.planning.get(taskId))!;
    await db.update(captureTasks).set({ revision: 2, updatedAt: new Date().toISOString() })
      .where(eq(captureTasks.id, taskId));

    await expect(opened.planning.confirm({
      taskId, planId: view.plans[0]!.id, expectedTaskRevision: 1,
    })).rejects.toMatchObject({ code: "revision_conflict" });
  });

  it("显式开始会重读已确认计划并写入不可变 Source Snapshot", async () => {
    const opened = await openModules(); db = opened.db; taskId = opened.task.id;
    opened.runtime.push(validOutput(20));
    await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));
    let view = (await opened.planning.get(taskId))!;
    view = await opened.planning.confirm({ taskId, planId: view.plans[0]!.id, expectedTaskRevision: 1 });
    const provider = {
      key: "jd.catalog-product", version: "1.0.0", validate() {}, async preflight() {},
      async *collect(source: typeof view.plans[0]["content"]["sources"][number]) {
        const text = `real-seam:${source.key}`;
        yield { idempotencyKey: `${source.key}-1`, object: { sourceIdentity: source.key, kind: "catalog", externalKey: "entry" },
          observation: { requestedUrl: source.entryUrls[0]!, observedAt: "2026-08-20T00:00:00.000Z", state: "accessible" as const, responseHeaders: {} },
          payload: { kind: "inline_text" as const, mediaType: "text/plain", text, bytes: text.length, contentHash: "0".repeat(64) } };
      },
    };
    const providers = new Map([["jd.catalog-product", provider], ["missing.provider", { ...provider, key: "missing.provider" }]]);
    const execution = createSourceExecutionModule(opened.planning, createSourceDatasetModule(db), providers);
    const events = [];
    for await (const event of execution.start({ taskId, planId: view.plans[0]!.id, expectedTaskRevision: 1, expectedPlanVersion: 1 })) events.push(event);
    expect(events.filter((event) => event.type === "run.completed")).toHaveLength(2);
    const runs = await db.select().from(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId));
    expect(runs.map((run) => [run.status, run.snapshotCount])).toEqual([["completed", 1], ["completed", 1]]);
  });
});

async function openModules() {
  await migrateWorkbenchDatabase(databaseUrl!);
  const db = createWorkbenchDb(databaseUrl!);
  const task = buildConfirmedCaptureTask(taskContent(), new Date().toISOString(), `task-${randomUUID()}`);
  await db.insert(captureTasks).values({
    id: task.id, name: task.name, originalRequest: task.content.originalRequest,
    marketScope: task.content.marketScope, status: task.status, revision: task.revision,
    content: task.content, createdAt: task.createdAt, updatedAt: task.updatedAt, confirmedAt: task.confirmedAt,
  });
  const runtime = new QueueRuntime();
  let sequence = 0;
  const planning = createCrawlPlanningModule(db, createCaptureTaskModule(db), runtime, {
    now: () => new Date("2026-08-19T08:30:00.000Z"),
    createId: (kind) => `${kind}-${task.id}-${++sequence}`,
  });
  return { db, task, runtime, planning };
}

class QueueRuntime implements CrawlPlanningRuntime {
  private readonly outputs: CrawlPlanningRuntimeOutput[] = [];
  private shouldInterrupt = false;

  push(output: CrawlPlanningRuntimeOutput) {
    this.outputs.push(output);
  }

  interruptNext() {
    this.shouldInterrupt = true;
  }

  async *run(): AsyncIterable<CrawlPlanningRuntimeEvent> {
    if (this.shouldInterrupt) {
      this.shouldInterrupt = false;
      yield { type: "interrupted" };
      return;
    }
    const output = this.outputs.shift();
    if (!output) throw new Error("测试没有准备规划输出");
    yield { type: "activity", activity: {
      id: "search", kind: "web_search", label: "搜索网页", status: "completed",
      urls: ["https://www.jd.com/"],
    } };
    yield { type: "text_delta", delta: "已核实京东与标准来源。" };
    yield { type: "completed", output };
  }
}

function validOutput(reviewCount: number): CrawlPlanningRuntimeOutput {
  return {
    assistantText: "计划覆盖商品、能效和评价原始数据。",
    planCandidate: {
      summary: "冰箱多来源抓取计划",
      sources: [source("jd", "京东", "https://www.jd.com/", [
        target("products", "品牌与型号", 100),
        target("reviews", "评价样本", reviewCount),
      ]), source("energy", "中国能效标识网", "https://www.energylabel.com.cn/", [
        target("energy_records", "能效与容量", 100),
      ])],
      excludedContent: ["用户账户信息"],
    },
  };
}

function source(key: string, name: string, entryUrl: string, targets: ReturnType<typeof target>[]) {
  return {
    key, name, publisher: name, sourceKind: key === "jd" ? "retailer" as const : "regulator" as const,
    role: "提供任务所需原始数据", entryUrls: [entryUrl], observationLevel: "search_discovered" as const,
    provider: { key: key === "jd" ? "jd.catalog-product" : "missing.provider", version: "1.0.0", configuration: [{ key: "mode", value: "cdp" }] },
    accessPolicy: { kind: "paced_http" as const, version: "jd-low-frequency-v1", maxRequestsPerMinute: 2, minimumIntervalMs: 10_000, maximumRunMs: 180_000 },
    stopPolicy: { requestBudget: 2, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true as const },
    rawOutputPolicy: { formats: ["html" as const], retainAssets: false },
    accessState: "unknown" as const, observedAt: "2026-08-19T00:00:00.000Z", targets,
    executionBlockers: [],
  };
}

function target(key: string, topic: string, count: number) {
  return {
    key, name: topic, taskTopics: [topic], captureUnit: "来源记录", rawFormats: ["HTML"],
    quantity: { mode: "sample" as const, targetCount: count, unit: "条", denominator: `${topic}可见总体`, rationale: "首批原始数据" },
    uniqueKey: "来源对象 ID", traversal: "按来源默认顺序", stopCondition: `达到 ${count} 条或来源结束`,
  };
}

function taskContent(): CaptureTaskContent {
  return {
    originalRequest: "抓冰箱", category: { code: "refrigerator", label: "冰箱" },
    marketScope: "中国大陆家用冰箱", generalTopics: ["品牌与型号", "评价样本"],
    categoryTopics: ["能效与容量"],
    jd: { applicable: true, disposition: "included", scope: ["product_details"], rationale: "家电核心平台来源" },
    sourceCandidates: [], excludedContent: [], unresolvedItems: [], decisionIds: [],
  };
}

async function collect(events: ReturnType<CrawlPlanningModule["run"]>) {
  const collected = [];
  for await (const event of events) collected.push(event);
  return collected;
}
