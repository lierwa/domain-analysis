import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import {
  crawlPlanningRuntimeOutputSchema,
  type CaptureTaskContent,
  type CrawlPlanningRuntimeOutput,
} from "@domain-analysis/shared";
import {
  captureTasks,
  crawlPlanningRuns,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
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
      "validate:jd", "validate:brand", "validate:brand-secondary", "validate:standard", "validate:technical",
    ]);

    await opened.planning.confirm({ taskId, planId: view.plans[0]!.id, expectedTaskRevision: 1 });
    expect(phases.slice(5)).toEqual([
      "validate:jd", "validate:brand", "validate:brand-secondary", "validate:standard", "validate:technical",
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

  it("任务只有品牌官网时，即使模型返回计划也因专业来源组合不完整而失败关闭", async () => {
    const content = taskContent();
    content.jd = { applicable: false, disposition: "excluded", scope: [], rationale: "旧采访误判为不适用" };
    content.sourceCandidates = content.sourceCandidates.filter((item) => item.sourceKind === "brand_official");
    const opened = await openModules(content);
    db = opened.db;
    taskId = opened.task.id;
    opened.runtime.push(validOutput(1));

    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "run.failed",
      error: expect.stringContaining("核心零售/市场平台、国家标准或监管来源、权威技术原理来源"),
    }));
    expect((await opened.planning.get(taskId))!.plans).toHaveLength(0);
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

  it("品牌说明书为 H5 时，单列一次同源跟进 target 即可形成可执行清单", async () => {
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

    expect(events).toContainEqual(expect.objectContaining({ type: "run.completed" }));
    expect((await opened.planning.get(taskId))!.plans).toHaveLength(1);
  });

  it("京东搜索入口作为真实 target 时不再被强制要求使用 JD catalog Provider", async () => {
    const content = taskContent();
    const entryUrl = "https://search.jd.com/Search?keyword=%E5%86%B0%E7%AE%B1";
    content.sourceCandidates[0] = candidate("candidate-jd", "京东搜索", entryUrl, "retailer");
    const opened = await openModules(content);
    db = opened.db;
    taskId = opened.task.id;
    const output = validOutput(1);
    const jd = output.planCandidate.sources[0]!;
    jd.entryUrls = [entryUrl];
    jd.provider = { key: "public.web-resource", version: "1.0.0", configuration: [
      { key: "mode", value: "exact_https" }, { key: "maximum_bytes", value: 5_000_000 },
    ] };
    jd.targets = [{
      ...target("jd-search", "品牌与型号"), taskTopics: ["品牌与型号", "配置参数"],
      providerConfiguration: [{ key: "url", value: entryUrl }],
    }];
    opened.runtime.push(output);

    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    expect(events).toContainEqual(expect.objectContaining({ type: "run.completed" }));
    expect((await opened.planning.get(taskId))!.plans).toHaveLength(1);
  });

  it("拒绝把多个京东候选入口合并成一个只访问首个 URL 的来源", async () => {
    const content = taskContent();
    content.sourceCandidates.push(candidate(
      "candidate-jd-brand", "京东品牌旗舰店", "https://mall.jd.com/index-1000001719.html", "retailer",
    ));
    const opened = await openModules(content);
    db = opened.db;
    taskId = opened.task.id;
    const output = validOutput(1);
    output.planCandidate.sources[0]!.sourceCandidateIds.push("candidate-jd-brand");
    output.planCandidate.sources[0]!.entryUrls.push("https://mall.jd.com/index-1000001719.html");
    opened.runtime.push(output);

    const events = await collect(opened.planning.run({ taskId, expectedTaskRevision: 1 }));

    expect(events).toContainEqual(expect.objectContaining({ type: "run.failed" }));
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
    const provider = {
      key: "jd.catalog-product", version: "1.0.0", validate() {}, async preflight() {},
      async *collect(source: typeof view.plans[0]["content"]["sources"][number]) {
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
          }, ...(isAsset ? { assets: [{ assetKey: "raw", filename: "standard.pdf",
            sourceUrl: source.entryUrls[0]!, mediaType: "application/pdf", contentHash: payloadHash,
            content: new TextEncoder().encode(text) }] } : { assets: [] }) };
          yield { type: "target.completed" as const, targetKey: target.key };
        }
      },
    };
    const providers = new Map([["jd.catalog-product", provider], ["public.web-resource", { ...provider, key: "public.web-resource" }]]);
    const stored = new Map<string, Uint8Array>();
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put(input) { const integrity = `sha256-${input.contentHash}`; stored.set(integrity, input.content); return integrity; },
      open(integrity) { return Readable.from([stored.get(integrity)!]); },
    } });
    const execution = createSourceExecutionModule(opened.planning, datasets, providers);
    const events = [];
    for await (const event of execution.start({ taskId, planId: view.plans[0]!.id, expectedTaskRevision: 1, expectedPlanVersion: 1 })) events.push(event);
    expect(events.filter((event) => event.type === "run.completed")).toHaveLength(5);
    const runs = await db.select().from(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId));
    // WHY：数据库未承诺无 ORDER BY 查询的行序；按来源身份对账，保护真实执行结果而非偶然插入顺序。
    expect(Object.fromEntries(runs.map((run) => [run.sourceCollectionPlanSourceKey,
      [run.status, run.snapshotCount]]))).toEqual({
      jd: ["completed", 2], brand: ["completed", 1],
      "brand-secondary": ["completed", 1],
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
      urls: ["https://www.jd.com/"],
    } };
    yield { type: "text_delta", delta: "已核实京东与标准来源。" };
    yield { type: "completed", output };
  }
}

function validOutput(variant: number): CrawlPlanningRuntimeOutput {
  return crawlPlanningRuntimeOutputSchema.parse({
    assistantText: "计划覆盖平台、品牌官网、国家标准和底层原理原始数据。",
    planCandidate: {
      executionChecklistVersion: 2,
      summary: `冰箱多来源抓取计划 ${variant}`,
      sources: [source("jd", "candidate-jd", "京东", "https://www.jd.com/", [
        target("catalog", "品牌与型号", "catalog"),
        target("detail", "配置参数", "first_matching_product"),
      ]), source("brand", "candidate-brand", "品牌官网", "https://example.com/products", [
        target("official_parameters", "配置参数"),
      ]), source("brand-secondary", "candidate-brand-secondary", "第二品牌官网", "https://second-brand.example.com/products", [
        target("official_parameters_secondary", "配置参数"),
      ]), source("standard", "candidate-standard", "国家标准全文公开系统", "https://example.com/standard.pdf", [
        target("standard_document", "国家标准"),
      ]), source("technical", "candidate-technical", "权威技术资料", "https://example.com/principles", [
        target("principles", "底层原理"),
      ])],
      excludedContent: ["用户账户信息"],
    },
  });
}

function source(key: string, candidateId: string, name: string, entryUrl: string, targets: ReturnType<typeof target>[]) {
  const jd = key === "jd";
  const brand = key.startsWith("brand");
  return {
    key, name, publisher: name, sourceKind: jd ? "retailer" as const : brand ? "brand_official" as const
      : key === "standard" ? "standards_body" as const : "technical_publisher" as const,
    sourceCandidateIds: [candidateId],
    role: "提供任务所需原始数据", entryUrls: [entryUrl], observationLevel: "search_discovered" as const,
    provider: { key: jd ? "jd.catalog-product" : "public.web-resource", version: "1.0.0", configuration: jd
      ? [{ key: "mode", value: "cdp" }, { key: "include_text", value: "冰箱" },
        { key: "exclude_text", value: "二手|冷柜|酒柜" }]
      : [{ key: "mode", value: "exact_https" }, { key: "maximum_bytes", value: 5_000_000 }] },
    accessPolicy: { kind: "paced_http" as const, version: "jd-low-frequency-v1", maxRequestsPerMinute: 2, minimumIntervalMs: 10_000, maximumRunMs: 180_000 },
    stopPolicy: { requestBudget: 2, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true as const },
    rawOutputPolicy: { formats: [entryUrl.endsWith(".pdf") ? "document" as const : "html" as const],
      retainAssets: entryUrl.endsWith(".pdf") },
    accessState: "unknown" as const, observedAt: "2026-08-19T00:00:00.000Z",
    targets: jd ? targets : targets.map((target) => ({ ...target,
      rawFormats: entryUrl.endsWith(".pdf") ? ["document" as const] : target.rawFormats,
      providerConfiguration: [{ key: "url", value: entryUrl }] })),
    executionBlockers: [],
  };
}

function target(key: string, topic: string, operation = "exact_resource") {
  return {
    key, name: topic, taskTopics: [topic], captureUnit: "来源记录", rawFormats: ["html"],
    providerConfiguration: [{ key: "operation", value: operation }],
    quantity: { mode: "target_count" as const, targetCount: 1, unit: "份",
      denominator: "计划冻结抓取项", rationale: "每项一份原始响应" },
    uniqueKey: "来源 URL", traversal: "按 Provider 配置执行", stopCondition: "保存 1 份响应或遇访问限制",
  };
}

function taskContent(): CaptureTaskContent {
  return {
    originalRequest: "抓冰箱", category: { code: "refrigerator", label: "冰箱" },
    marketScope: "中国大陆家用冰箱", generalTopics: ["品牌与型号", "底层原理"],
    categoryTopics: ["配置参数", "国家标准"],
    jd: { applicable: true, disposition: "included", scope: ["product_details"], rationale: "家电核心平台来源" },
    sourceCandidates: [
      candidate("candidate-jd", "京东", "https://www.jd.com/", "retailer"),
      candidate("candidate-brand", "品牌官网", "https://example.com/products", "brand_official"),
      candidate("candidate-brand-secondary", "第二品牌官网", "https://second-brand.example.com/products", "brand_official"),
      candidate("candidate-standard", "国家标准全文公开系统", "https://example.com/standard.pdf", "standards_body"),
      candidate("candidate-technical", "权威技术资料", "https://example.com/principles", "technical_publisher"),
    ], excludedContent: [], unresolvedItems: [], decisionIds: [],
  };
}

function candidate(id: string, name: string, entryUrl: string, sourceKind: CaptureTaskContent["sourceCandidates"][number]["sourceKind"]) {
  return { id, name, publisher: name, entryUrl, sourceKind, expectedContents: ["原始资料"],
    observedFormats: [entryUrl.endsWith(".pdf") ? "PDF" : "HTML"], accessState: "unknown" as const,
    observedAt: "2026-08-19T00:00:00.000Z" };
}

async function collect(events: ReturnType<CrawlPlanningModule["run"]>) {
  const collected = [];
  for await (const event of events) collected.push(event);
  return collected;
}
