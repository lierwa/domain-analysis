import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import type { CrawlPlanningRuntimeOutput } from "@domain-analysis/shared";
import {
  captureTasks,
  crawlPlanningRuns,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  sourceCollectionBatches,
  sourceCollectionPlans,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceAssets,
  sourceSnapshots,
  sourceObjects,
  type WorkbenchDb,
} from "@domain-analysis/db";
import { eq, inArray } from "drizzle-orm";
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
import { target, taskContent, validOutput } from "./crawlPlanningIntegrationTestSupport";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("抓取计划版本与确认", () => {
  let db: WorkbenchDb | undefined;
  let taskId: string | undefined;

  afterEach(async () => {
    if (db && taskId) {
      const runs = await db.select({ id: sourceCollectionRuns.id }).from(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId));
      for (const run of runs) {
        const snapshots = await db.select({ id: sourceSnapshots.id }).from(sourceSnapshots)
          .where(eq(sourceSnapshots.runId, run.id));
        if (snapshots.length > 0) {
          await db.delete(sourceAssets).where(inArray(sourceAssets.snapshotId, snapshots.map((item) => item.id)));
        }
        await db.delete(sourceSnapshots).where(eq(sourceSnapshots.runId, run.id));
        await db.delete(sourceCollectionTargetRuns).where(eq(sourceCollectionTargetRuns.runId, run.id));
      }
      await db.delete(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId));
      await db.delete(sourceCollectionBatches).where(eq(sourceCollectionBatches.taskId, taskId));
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
      taskId, expectedTaskRevision: 1, instruction: "将计划说明修订为第二版",
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

  it("历史计划来源只读保留，但未在本轮核实且非当前候选时不复制到新计划", async () => {
    const opened = await openModules();
    db = opened.db;
    taskId = opened.task.id;
    const first = validOutput(1);
    const extra = structuredClone(first.planCandidate.sources.find((source) => source.key === "technical")!);
    extra.key = "extra-technical";
    extra.name = "已发现补充技术来源";
    extra.sourceCandidateIds = [];
    extra.entryUrls = ["https://extra.example.com/principles"];
    extra.targets[0]!.key = "extra-principles";
    extra.targets[0]!.providerConfiguration = [
      { key: "route", value: "exact" }, { key: "url", value: extra.entryUrls[0]! },
    ];
    first.planCandidate.sources.push(extra);
    opened.runtime.push(first);
    await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    opened.runtime.push(validOutput(2));
    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    expect(events).toContainEqual(expect.objectContaining({ type: "run.completed" }));
    const view = (await opened.planning.get(taskId))!;
    expect(view.plans).toHaveLength(2);
    expect(view.plans[0]!.content.sources.some((source) => source.key === "extra-technical")).toBe(false);
    expect(view.plans[1]!.content.sources.some((source) => source.key === "extra-technical")).toBe(true);
  });

  it("任务 topic 缺失时失败关闭且不保存计划", async () => {
    const opened = await openModules();
    db = opened.db;
    taskId = opened.task.id;
    const output = validOutput(40);
    output.planCandidate.sources.find((source) => source.key === "technical")!
      .targets[0]!.taskTopics = ["配置参数"];
    opened.runtime.push(output);

    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));
    const view = (await opened.planning.get(taskId))!;

    expect(events).toContainEqual(expect.objectContaining({ type: "run.failed" }));
    expect(view.plans).toHaveLength(0);
    expect(view.runs[0]).toMatchObject({ status: "failed" });
  });

  it("草稿保存和确认只执行 Provider 结构校验，不依赖运行态预检", async () => {
    const phases: string[] = [];
    const opened = await openModules(taskContent(), {
      validateSource: (source) => { phases.push(`validate:${source.key}`); },
    });
    db = opened.db;
    taskId = opened.task.id;
    opened.runtime.push(validOutput(1));

    await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));
    let view = (await opened.planning.get(taskId))!;
    expect(phases).toEqual([
      "validate:brand", "validate:brand-secondary", "validate:standard", "validate:technical",
    ]);

    await opened.planning.confirm({ taskId, planId: view.plans[0]!.id, expectedTaskRevision: 1 });
    expect(phases.slice(4)).toEqual([
      "validate:brand", "validate:brand-secondary", "validate:standard", "validate:technical",
    ]);
  });

  it("Provider 结构校验失败时不保存不可执行草稿", async () => {
    const opened = await openModules(taskContent(), {
      validateSource: (source) => {
        if (source.key === "brand") throw new Error("target URL 不在来源入口清单中");
      },
    });
    db = opened.db;
    taskId = opened.task.id;
    opened.runtime.push(validOutput(1));

    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    expect(events).toContainEqual(expect.objectContaining({ type: "run.failed",
      error: expect.stringContaining("来源执行校验失败") }));
    expect((await opened.planning.get(taskId))!.plans).toHaveLength(0);
  });

  it("任务候选只有品牌官网时，规划阶段可以深搜补齐标准与技术来源", async () => {
    const content = taskContent();
    content.jd = { applicable: false, disposition: "excluded", scope: [], rationale: "旧采访误判为不适用" };
    content.sourceCandidates = content.sourceCandidates.filter((item) => item.sourceKind === "brand_official");
    const opened = await openModules(content);
    db = opened.db;
    taskId = opened.task.id;
    const output = validOutput(1);
    output.planCandidate.sources.filter((source) => source.sourceKind !== "brand_official")
      .forEach((source) => { source.sourceCandidateIds = []; });
    opened.runtime.push(output);

    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    expect(events).toContainEqual(expect.objectContaining({ type: "run.completed" }));
    expect((await opened.planning.get(taskId))!.plans).toHaveLength(1);
  });

  it("即使 topic 文字被挂到其他来源，遗漏采访来源候选仍失败关闭", async () => {
    const opened = await openModules();
    db = opened.db;
    taskId = opened.task.id;
    const output = validOutput(1);
    const technical = output.planCandidate.sources.find((item) => item.key === "technical")!;
    output.planCandidate.sources = output.planCandidate.sources.filter((item) => item.key !== "technical");
    output.planCandidate.sources[0]!.targets[0]!.taskTopics.push(...technical.targets[0]!.taskTopics);
    opened.runtime.push(output);

    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    expect(events).toContainEqual(expect.objectContaining({ type: "run.failed" }));
    expect((await opened.planning.get(taskId))!.plans).toHaveLength(0);
  });

  it("采访已确认说明书或附件时，只有入口 HTML 的计划失败关闭", async () => {
    const content = taskContent();
    const brand = content.sourceCandidates.find((item) => item.id === "candidate-brand")!;
    brand.expectedContents = ["型号参数", "说明书"];
    brand.observedFormats = ["HTML", "H5"];
    const opened = await openModules(content);
    db = opened.db;
    taskId = opened.task.id;
    opened.runtime.push(validOutput(1));

    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    expect(events).toContainEqual(expect.objectContaining({ type: "run.failed",
      error: expect.stringContaining("不能只抓入口 HTML") }));
    expect((await opened.planning.get(taskId))!.plans).toHaveLength(0);
  });

  it("version 4 拒绝旧链接文字协议，H5 发现必须由 site route 冻结", async () => {
    const content = taskContent();
    const brandCandidate = content.sourceCandidates.find((item) => item.id === "candidate-brand")!;
    brandCandidate.expectedContents = ["型号参数", "说明书"];
    brandCandidate.observedFormats = ["HTML", "H5"];
    const opened = await openModules(content);
    db = opened.db;
    taskId = opened.task.id;
    const output = validOutput(1);
    const brandSource = output.planCandidate.sources.find((item) => item.key === "brand")!;
    brandSource.stopPolicy.requestBudget = 3;
    brandSource.targets.push({
      ...brandSource.targets[0]!, key: "official_manual", name: "品牌官方说明书 H5",
      providerConfiguration: [
        { key: "from_target", value: "official_parameters" },
        { key: "link_text", value: "查看说明书" },
      ] as never,
    } as never);
    opened.runtime.push(output);

    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    expect(events).toContainEqual(expect.objectContaining({ type: "run.failed" }));
    expect((await opened.planning.get(taskId))!.plans).toHaveLength(0);
  });

  it("version 4 正式计划出现任何京东 URL 时失败关闭", async () => {
    const content = taskContent();
    const entryUrl = "https://search.jd.com/Search?keyword=%E5%86%B0%E7%AE%B1";
    const opened = await openModules(content);
    db = opened.db;
    taskId = opened.task.id;
    const output = validOutput(1);
    const brand = output.planCandidate.sources[0]!;
    brand.entryUrls = [entryUrl];
    brand.targets = [{
      ...target("jd-search", "品牌与型号"), taskTopics: ["品牌与型号", "配置参数"],
      providerConfiguration: [{ key: "route", value: "exact" }, { key: "url", value: entryUrl }],
    }];
    opened.runtime.push(output);

    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "run.failed",
      error: expect.stringContaining("当前正式计划不执行京东来源"),
    }));
    expect((await opened.planning.get(taskId))!.plans).toHaveLength(0);
  });

  it("历史 version 2 已确认计划在执行前拒绝", async () => {
    const opened = await openModules();
    db = opened.db;
    taskId = opened.task.id;
    const output = validOutput(1);
    const oldContent = { ...output.planCandidate, executionChecklistVersion: 2 as const,
      researchAudit: undefined, taskId, taskRevision: 1 };
    const planningRunId = `crawl-planning-run-old-${randomUUID()}`;
    await db.insert(crawlPlanningRuns).values({ id: planningRunId, taskId, taskRevision: 1,
      status: "completed", timelineParts: [], startedAt: "2026-08-20T00:00:00.000Z",
      finishedAt: "2026-08-20T00:00:01.000Z" });
    await db.insert(sourceCollectionPlans).values({ id: "plan-old-v2", taskId,
      taskRevision: 1, planningRunId, version: 1, status: "confirmed", contentHash: "9".repeat(64),
      content: oldContent, createdAt: "2026-08-20T00:00:01.000Z", confirmedAt: "2026-08-20T00:00:02.000Z" });

    await expect(opened.planning.requireExecutablePlan({ taskId, planId: "plan-old-v2",
      expectedTaskRevision: 1, expectedPlanVersion: 1 }))
      .rejects.toThrow("缺少当前多路径与内容验收契约");
  });

  it("品牌发现不足四个独立来源时失败关闭", async () => {
    const opened = await openModules();
    db = opened.db;
    taskId = opened.task.id;
    const output = validOutput(1);
    output.planCandidate.researchAudit.passes
      .filter((pass) => pass.area === "brand_landscape")
      .forEach((pass, index) => { pass.evidenceUrls = [`https://industry.example.com/brands/${index}`]; });
    opened.runtime.push(output);

    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    expect(events).toContainEqual(expect.objectContaining({ type: "run.failed",
      error: expect.stringContaining("至少需要四个独立公开来源") }));
    expect((await opened.planning.get(taskId))!.plans).toHaveLength(0);
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
    opened.runtime.push(validOutput(1));
    await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));
    let view = (await opened.planning.get(taskId))!;
    view = await opened.planning.confirm({ taskId, planId: view.plans[0]!.id, expectedTaskRevision: 1 });
    const collectProvider = async function* (source: typeof view.plans[0]["content"]["sources"][number]) {
        for (const target of source.targets) {
          const text = `real-seam:${source.key}:${target.key}`;
          const payloadHash = createHash("sha256").update(text).digest("hex");
          const isAsset = source.key === "standard";
          yield { type: "capture" as const, targetKey: target.key, snapshot: {
            idempotencyKey: `${source.key}-${target.key}`, object: { sourceIdentity: source.key, kind: "catalog", externalKey: target.key },
            observation: { requestedUrl: source.entryUrls[0]!, observedAt: "2026-08-20T00:00:00.000Z", state: "accessible" as const, responseHeaders: {} },
            payload: isAsset ? { kind: "asset" as const, assetKey: "raw", filename: "standard.pdf",
              mediaType: "application/pdf", bytes: Buffer.byteLength(text), contentHash: payloadHash }
              : { kind: "inline_text" as const, mediaType: "text/plain", text,
                bytes: Buffer.byteLength(text), contentHash: payloadHash },
          }, resourceReferences: [], ...(isAsset ? { assets: [{ assetKey: "raw", filename: "standard.pdf",
            sourceUrl: source.entryUrls[0]!, mediaType: "application/pdf", contentHash: payloadHash,
            content: new TextEncoder().encode(text) }] } : { assets: [] }) };
          yield { type: "target.completed" as const, targetKey: target.key };
        }
    };
    const providers = new Map([["public.web-resource", {
      key: "public.web-resource", version: "2.0.0", validate() {}, async preflight() {}, collect: collectProvider,
    }]]);
    const stored = new Map<string, Uint8Array>();
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put(input) { const integrity = `sha256-${input.contentHash}`; stored.set(integrity, input.content); return integrity; },
      open(integrity) { return Readable.from([stored.get(integrity)!]); },
    } });
    const execution = createSourceExecutionModule(opened.planning, datasets, providers);
    const events = [];
    for await (const event of execution.start({ taskId, planId: view.plans[0]!.id, expectedTaskRevision: 1, expectedPlanVersion: 1 })) events.push(event);
    expect(events.filter((event) => event.type === "run.completed")).toHaveLength(4);
    const runs = await db.select().from(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId));
    // WHY：数据库未承诺无 ORDER BY 查询的行序；按来源身份对账，保护真实执行结果而非偶然插入顺序。
    expect(Object.fromEntries(runs.map((run) => [run.sourceCollectionPlanSourceKey,
      [run.status, run.snapshotCount]]))).toEqual({
      brand: ["completed", 1], "brand-secondary": ["completed", 1],
      standard: ["completed", 1], technical: ["completed", 1],
    });
    const standardRun = runs.find((run) => run.sourceCollectionPlanSourceKey === "standard")!;
    const standardView = (await datasets.getRun(standardRun.id))!;
    expect(standardView).toMatchObject({ run: { assetCount: 1 },
      targets: [{ targetKey: "standard_document", status: "completed", assetCount: 1 }] });
    const openedAsset = await datasets.openAsset({ runId: standardRun.id,
      assetId: standardView.records[0]!.assets[0]!.id });
    const chunks = [];
    for await (const chunk of openedAsset.content) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("real-seam:standard:standard_document");
  });
});

async function openModules(
  content = taskContent(),
  moduleOptions: Parameters<typeof createCrawlPlanningModule>[3] = {},
) {
  await migrateWorkbenchDatabase(databaseUrl!);
  const db = createWorkbenchDb(databaseUrl!);
  const task = buildConfirmedCaptureTask(content, new Date().toISOString(), `task-${randomUUID()}`);
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
    ...moduleOptions,
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
      urls: ["https://industry.example.com/refrigerator-brands"],
    } };
    yield { type: "text_delta", delta: "已核实品牌官网与标准来源。" };
    yield { type: "completed", output };
  }
}

async function collect(events: ReturnType<CrawlPlanningModule["run"]>) {
  const collected = [];
  for await (const event of events) collected.push(event);
  return collected;
}
