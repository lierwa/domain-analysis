import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import {
  captureTasks,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  sourceCollectionPlans,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceObjects,
  sourceSnapshots,
  type WorkbenchDb,
} from "@domain-analysis/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createSourceDatasetModule } from "../src";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("Source Dataset 持久请求准入", () => {
  let db: WorkbenchDb | undefined;
  let taskId: string | undefined;

  afterEach(async () => {
    if (db && taskId) await clearTask(db, taskId);
    await db?.$client.end();
    db = undefined;
    taskId = undefined;
  });

  it("并发只有一个请求获准，首个 429 后重启仍保持开路", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-request-admission-${randomUUID()}`;
    const gateKey = `jd.catalog-product@2.0.0:${randomUUID()}`;
    const at = "2026-08-21T00:00:00.000Z";
    await insertConfirmedTaskAndPlan(db, taskId, at);
    const module = createSourceDatasetModule(db, {
      now: () => new Date(at),
      assetStore: { async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); } },
    });
    const run = await module.startRun({ taskId, planId: "plan-request-admission", planVersion: 1,
      sourceKey: "jd", providerKey: "jd.catalog-product", providerVersion: "2.0.0", requestBudget: 2,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 60_000, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 120_000 }, targetKeys: ["product_details"] });
    await module.startTarget({ runId: run.id, targetKey: "product_details" });
    await module.ensureCaptureWorkItem({ runId: run.id, targetKey: "product_details",
      workKey: "product:sku-1", captureUnit: "product_detail", expectedUnitCount: 1 });
    await module.startCaptureWorkItem({ runId: run.id, workKey: "product:sku-1" });
    const request = { runId: run.id, targetKey: "product_details", workKey: "product:sku-1",
      gateKey, providerKey: "jd.catalog-product", providerVersion: "2.0.0", policyVersion: "fixture",
      requestedUrl: "https://item.jd.com/sku-1.html", minimumIntervalMs: 60_000,
      maxRequestsPerMinute: 1 };

    const results = await Promise.all([module.reserveRequest(request), module.reserveRequest(request)]);
    expect(results.map((result) => result.status).sort()).toEqual(["admitted", "deferred"]);
    const admitted = results.find((result) => result.status === "admitted");
    expect(admitted?.status).toBe("admitted");
    if (!admitted || admitted.status !== "admitted") throw new Error("请求未获准");
    await module.finishRequest({ attemptId: admitted.attempt.id, state: "restricted",
      finalUrl: request.requestedUrl, httpStatus: 429, bytes: 0, restrictionReason: "rate_limited" });

    const restarted = createSourceDatasetModule(db, {
      now: () => new Date("2026-08-21T00:02:00.000Z"),
      assetStore: { async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); } },
    });
    await expect(restarted.getAccessGate(gateKey)).resolves.toMatchObject({
      circuitState: "open", blockedReason: "rate_limited", manualResumeRequired: true,
    });
    await expect(restarted.reserveRequest(request)).resolves.toMatchObject({
      status: "blocked", reason: "rate_limited", manualResumeRequired: true,
    });
    await restarted.finishCaptureWorkItem({ runId: run.id, workKey: "product:sku-1",
      status: "failed", observedUnitCount: 0, terminationReason: "rate_limited" });
    const view = await restarted.getRun(run.id);
    expect(view?.workItems).toEqual([expect.objectContaining({ status: "failed",
      observedUnitCount: 0, terminationReason: "rate_limited" })]);
    expect(view?.requestAttempts).toHaveLength(1);
    expect(view?.requestAttempts[0]).toMatchObject({ state: "restricted", httpStatus: 429 });
    expect(view?.accessGates).toHaveLength(1);
    expect(view?.accessGates[0]).toMatchObject({ circuitState: "open", manualResumeRequired: true });

    await restarted.finishTarget({ runId: run.id, targetKey: "product_details",
      status: "failed", terminationReason: "rate_limited" });
    await restarted.finishRun({ runId: run.id, status: "failed", terminationReason: "rate_limited" });
    const resumed = await restarted.startRun({ taskId, planId: "plan-request-admission", planVersion: 1,
      sourceKey: "jd", providerKey: "jd.catalog-product", providerVersion: "2.0.0", requestBudget: 2,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 60_000, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 120_000 }, targetKeys: ["product_details"],
      resumedFromRunId: run.id });
    expect(resumed.resumedFromRunId).toBe(run.id);
    await expect(restarted.getAccessGate(gateKey)).resolves.toMatchObject({
      circuitState: "closed", manualResumeRequired: false,
      nextEligibleAt: "2026-08-21T00:01:00.000Z",
    });
    await restarted.startTarget({ runId: resumed.id, targetKey: "product_details" });
    await restarted.ensureCaptureWorkItem({ runId: resumed.id, targetKey: "product_details",
      workKey: "product:sku-2", captureUnit: "product_detail", expectedUnitCount: 1 });
    await restarted.startCaptureWorkItem({ runId: resumed.id, workKey: "product:sku-2" });
    const resumedRequest = { ...request, runId: resumed.id, workKey: "product:sku-2",
      requestedUrl: "https://item.jd.com/sku-2.html" };
    const second = await restarted.reserveRequest(resumedRequest);
    expect(second.status).toBe("admitted");
    if (second.status !== "admitted") throw new Error("恢复运行请求未获准");
    await restarted.finishRequest({ attemptId: second.attempt.id, state: "completed",
      finalUrl: resumedRequest.requestedUrl, httpStatus: 200, bytes: 1 });
    await restarted.ensureCaptureWorkItem({ runId: resumed.id, targetKey: "product_details",
      workKey: "product:sku-3", captureUnit: "product_detail", expectedUnitCount: 1 });
    await restarted.startCaptureWorkItem({ runId: resumed.id, workKey: "product:sku-3" });
    await expect(restarted.reserveRequest({ ...resumedRequest, workKey: "product:sku-3",
      requestedUrl: "https://item.jd.com/sku-3.html" })).resolves.toMatchObject({
      status: "blocked", reason: "request_budget_exhausted",
    });
  });
});

async function insertConfirmedTaskAndPlan(db: WorkbenchDb, taskId: string, at: string) {
  await db.insert(captureTasks).values({ id: taskId, name: "请求准入测试", originalRequest: "本地 fixture",
    marketScope: "本地 fixture", status: "ready", revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
  await db.insert(sourceCollectionPlans).values({ id: "plan-request-admission", taskId, taskRevision: 1,
    version: 1, status: "confirmed", contentHash: "1".repeat(64), confirmedAt: at,
    content: { taskId, taskRevision: 1, sources: [{ key: "jd", providerKey: "jd.catalog-product",
      entryUrl: "https://www.jd.com/", expectedContents: ["详情"],
      accessPolicy: { kind: "manual", version: "fixture" } }] } });
}

async function clearTask(db: WorkbenchDb, taskId: string) {
  const runs = await db.select({ id: sourceCollectionRuns.id }).from(sourceCollectionRuns)
    .where(eq(sourceCollectionRuns.taskId, taskId));
  for (const run of runs) {
    await db.delete(sourceSnapshots).where(eq(sourceSnapshots.runId, run.id));
    await db.delete(sourceCollectionTargetRuns).where(eq(sourceCollectionTargetRuns.runId, run.id));
  }
  await db.delete(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId));
  await db.delete(sourceObjects).where(eq(sourceObjects.taskId, taskId));
  await db.delete(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, taskId));
  await db.delete(captureTasks).where(eq(captureTasks.id, taskId));
}
