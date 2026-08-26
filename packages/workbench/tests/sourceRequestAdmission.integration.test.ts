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
    const gateKey = `public.web-resource@1.0.0:${randomUUID()}`;
    const at = "2026-08-21T00:00:00.000Z";
    await insertConfirmedTaskAndPlan(db, taskId, at);
    const module = createSourceDatasetModule(db, {
      now: () => new Date(at),
      assetStore: { async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); } },
    });
    const run = await module.startRun({ taskId, planId: "plan-request-admission", planVersion: 1,
      sourceKey: "brand", providerKey: "public.web-resource", providerVersion: "1.0.0", requestBudget: 2,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 60_000, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 120_000 }, targetKeys: ["product-detail"] });
    await module.startTarget({ runId: run.id, targetKey: "product-detail" });
    await module.ensureCaptureWorkItem({ runId: run.id, targetKey: "product-detail",
      workKey: "product:model-1", captureUnit: "exact_page", expectedUnitCount: 1 });
    await module.startCaptureWorkItem({ runId: run.id, workKey: "product:model-1" });
    const request = { runId: run.id, targetKey: "product-detail", workKey: "product:model-1",
      gateKey, providerKey: "public.web-resource", providerVersion: "1.0.0", policyVersion: "fixture",
      requestedUrl: "https://brand.example/products/model-1", minimumIntervalMs: 60_000,
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
    await restarted.finishCaptureWorkItem({ runId: run.id, workKey: "product:model-1",
      status: "failed", observedUnitCount: 0, terminationReason: "rate_limited" });
    const view = await restarted.getRun(run.id);
    expect(view?.workItems).toEqual([expect.objectContaining({ status: "failed",
      observedUnitCount: 0, terminationReason: "rate_limited" })]);
    expect(view?.requestAttempts).toHaveLength(1);
    expect(view?.requestAttempts[0]).toMatchObject({ state: "restricted", httpStatus: 429 });
    expect(view?.accessGates).toHaveLength(1);
    expect(view?.accessGates[0]).toMatchObject({ circuitState: "open", manualResumeRequired: true });

    await restarted.finishTarget({ runId: run.id, targetKey: "product-detail",
      status: "failed", terminationReason: "rate_limited" });
    await restarted.finishRun({ runId: run.id, status: "failed", terminationReason: "rate_limited" });
    const resumed = await restarted.startRun({ taskId, planId: "plan-request-admission", planVersion: 1,
      sourceKey: "brand", providerKey: "public.web-resource", providerVersion: "1.0.0", requestBudget: 2,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 60_000, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 120_000 }, targetKeys: ["product-detail"],
      resumedFromRunId: run.id });
    expect(resumed.resumedFromRunId).toBe(run.id);
    await expect(restarted.getAccessGate(gateKey)).resolves.toMatchObject({
      circuitState: "closed", manualResumeRequired: false,
      nextEligibleAt: "2026-08-21T00:01:00.000Z",
    });
    await restarted.startTarget({ runId: resumed.id, targetKey: "product-detail" });
    await restarted.ensureCaptureWorkItem({ runId: resumed.id, targetKey: "product-detail",
      workKey: "product:model-2", captureUnit: "exact_page", expectedUnitCount: 1 });
    await restarted.startCaptureWorkItem({ runId: resumed.id, workKey: "product:model-2" });
    const resumedRequest = { ...request, runId: resumed.id, workKey: "product:model-2",
      requestedUrl: "https://brand.example/products/model-2" };
    const second = await restarted.reserveRequest(resumedRequest);
    expect(second.status).toBe("admitted");
    if (second.status !== "admitted") throw new Error("恢复运行请求未获准");
    await restarted.finishRequest({ attemptId: second.attempt.id, state: "completed",
      finalUrl: resumedRequest.requestedUrl, httpStatus: 200, bytes: 1 });
    await restarted.ensureCaptureWorkItem({ runId: resumed.id, targetKey: "product-detail",
      workKey: "product:model-3", captureUnit: "exact_page", expectedUnitCount: 1 });
    await restarted.startCaptureWorkItem({ runId: resumed.id, workKey: "product:model-3" });
    await expect(restarted.reserveRequest({ ...resumedRequest, workKey: "product:model-3",
      requestedUrl: "https://brand.example/products/model-3" })).resolves.toMatchObject({
      status: "blocked", reason: "request_budget_exhausted",
    });
  });

  it("关闭且无在途请求的 origin gate 接受新版策略，并继承更严格的下一次时间", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-policy-upgrade-${randomUUID()}`;
    let now = new Date("2026-08-21T00:00:00.000Z");
    await insertConfirmedTaskAndPlan(db, taskId, now.toISOString());
    const module = createSourceDatasetModule(db, { now: () => now,
      assetStore: { async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); } },
    });
    const gateKey = `public.web-resource@1.0.0:${randomUUID()}`;
    const first = await startAdmissionRun(module, taskId, "policy-v1", 60_000, "first");
    const firstRequest = admissionRequest(first.id, gateKey, "policy-v1", 60_000, "first");
    const admitted = await module.reserveRequest(firstRequest);
    expect(admitted.status).toBe("admitted");
    if (admitted.status !== "admitted") throw new Error("首个请求未获准");
    await module.finishRequest({ attemptId: admitted.attempt.id, state: "completed",
      finalUrl: firstRequest.requestedUrl, httpStatus: 200, bytes: 1 });
    await module.finishCaptureWorkItem({ runId: first.id, workKey: "work-first",
      status: "completed", observedUnitCount: 1 });
    await module.finishTarget({ runId: first.id, targetKey: "product-detail",
      status: "completed", terminationReason: "target_scope_completed" });
    await module.finishRun({ runId: first.id, status: "completed",
      terminationReason: "plan_scope_completed" });

    now = new Date("2026-08-21T00:01:30.000Z");
    const second = await startAdmissionRun(module, taskId, "policy-v2", 120_000, "second");
    const secondRequest = admissionRequest(second.id, gateKey, "policy-v2", 120_000, "second");
    await expect(module.reserveRequest(secondRequest)).resolves.toMatchObject({
      status: "deferred", retryAt: "2026-08-21T00:02:00.000Z",
    });
    await expect(module.getAccessGate(gateKey)).resolves.toMatchObject({ policyVersion: "policy-v2" });

    now = new Date("2026-08-21T00:02:01.000Z");
    await expect(module.reserveRequest(secondRequest)).resolves.toMatchObject({ status: "admitted" });
  });
});

async function startAdmissionRun(
  module: ReturnType<typeof createSourceDatasetModule>,
  taskId: string,
  policyVersion: string,
  minimumIntervalMs: number,
  suffix: string,
) {
  const run = await module.startRun({ taskId, planId: "plan-request-admission", planVersion: 1,
    sourceKey: `brand-${suffix}`, providerKey: "public.web-resource", providerVersion: "1.0.0",
    requestBudget: 1, accessPolicy: { kind: "paced_http", version: policyVersion,
      maxRequestsPerMinute: 1, minimumIntervalMs, jitterMs: { min: 0, max: 0 }, batchSize: 1,
      batchCooldownMs: 60_000, maximumRunMs: 180_000 }, targetKeys: ["product-detail"] });
  await module.startTarget({ runId: run.id, targetKey: "product-detail" });
  await module.ensureCaptureWorkItem({ runId: run.id, targetKey: "product-detail",
    workKey: `work-${suffix}`, captureUnit: "exact_page", expectedUnitCount: 1 });
  await module.startCaptureWorkItem({ runId: run.id, workKey: `work-${suffix}` });
  return run;
}

function admissionRequest(
  runId: string,
  gateKey: string,
  policyVersion: string,
  minimumIntervalMs: number,
  suffix: string,
) {
  return { runId, targetKey: "product-detail", workKey: `work-${suffix}`, gateKey,
    providerKey: "public.web-resource", providerVersion: "1.0.0", policyVersion,
    requestedUrl: `https://brand.example/products/${suffix}`,
    minimumIntervalMs, maxRequestsPerMinute: 1 };
}

async function insertConfirmedTaskAndPlan(db: WorkbenchDb, taskId: string, at: string) {
  await db.insert(captureTasks).values({ id: taskId, name: "请求准入测试", originalRequest: "本地 fixture",
    marketScope: "本地 fixture", status: "ready", revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
  await db.insert(sourceCollectionPlans).values({ id: "plan-request-admission", taskId, taskRevision: 1,
    version: 1, status: "confirmed", contentHash: "1".repeat(64), confirmedAt: at,
    content: { taskId, taskRevision: 1, sources: [{ key: "brand", providerKey: "public.web-resource",
      entryUrl: "https://brand.example/products/model-1", expectedContents: ["产品详情"],
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
