import { randomUUID } from "node:crypto";
import { rm, mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import {
  captureTasks,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  sourceAccessGateStates,
  sourceAssets,
  sourceCollectionBatches,
  sourceCollectionPlans,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceObjects,
  sourceResourceReferences,
  sourceSnapshots,
  type WorkbenchDb,
} from "@domain-analysis/db";
import type { CrawlPlan, CrawlPlanSource, SourceRequestAdmissionPort } from "@domain-analysis/shared";
import { createSourceDatasetModule, createSourceExecutionModule,
  type CrawlPlanningModule } from "@domain-analysis/workbench";
import { createJdCatalogProvider, type PacedSessionHttpAccess,
  type SessionHttpResult } from "@domain-analysis/worker";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("JD v2 目录持久化与详情受限纵切片", () => {
  let db: WorkbenchDb | undefined;
  let taskId: string | undefined;
  let gateKey: string | undefined;
  let storageDirectory: string | undefined;
  let imageServer: Awaited<ReturnType<typeof openImageServer>> | undefined;

  afterEach(async () => {
    if (db && taskId) await clearTask(db, taskId);
    if (db && gateKey) await db.delete(sourceAccessGateStates).where(eq(sourceAccessGateStates.key, gateKey));
    await db?.$client.end();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
    await imageServer?.close();
  });

  it("两页目录图片 URL 入库，首个详情骨架后失败关闭且图片服务器零请求", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-jd-vertical-${randomUUID()}`;
    gateKey = `jd.catalog-product@2.0.0:fixture-${taskId}`;
    storageDirectory = await mkdtemp(path.join(tmpdir(), "domain-analysis-jd-vertical-"));
    imageServer = await openImageServer();
    const source = jdSource();
    const plan = jdPlan(taskId, source);
    await insertPlanFacts(db, plan);
    let clock = Date.parse("2026-08-21T00:00:00.000Z");
    const datasets = createSourceDatasetModule(db, {
      now: () => { const value = new Date(clock); clock += 61_000; return value; },
      assetStore: { async put() { throw new Error("JD 图片 URL 不应进入 Asset Store"); },
        open() { return Readable.from([]); } },
    });
    const provider = createJdCatalogProvider({ storageDirectory,
      openHttpAccess: ({ runId, admission }) => fixtureHttp(runId, admission, gateKey!, imageServer!.origin) });
    const planning = { get: async () => ({ taskId: plan.taskId, taskRevision: plan.taskRevision,
      runs: [], plans: [plan] }), requireExecutablePlan: async () => plan } as unknown as CrawlPlanningModule;
    const execution = createSourceExecutionModule(planning, datasets, new Map([[provider.key, provider]]));

    const events = [];
    for await (const event of execution.start({ taskId: plan.taskId, planId: plan.id,
      expectedTaskRevision: 1, expectedPlanVersion: 2 })) events.push(event);

    const started = events.find((event) => event.type === "run.started");
    if (!started || !("run" in started)) throw new Error("未创建 JD Source Run");
    const runId = started.run.id;
    const view = await datasets.getRun(runId);
    const taskView = await datasets.listTask(plan.taskId);
    const failedRun = events.find((event) => event.type === "run.failed");
    expect(failedRun).toMatchObject({ type: "run.failed",
      run: { terminationReason: expect.stringContaining("客户端骨架") } });
    expect(events).not.toContainEqual(expect.objectContaining({ type: "run.completed" }));
    expect(events.at(-1)).toMatchObject({ type: "batch.failed" });
    expect(taskView.batches).toEqual([expect.objectContaining({ status: "failed",
      sourceCollectionPlanVersion: 2, plannedSourceCount: 1 })]);
    expect(taskView.runs).toEqual([expect.objectContaining({ id: runId,
      executionBatchId: taskView.batches[0]!.id, status: "failed", snapshotCount: 2 })]);
    expect(view?.records).toHaveLength(2);
    expect(view?.workItems).toHaveLength(5);
    expect(view?.workItems.filter((item) => item.status === "completed")).toHaveLength(2);
    expect(view?.workItems.filter((item) => item.status === "failed")).toHaveLength(1);
    expect(view?.requestAttempts).toHaveLength(3);
    expect(view?.requestAttempts.every((attempt) => attempt.state === "completed")).toBe(true);
    expect(view?.records.flatMap((record) => record.resourceReferences)).toHaveLength(8);
    expect(view?.records.flatMap((record) => record.resourceReferences)
      .filter((reference) => reference.sourceUrl === `${imageServer!.origin}/common.webp`)).toHaveLength(4);
    expect(view?.targets.every((target) => target.status === "failed")).toBe(true);
    expect(imageServer.requestCount).toBe(0);
  });
});

function fixtureHttp(runId: string, admission: SourceRequestAdmissionPort, gateKey: string,
  imageOrigin: string): PacedSessionHttpAccess {
  return { async get(url, work) {
    const admitted = await admission.reserveRequest({ runId, ...work, gateKey,
      providerKey: "jd.catalog-product", providerVersion: "2.0.0",
      policyVersion: "jd-explicit-http-v2", requestedUrl: url,
      minimumIntervalMs: 60_000, maxRequestsPerMinute: 1 });
    if (admitted.status !== "admitted") throw new Error(`fixture 请求未获准：${admitted.status}`);
    const result = response(url, fixtureBody(new URL(url), imageOrigin));
    await admission.finishRequest({ attemptId: admitted.attempt.id, state: "completed",
      finalUrl: url, httpStatus: 200, bytes: result.body.byteLength });
    return result;
  }, cancel() {}, async onIdle() {}, get state() { return "idle" as const; } };
}

function fixtureBody(url: URL, imageOrigin: string) {
  if (url.hostname === "www.jd.com") {
    const products = url.pathname.endsWith("1") ? ["1001", "1002"] : ["1002", "1003"];
    return `<div id="J_goodsList"><ul>${products.map((sku) => `<li class="gl-item" data-sku="${sku}">
      <div class="p-img"><a href="https://item.jd.com/${sku}.html"><img src="${imageOrigin}/common.webp"></a></div>
      <div class="p-scroll"><img data-lazy-img="${imageOrigin}/${sku}.webp"></div>
    </li>`).join("")}</ul></div>`;
  }
  if (url.hostname === "item.jd.com") return `<div class="skeleton-screen"></div><div id="root"></div>`;
  throw new Error(`fixture 缺少响应：${url.href}`);
}

function response(url: string, body: string): SessionHttpResult {
  return { finalUrl: url, status: 200, headers: { "content-type": body.startsWith("{")
    ? "application/json" : "text/html" }, body: Buffer.from(body), requests: [] };
}

function jdPlan(taskId: string, source: CrawlPlanSource): CrawlPlan {
  return { id: `plan-${taskId}`, taskId, taskRevision: 1, version: 2, status: "confirmed",
    contentHash: "3".repeat(64), content: { taskId, taskRevision: 1, executionChecklistVersion: 2,
      summary: "本地 JD fixture", sources: [source] },
    createdAt: "2026-08-21T00:00:00.000Z", confirmedAt: "2026-08-21T00:00:00.000Z" } as CrawlPlan;
}

function jdSource(): CrawlPlanSource {
  return { key: "jd.refrigerator", name: "京东冰箱", publisher: "京东", sourceKind: "retailer",
    sourceCandidateIds: ["candidate-jd"], role: "目录、详情、图片 URL 与评价",
    entryUrls: ["https://www.jd.com/catalog-1", "https://www.jd.com/catalog-2"],
    provider: { key: "jd.catalog-product", version: "2.0.0", configuration: [
      { key: "mode", value: "explicit_http" }, { key: "include_text", value: "冰箱" },
      { key: "exclude_text", value: "二手|冷柜|冰吧" }] },
    accessPolicy: { kind: "paced_http", version: "jd-explicit-http-v2",
      maxRequestsPerMinute: 1, minimumIntervalMs: 60_000, maximumRunMs: 3_600_000 },
    stopPolicy: { requestBudget: 12, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
    rawOutputPolicy: { formats: ["html", "source_json"], retainAssets: false },
    observationLevel: "search_discovered", accessState: "unknown",
    observedAt: "2026-08-21T00:00:00.000Z", targets: targets(), executionBlockers: [] };
}

function targets(): CrawlPlanSource["targets"] {
  const target = (key: string, operation: string, rawFormats: Array<"html" | "source_json">) => ({
    key, name: key, taskTopics: ["品牌与型号"], captureUnit: key, rawFormats,
    quantity: { mode: "all_available" as const, unit: "个", denominator: "动态工作项",
      rationale: "逐对象严格对账" }, uniqueKey: "稳定 work key", traversal: "前序响应发现",
    stopCondition: "全部完成或首次受限", providerConfiguration: [{ key: "operation", value: operation }],
  });
  return [target("catalog-pages", "catalog_pages", ["html"]),
    target("store-catalogs", "store_catalogs", ["html"]),
    target("product-details", "product_details", ["html", "source_json"]),
    target("review-summaries", "review_summaries", ["source_json"]),
    { ...target("review-samples", "review_samples", ["source_json"]), providerConfiguration: [
      { key: "operation", value: "review_samples" }, { key: "samples_per_product", value: 50 }] }];
}

async function insertPlanFacts(db: WorkbenchDb, plan: CrawlPlan) {
  await db.insert(captureTasks).values({ id: plan.taskId, name: "JD fixture", originalRequest: "本地纵切片",
    marketScope: "本地 fixture", status: "ready", revision: 1, createdAt: plan.createdAt,
    updatedAt: plan.createdAt, confirmedAt: plan.createdAt });
  await db.insert(sourceCollectionPlans).values({ id: plan.id, taskId: plan.taskId, taskRevision: 1,
    version: plan.version, status: "confirmed", contentHash: plan.contentHash,
    confirmedAt: plan.confirmedAt, content: plan.content });
}

async function openImageServer() {
  let requestCount = 0;
  const server = createServer((_request, response) => { requestCount += 1; response.writeHead(200).end("image"); });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("图片 fixture 未监听");
  return { origin: `http://127.0.0.1:${address.port}`, get requestCount() { return requestCount; },
    close: () => close(server) };
}

function listen(server: Server) {
  return new Promise<void>((resolve, reject) => { server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve); });
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function clearTask(db: WorkbenchDb, taskId: string) {
  const runs = await db.select({ id: sourceCollectionRuns.id }).from(sourceCollectionRuns)
    .where(eq(sourceCollectionRuns.taskId, taskId));
  for (const run of runs) {
    const snapshots = await db.select({ id: sourceSnapshots.id }).from(sourceSnapshots)
      .where(eq(sourceSnapshots.runId, run.id));
    if (snapshots.length > 0) {
      const ids = snapshots.map((item) => item.id);
      await db.delete(sourceResourceReferences).where(inArray(sourceResourceReferences.snapshotId, ids));
      await db.delete(sourceAssets).where(inArray(sourceAssets.snapshotId, ids));
    }
    await db.delete(sourceSnapshots).where(eq(sourceSnapshots.runId, run.id));
    await db.delete(sourceCollectionTargetRuns).where(eq(sourceCollectionTargetRuns.runId, run.id));
  }
  await db.delete(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId));
  await db.delete(sourceCollectionBatches).where(eq(sourceCollectionBatches.taskId, taskId));
  await db.delete(sourceObjects).where(eq(sourceObjects.taskId, taskId));
  await db.delete(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, taskId));
  await db.delete(captureTasks).where(eq(captureTasks.id, taskId));
}
