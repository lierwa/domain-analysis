import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  captureTasks,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  sourceCollectionPlans,
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

  it("详情 Snapshot 原子保存 25 条图片 URL 且不生成 Asset", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-resource-reference-${randomUUID()}`;
    const at = "2026-08-21T00:00:00.000Z";
    await db.insert(captureTasks).values({ id: taskId, name: "图片 URL 测试",
      originalRequest: "抓取详情图片 URL", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-1", taskId, taskRevision: 1,
      version: 1, status: "confirmed", contentHash: "0".repeat(64), confirmedAt: at,
      content: { taskId, taskRevision: 1, sources: [{ key: "jd", providerKey: "jd.catalog-product",
        entryUrl: "https://www.jd.com/", expectedContents: ["详情图片 URL"],
        accessPolicy: { kind: "manual", version: "fixture" } }] } });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("URL-only 捕获不应写入 Asset Store"); },
      open() { return Readable.from([]); },
    } });
    const run = await datasets.startRun({ taskId, planId: "plan-1", planVersion: 1,
      sourceKey: "jd", providerKey: "jd.catalog-product", providerVersion: "2.0.0",
      requestBudget: 1,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 1, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 1, maximumRunMs: 1_000 }, targetKeys: ["product_details"] });
    await datasets.startTarget({ runId: run.id, targetKey: "product_details" });
    const html = "<html>detail</html>";
    const view = await datasets.commitSnapshot({ runId: run.id, targetKey: "product_details",
      idempotencyKey: "sku-1-detail", object: { sourceIdentity: "jd", kind: "product", externalKey: "sku-1" },
      observation: { requestedUrl: "https://item.example.com/sku-1", observedAt: at,
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
      content: { taskId, taskRevision: 1, sources: [{ key: "jd", providerKey: "jd.catalog-product",
        entryUrl: "https://www.jd.com/", expectedContents: ["详情"],
        accessPolicy: { kind: "manual", version: "fixture" } }] } });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const run = await datasets.startRun({ taskId, planId: "plan-target-work-gate", planVersion: 1,
      sourceKey: "jd", providerKey: "jd.catalog-product", providerVersion: "2.0.0", requestBudget: 1,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 60_000, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 120_000 }, targetKeys: ["product_details"] });
    await datasets.startTarget({ runId: run.id, targetKey: "product_details" });
    await datasets.ensureCaptureWorkItem({ runId: run.id, targetKey: "product_details",
      workKey: "product:sku-1", captureUnit: "product_detail", expectedUnitCount: 1 });
    await datasets.startCaptureWorkItem({ runId: run.id, workKey: "product:sku-1" });

    await expect(datasets.finishTarget({ runId: run.id, targetKey: "product_details",
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
      sourceKey: "jd", providerKey: "jd.catalog-product", providerVersion: "2.0.0", requestBudget: 1,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 60_000, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 120_000 }, targetKeys: ["product_details"],
      resumedFromRunId: run.id })).resolves.toMatchObject({ resumedFromRunId: run.id, status: "running" });
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
  await db.delete(sourceObjects).where(eq(sourceObjects.taskId, taskId));
  await db.delete(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, taskId));
  await db.delete(captureTasks).where(eq(captureTasks.id, taskId));
}
