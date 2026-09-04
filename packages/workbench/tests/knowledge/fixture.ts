import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureTasks, createWorkbenchDb, knowledgeAiReviews, knowledgeDecisions, knowledgeItems, knowledgePacks, knowledgeRuns,
  knowledgeVersions, migrateWorkbenchDatabase, sourceAssets, sourceCaptureWorkItems, sourceCollectionBatches,
  sourceCollectionPlans, sourceCollectionRuns,
  sourceObjects, sourceSnapshots } from "@domain-analysis/db";
import { eq, inArray } from "drizzle-orm";
import { makeWorkerUtils } from "graphile-worker";
import { createKnowledgeProcessingModule, createSourceDatasetModule } from "../../src";
import { sha256 } from "../../src/knowledge/storage";

export async function fixture() {
  const url = process.env.POSTGRES_DATABASE_URL!;
  await migrateWorkbenchDatabase(url);
  const db = createWorkbenchDb(url);
  db.$client.on("error", () => undefined);
  db.$client.on("connect", client => { client.on("error", () => undefined); });
  const utils = await makeWorkerUtils({ pgPool: db.$client });
  await utils.migrate();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-test-"));
  const taskId = `knowledge-test-${randomUUID()}`, sourceRunId = `${taskId}-source`;
  const planId = `${taskId}-plan`, batchId = `${taskId}-batch`;
  const at = new Date().toISOString();
  await db.insert(captureTasks).values({ id: taskId, name: "知识加工契约测试", originalRequest: "验证来源资料加工",
    marketScope: "测试", status: "ready", revision: 1 });
  const accessPolicy = { kind: "manual" as const, version: "fixture" };
  await db.insert(sourceCollectionPlans).values({ id: planId, taskId, taskRevision: 1, version: 1,
    status: "confirmed", contentHash: sha256("plan"), content: { taskId, taskRevision: 1, sources: [{ key: "fixture",
      providerKey: "zol.catalog-gallery", entryUrl: "https://example.com/catalog", expectedContents: ["测试参数"], accessPolicy }] } });
  await db.insert(sourceCollectionBatches).values({ id: batchId, taskId, sourceCollectionPlanId: planId,
    sourceCollectionPlanVersion: 1, taskRevision: 1, status: "completed", plannedSourceCount: 1,
    startedAt: at, finishedAt: at });
  await db.insert(sourceCollectionRuns).values({ id: sourceRunId, taskId, providerKey: "zol.catalog-gallery",
    providerVersion: "fixture", accessPolicy, status: "completed", executionBatchId: batchId,
    sourceCollectionPlanId: planId, sourceCollectionPlanSourceKey: "fixture", sourceCollectionPlanVersion: 1,
    startedAt: at, finishedAt: at });
  for (const [i, text] of ["<title>【测试产品参数】</title><b id='newPmName_1'>容量</b><span id='newPmVal_1'>23 L</span>",
    "<title>【另一产品参数】</title><b id='newPmName_1'>温度</b><span id='newPmVal_1'>100 ℃<br>标准环境</span>"].entries()) {
    const id = `${taskId}-${i}`;
    await db.insert(sourceObjects).values({ id, taskId, sourceIdentity: "fixture", kind: "web_page", externalKey: id });
    await db.insert(sourceCaptureWorkItems).values({ id, runId: sourceRunId, targetKey: "fixture", workKey: id,
      captureUnit: "web_page", resourceKind: "parameters", status: "completed" });
    await db.insert(sourceSnapshots).values({ id, runId: sourceRunId, captureWorkItemId: id, targetKey: "fixture", objectId: id,
      idempotencyKey: id, contentHash: sha256(text), lineage: { workKey: id, discoveryKind: "planned_entry", depth: 0 },
      observation: { requestedUrl: `https://example.com/${i}`, observedAt: at, state: "accessible", responseHeaders: {},
        contentAssessment: { status: "accepted", ruleVersion: "fixture", matchedSignals: ["public"], reason: "公开资料测试" } },
      payload: { kind: "inline_text", mediaType: "text/html", text, bytes: Buffer.byteLength(text), contentHash: sha256(text) } });
  }
  const sources = createSourceDatasetModule(db, { assetCachePath: path.join(root, "source") });
  const options = { cachePath: path.join(root, "cache"), artifactPath: path.join(root, "artifacts"), workPath: path.join(root, "work") };
  const processing = createKnowledgeProcessingModule(db, sources, options);
  const packIds: string[] = [];
  async function create() {
    const pack = await processing.create({ name: "持久化产线测试", skillName: `knowledge-test-${randomUUID()}`,
      scope: "验证原件与成品生命周期" });
    packIds.push(pack.id);
    return processing.select(pack.id, { expectedRevision: pack.revision, skillName: pack.skillName,
      selection: [{ taskId, batchId }] });
  }
  async function clear() {
    const runs = await db.select().from(knowledgeRuns).where(inArray(knowledgeRuns.packId, packIds));
    const runIds = runs.map(row => row.id);
    const aiReviews = await db.select().from(knowledgeAiReviews).where(inArray(knowledgeAiReviews.runId, runIds));
    const versions = await db.select().from(knowledgeVersions).where(inArray(knowledgeVersions.packId, packIds));
    const jobs = await db.$client.query<{ id: string }>(`select id from graphile_worker.jobs where
      task_identifier='execute_knowledge_processing' and key=any($1::text[])`,
    [[...runs.flatMap(row => Array.from({ length: row.generation }, (_, i) => `extract:${row.id}:${i + 1}`)),
      ...versions.map(row => `build:${row.id}`), ...aiReviews.map(row => `ai-review:${row.id}`)]]);
    if (jobs.rows.length) await utils.completeJobs(jobs.rows.map(row => row.id));
    await db.delete(knowledgeAiReviews).where(inArray(knowledgeAiReviews.runId, runIds));
    await db.delete(knowledgeDecisions).where(inArray(knowledgeDecisions.runId, runIds));
    await db.delete(knowledgeItems).where(inArray(knowledgeItems.runId, runIds));
    await db.delete(knowledgeVersions).where(inArray(knowledgeVersions.packId, packIds));
    await db.delete(knowledgeRuns).where(inArray(knowledgeRuns.packId, packIds));
    await db.delete(knowledgePacks).where(inArray(knowledgePacks.id, packIds));
    await db.delete(sourceAssets).where(inArray(sourceAssets.snapshotId, [`${taskId}-0`, `${taskId}-1`]));
    await db.delete(sourceSnapshots).where(eq(sourceSnapshots.runId, sourceRunId));
    await db.delete(sourceCaptureWorkItems).where(eq(sourceCaptureWorkItems.runId, sourceRunId));
    await db.delete(sourceCollectionRuns).where(eq(sourceCollectionRuns.executionBatchId, batchId));
    await db.delete(sourceCollectionBatches).where(eq(sourceCollectionBatches.id, batchId));
    await db.delete(sourceCollectionPlans).where(eq(sourceCollectionPlans.id, planId));
    await db.delete(sourceObjects).where(eq(sourceObjects.taskId, taskId));
    await db.delete(captureTasks).where(eq(captureTasks.id, taskId));
    await utils.release(); await db.$client.end(); await fs.rm(root, { recursive: true, force: true });
  }
  return { db, processing, sources, taskId, sourceRunId, batchId, create, clear, options, packIds };
}
