import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  captureTasks,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  sourceCollectionPlans,
  sourceCollectionBatches,
  sourceAssets,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceObjects,
  sourceSnapshots,
  type WorkbenchDb,
} from "@domain-analysis/db";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createSourceDatasetModule } from "../src";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("Source Dataset 资源引用", () => {
  let db: WorkbenchDb | undefined;
  let taskId: string | undefined;
  let child: ChildProcess | undefined;

  afterEach(async () => {
    if (child?.exitCode === null) child.kill("SIGKILL");
    if (db && taskId) await clearTask(db, taskId);
    await db?.$client.end();
    db = undefined;
    taskId = undefined;
    child = undefined;
  });

  it("公共产品页 Snapshot 原子保存 25 条图片 URL 且不生成 Asset", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-resource-reference-${randomUUID()}`;
    const at = "2026-08-21T00:00:00.000Z";
    await db.insert(captureTasks).values({ id: taskId, name: "图片 URL 测试",
      originalRequest: "抓取品牌官网产品图片 URL", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-1", taskId, taskRevision: 1,
      version: 1, status: "confirmed", contentHash: "0".repeat(64), confirmedAt: at,
      content: { taskId, taskRevision: 1, sources: [{ key: "brand", providerKey: "public.web-resource",
        entryUrl: "https://brand.example/products/model-1", expectedContents: ["产品图片 URL"],
        accessPolicy: { kind: "manual", version: "fixture" } }] } });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("URL-only 捕获不应写入 Asset Store"); },
      open() { return Readable.from([]); },
    } });
    const run = await datasets.startRun({ taskId, planId: "plan-1", planVersion: 1,
      sourceKey: "brand", providerKey: "public.web-resource", providerVersion: "1.0.0",
      requestBudget: 1,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 1, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 1, maximumRunMs: 1_000 }, targetKeys: ["product-detail"] });
    await datasets.startTarget({ runId: run.id, targetKey: "product-detail" });
    const html = "<html>product</html>";
    const view = await datasets.commitSnapshot({ runId: run.id, targetKey: "product-detail",
      idempotencyKey: "model-1", object: { sourceIdentity: "brand.example", kind: "product", externalKey: "model-1" },
      observation: { requestedUrl: "https://brand.example/products/model-1", observedAt: at,
        state: "accessible", responseHeaders: {} }, payload: { kind: "inline_text", mediaType: "text/html",
        charset: "utf-8", text: html, bytes: Buffer.byteLength(html), contentHash: hash(html) },
      assets: [], resourceReferences: references(25) });

    const record = view.records[0]!;
    expect(record.assets).toEqual([]);
    expect(record.resourceReferences).toHaveLength(25);
    expect(record.resourceReferences[24]).toMatchObject({
      sourceUrl: "https://img.example.com/24.webp", role: "detail", section: "description", ordinal: 24,
      observedValue: "//img.example.com/24.webp", locator: "#description img:nth-of-type(25)@data-src",
    });
    let jsonl = "";
    for await (const chunk of datasets.exportRun({ runId: run.id, format: "jsonl" })) jsonl += chunk;
    expect(jsonl).toContain("https://img.example.com/24.webp");
  });

  it("保存内容不合格的原文，但不把它计入 target 内容通过数", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-content-assessment-${randomUUID()}`;
    const at = "2026-08-26T00:00:00.000Z";
    await db.insert(captureTasks).values({ id: taskId, name: "内容验收计数",
      originalRequest: "抓官网目录", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-content-assessment", taskId,
      taskRevision: 1, version: 4, status: "confirmed", contentHash: "a".repeat(64), confirmedAt: at,
      content: { taskId, taskRevision: 1, sources: [{ key: "brand", providerKey: "public.web-resource",
        entryUrl: "https://brand.example/about", expectedContents: ["产品目录"],
        accessPolicy: { kind: "manual", version: "fixture" } }] } });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const run = await datasets.startRun({ taskId, planId: "plan-content-assessment", planVersion: 4,
      sourceKey: "brand", providerKey: "public.web-resource", providerVersion: "2.0.0", requestBudget: 10,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 1, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 1, maximumRunMs: 1_000 }, targetKeys: ["catalog"] });
    await datasets.startTarget({ runId: run.id, targetKey: "catalog" });
    const html = "<html>公司介绍</html>";
    await datasets.commitSnapshot({ runId: run.id, targetKey: "catalog",
      idempotencyKey: "about", object: { sourceIdentity: "brand.example", kind: "web_resource",
        externalKey: "https://brand.example/about" },
      observation: { requestedUrl: "https://brand.example/about", observedAt: at,
        state: "accessible", responseHeaders: {}, contentAssessment: { status: "rejected",
          ruleVersion: "public-content-v1", matchedSignals: ["品牌"], reason: "没有产品目录或型号" } },
      payload: { kind: "inline_text", mediaType: "text/html", charset: "utf-8", text: html,
        bytes: Buffer.byteLength(html), contentHash: hash(html) }, assets: [], resourceReferences: [] });
    const sitemap = "<urlset></urlset>";
    const view = await datasets.commitSnapshot({ runId: run.id, targetKey: "catalog",
      idempotencyKey: "sitemap", object: { sourceIdentity: "brand.example", kind: "web_resource",
        externalKey: "https://brand.example/sitemap.xml" },
      observation: { requestedUrl: "https://brand.example/sitemap.xml", observedAt: at,
        state: "accessible", responseHeaders: {}, contentAssessment: { status: "supporting",
          ruleVersion: "public-content-v1", matchedSignals: ["sitemap_raw"], reason: "只支撑 URL 分母" } },
      payload: { kind: "inline_text", mediaType: "application/xml", charset: "utf-8", text: sitemap,
        bytes: Buffer.byteLength(sitemap), contentHash: hash(sitemap) }, assets: [], resourceReferences: [] });

    expect(view.run).toMatchObject({ snapshotCount: 2, accessibleCount: 0, failedCount: 1 });
    expect(view.targets[0]).toMatchObject({ snapshotCount: 2, accessibleCount: 0, failedCount: 1 });
    expect(view.records.map((record) => record.snapshot.observation.contentAssessment?.status))
      .toEqual(["rejected", "supporting"]);
  });

  it("仍有未结束捕获工作时不得把 target 记为 completed", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-target-work-gate-${randomUUID()}`;
    const at = "2026-08-21T00:00:00.000Z";
    await db.insert(captureTasks).values({ id: taskId, name: "target 完成门测试",
      originalRequest: "本地 fixture", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-target-work-gate", taskId, taskRevision: 1,
      version: 1, status: "confirmed", contentHash: "2".repeat(64), confirmedAt: at,
      content: { taskId, taskRevision: 1, sources: [{ key: "brand", providerKey: "public.web-resource",
        entryUrl: "https://brand.example/products/model-1", expectedContents: ["产品详情"],
        accessPolicy: { kind: "manual", version: "fixture" } }] } });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const run = await datasets.startRun({ taskId, planId: "plan-target-work-gate", planVersion: 1,
      sourceKey: "brand", providerKey: "public.web-resource", providerVersion: "1.0.0", requestBudget: 1,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 60_000, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 120_000 }, targetKeys: ["product-detail"] });
    await datasets.startTarget({ runId: run.id, targetKey: "product-detail" });
    await datasets.ensureCaptureWorkItem({ runId: run.id, targetKey: "product-detail",
      workKey: "product:model-1", captureUnit: "exact_page", expectedUnitCount: 1 });
    await datasets.startCaptureWorkItem({ runId: run.id, workKey: "product:model-1" });

    await expect(datasets.finishTarget({ runId: run.id, targetKey: "product-detail",
      status: "completed", terminationReason: "target_scope_completed" }))
      .rejects.toThrow("仍有未完成捕获工作");

    child = spawn(process.execPath, ["--import=tsx", runLeaseChildScript(), databaseUrl!, run.id], {
      cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForLine(child, `LEASED:${run.id}`);
    await expect(datasets.prepareRunForResume(run.id)).rejects.toThrow("仍由活动执行进程持有");
    child.kill("SIGKILL");
    await waitForExit(child);
    await expect(datasets.prepareRunForResume(run.id)).resolves.toMatchObject({
      id: run.id, status: "stopped", terminationReason: "execution_process_lost",
    });
    await expect(datasets.getRun(run.id)).resolves.toMatchObject({
      targets: [expect.objectContaining({ status: "stopped" })],
      workItems: [expect.objectContaining({ status: "stopped" })],
    });
    await expect(datasets.startRun({ taskId, planId: "plan-target-work-gate", planVersion: 1,
      sourceKey: "brand", providerKey: "public.web-resource", providerVersion: "1.0.0", requestBudget: 1,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 60_000, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 120_000 }, targetKeys: ["product-detail"],
      resumedFromRunId: run.id })).resolves.toMatchObject({ resumedFromRunId: run.id, status: "running" });
  });

  it("启动恢复把无活动执行进程的 running 批次和运行收口为 stopped", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-interrupted-batch-${randomUUID()}`;
    const at = "2026-08-21T00:00:00.000Z";
    await db.insert(captureTasks).values({ id: taskId, name: "失联批次恢复测试",
      originalRequest: "本地 fixture", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-interrupted-batch", taskId,
      taskRevision: 1, version: 3, status: "confirmed", contentHash: "3".repeat(64), confirmedAt: at,
      content: { taskId, taskRevision: 1, sources: [{ key: "brand",
        providerKey: "public.web-resource", entryUrl: "https://brand.example/products/model-1",
        expectedContents: ["产品详情"], accessPolicy: { kind: "manual", version: "fixture" } }] } });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const batch = await datasets.startBatch({ taskId, planId: "plan-interrupted-batch",
      planVersion: 3, taskRevision: 1, plannedSourceCount: 1 });
    const run = await datasets.startRun({ taskId, planId: "plan-interrupted-batch", planVersion: 3,
      batchId: batch.id, sourceKey: "brand", providerKey: "public.web-resource",
      providerVersion: "1.0.0", requestBudget: 1,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 60_000, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 120_000 }, targetKeys: ["product-detail"] });
    await datasets.startTarget({ runId: run.id, targetKey: "product-detail" });
    await datasets.ensureCaptureWorkItem({ runId: run.id, targetKey: "product-detail",
      workKey: "product:model-1", captureUnit: "exact_page", expectedUnitCount: 1 });
    await datasets.startCaptureWorkItem({ runId: run.id, workKey: "product:model-1" });

    const lease = await datasets.acquireBatchLease(batch.id);
    await expect(datasets.recoverInterruptedBatches({ taskId })).resolves.toEqual([]);
    await expect(datasets.listTask(taskId)).resolves.toMatchObject({
      batches: [expect.objectContaining({ id: batch.id, status: "running" })],
      runs: [expect.objectContaining({ id: run.id, status: "running" })],
    });
    await lease.release();
    await expect(datasets.recoverInterruptedBatches({ taskId })).resolves.toEqual([batch.id]);
    await expect(datasets.listTask(taskId)).resolves.toMatchObject({
      batches: [expect.objectContaining({ id: batch.id, status: "stopped",
        terminationReason: "execution_process_lost" })],
      runs: [expect.objectContaining({ id: run.id, status: "stopped",
        terminationReason: "execution_process_lost" })],
    });
    await expect(datasets.getRun(run.id)).resolves.toMatchObject({
      targets: [expect.objectContaining({ status: "stopped" })],
      workItems: [expect.objectContaining({ status: "stopped" })],
    });
  });

});

function references(count: number) {
  return Array.from({ length: count }, (_, ordinal) => ({
    kind: "image" as const,
    sourceUrl: `https://img.example.com/${ordinal}.webp`,
    observedValue: `//img.example.com/${ordinal}.webp`,
    locator: `#description img:nth-of-type(${ordinal + 1})@data-src`,
    role: ordinal === 0 ? "primary" as const : "detail" as const,
    section: ordinal === 0 ? "gallery" : "description",
    ordinal,
  }));
}

function runLeaseChildScript() {
  return fileURLToPath(new URL("./fixtures/sourceRunLeaseChild.ts", import.meta.url));
}

function waitForLine(child: ChildProcess, expected: string) {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`租约子进程未输出 ${expected}：${output}`)), 5_000);
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes(expected)) { clearTimeout(timeout); resolve(); }
    });
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => {
      if (!output.includes(expected)) {
        clearTimeout(timeout);
        reject(new Error(`租约子进程提前退出 ${code}：${output}`));
      }
    });
  });
}

function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function clearTask(db: WorkbenchDb, taskId: string) {
  const runs = await db.select({ id: sourceCollectionRuns.id }).from(sourceCollectionRuns)
    .where(eq(sourceCollectionRuns.taskId, taskId));
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
  await db.delete(captureTasks).where(eq(captureTasks.id, taskId));
}
