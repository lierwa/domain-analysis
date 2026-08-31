import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import {
  captureTasks,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  sourceCaptureSubjects,
  sourceCaptureWorkItems,
  sourceCollectionBatches,
  sourceCollectionPlans,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  type WorkbenchDb,
} from "@domain-analysis/db";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createSourceDatasetModule } from "../src";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("Source Capture Subject", () => {
  let db: WorkbenchDb | undefined;
  let taskId: string | undefined;

  afterEach(async () => {
    if (db && taskId) await clearTask(db, taskId);
    await db?.$client.end();
    db = undefined;
    taskId = undefined;
  });

  it("在 Batch 内幂等，并拒绝工作项身份漂移和重复活动 Batch", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-capture-subject-${randomUUID()}`;
    const at = "2026-08-31T00:00:00.000Z";
    await db.insert(captureTasks).values({ id: taskId, name: "Capture Subject 测试",
      originalRequest: "抓取微波炉品牌型号", marketScope: "中国大陆", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: `plan-capture-subject-${randomUUID()}`, taskId,
      taskRevision: 1, version: 1, status: "confirmed", contentHash: "a".repeat(64), confirmedAt: at,
      content: { taskId, taskRevision: 1, sources: [] } });
    const plan = await db.query.sourceCollectionPlans.findFirst({
      where: eq(sourceCollectionPlans.taskId, taskId),
    });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const batch = await datasets.startBatch({ taskId, planId: plan!.id, planVersion: 1,
      taskRevision: 1, plannedSourceCount: 1 });
    await expect(datasets.startBatch({ taskId, planId: plan!.id, planVersion: 1,
      taskRevision: 1, plannedSourceCount: 1 })).rejects.toThrow("活动抓取批次");
    const run = await datasets.startRun({ taskId, planId: plan!.id, planVersion: 1,
      sourceKey: "zol.microwave_oven.ranked-brands", providerKey: "zol.catalog-gallery",
      providerVersion: "2.0.0", requestBudget: 10, batchId: batch.id,
      accessPolicy: { kind: "manual", version: "fixture" }, targetKeys: ["models"] });
    await datasets.startTarget({ runId: run.id, targetKey: "models" });
    const subject = { kind: "product_model" as const, sourceEntityId: "1228243",
      displayName: "方太W25800K-01AG", parent: { kind: "brand" as const,
        sourceEntityId: "fotile", displayName: "方太" } };
    const first = await datasets.ensureCaptureWorkItem({ runId: run.id, targetKey: "models",
      workKey: "page:param:1228243", captureUnit: "zol_model_parameters", resourceKind: "parameters", subject });
    const replay = await datasets.ensureCaptureWorkItem({ runId: run.id, targetKey: "models",
      workKey: "page:param:1228243", captureUnit: "zol_model_parameters", resourceKind: "parameters", subject });
    const gallery = await datasets.ensureCaptureWorkItem({ runId: run.id, targetKey: "models",
      workKey: "page:gallery:1228243", captureUnit: "zol_model_gallery", resourceKind: "gallery", subject });

    expect(replay.id).toBe(first.id);
    expect(gallery.subjectId).toBe(first.subjectId);
    await expect(datasets.ensureCaptureWorkItem({ runId: run.id, targetKey: "models",
      workKey: "page:param:1228243", captureUnit: "zol_model_parameters", resourceKind: "parameters",
      subject: { ...subject, sourceEntityId: "different" } })).rejects.toThrow("定义冲突");
    await expect(db.select().from(sourceCaptureSubjects)
      .where(eq(sourceCaptureSubjects.executionBatchId, batch.id))).resolves.toHaveLength(2);
    await expect(db.select().from(sourceCaptureWorkItems)
      .where(eq(sourceCaptureWorkItems.runId, run.id))).resolves.toHaveLength(2);
  });
});

async function clearTask(db: WorkbenchDb, taskId: string) {
  const runs = await db.select({ id: sourceCollectionRuns.id }).from(sourceCollectionRuns)
    .where(eq(sourceCollectionRuns.taskId, taskId));
  const runIds = runs.map((run) => run.id);
  if (runIds.length > 0) {
    await db.delete(sourceCaptureWorkItems).where(inArray(sourceCaptureWorkItems.runId, runIds));
    await db.delete(sourceCollectionTargetRuns).where(inArray(sourceCollectionTargetRuns.runId, runIds));
    await db.delete(sourceCollectionRuns).where(inArray(sourceCollectionRuns.id, runIds));
  }
  const batches = await db.select({ id: sourceCollectionBatches.id }).from(sourceCollectionBatches)
    .where(eq(sourceCollectionBatches.taskId, taskId));
  const batchIds = batches.map((batch) => batch.id);
  if (batchIds.length > 0) {
    await db.delete(sourceCaptureSubjects).where(inArray(sourceCaptureSubjects.executionBatchId, batchIds));
  }
  await db.delete(sourceCollectionBatches).where(eq(sourceCollectionBatches.taskId, taskId));
  await db.delete(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, taskId));
  await db.delete(captureTasks).where(eq(captureTasks.id, taskId));
}
