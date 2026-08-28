import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Readable } from "node:stream";

import type { WorkbenchDb } from "@domain-analysis/db";
import {
  sourceAccessGateStates,
  sourceAssets,
  sourceCaptureWorkItems,
  sourceCollectionBatches,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceObjects,
  sourceResourceReferences,
  sourceRequestAttempts,
  sourceSnapshots,
} from "@domain-analysis/db";
import {
  sourceDatasetRunViewSchema,
  sourceObjectSchema,
  sourceProviderAssetSchema,
  sourceProviderResourceReferenceSchema,
  sourceSnapshotCommitSchema,
  type SourceAccessPolicy,
  type SourceAsset,
  type SourceCollectionBatch,
  type SourceCollectionRun,
  type SourceCollectionTargetRun,
  type SourceExecutionFailureCategory,
  type SourceDatasetRunView,
  type SourceDatasetRecordGroupKey,
  type SourceDatasetRecordPage,
  type SourceDatasetTaskView,
  type SourceProviderAsset,
  type SourceProviderResourceReference,
  type SourceRequestAdmissionPort,
  type SourceSnapshotCommit,
} from "@domain-analysis/shared";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { contentHash } from "./contentHash";
import { createCacacheSourceAssetStore, type SourceAssetStore } from "./sourceAssetStore";
import { serializeSourceDataset } from "./sourceDatasetExport";
import { SourceDatasetError } from "./sourceDatasetError";
import {
  normalizeAsset,
  normalizeBatch,
  normalizeResourceReference,
  normalizeRun,
  normalizeSnapshot,
  normalizeTarget,
  normalizeTimestamp,
  sourceSnapshotOutcome,
} from "./sourceDatasetNormalization";
import { loadSourceDatasetRecordPage, loadSourceDatasetTaskView } from "./sourceDatasetTaskView";
import { acquireSourceBatchLease, recoverInterruptedSourceBatches } from "./sourceExecutionRecovery";
import {
  acquireSourceRunLease,
  createSourceRequestAdmission,
  loadSourceRequestState,
  prepareSourceRunForResume,
} from "./sourceRequestAdmission";

type SnapshotWrite = SourceSnapshotCommit & {
  assets?: SourceProviderAsset[];
  resourceReferences?: SourceProviderResourceReference[];
};
type WorkbenchTransaction = Parameters<Parameters<WorkbenchDb["transaction"]>[0]>[0];

export interface SourceDatasetModule extends SourceRequestAdmissionPort {
  listTask(taskId: string): Promise<SourceDatasetTaskView>;
  listTaskRecords(input: { taskId: string; sourceKey: string; targetKey: string;
    groupKey: SourceDatasetRecordGroupKey; cursor?: string; limit: number }): Promise<SourceDatasetRecordPage>;
  getRun(runId: string): Promise<SourceDatasetRunView | null>;
  exportRun(input: { runId: string; format: "jsonl" | "csv" }): AsyncIterable<string>;
  openAsset(input: { runId: string; assetId: string }): Promise<{ asset: SourceAsset; content: Readable }>;
  acquireRunLease(runId: string): Promise<{ release(): Promise<void> }>;
  acquireBatchLease(batchId: string): Promise<{ release(): Promise<void> }>;
  recoverInterruptedBatches(input?: { taskId?: string }): Promise<string[]>;
  listPendingRecoveryBatches(): Promise<SourceCollectionBatch[]>;
  setBatchRecoveryState(batchId: string, state: "pending" | "running" | "completed"):
    Promise<SourceCollectionBatch>;
  getBatch(batchId: string): Promise<SourceCollectionBatch | null>;
  getBatchByCommandId(commandId: string): Promise<SourceCollectionBatch | null>;
  listBatchRuns(batchId: string): Promise<SourceCollectionRun[]>;
  prepareRunForResume(runId: string): Promise<SourceCollectionRun>;
  startBatch(input: { taskId: string; planId: string; planVersion: number; taskRevision: number;
    plannedSourceCount: number; commandId?: string }): Promise<SourceCollectionBatch>;
  finishBatch(input: { batchId: string; status: "completed" | "partial" | "failed" | "stopped";
    terminationReason?: string }): Promise<SourceCollectionBatch>;
  startRun(input: { taskId: string; planId: string; planVersion: number; sourceKey: string;
    providerKey: string; providerVersion: string; requestBudget: number;
    accessPolicy: SourceAccessPolicy; targetKeys: string[];
    batchId?: string; resumedFromRunId?: string }): Promise<SourceCollectionRun>;
  startTarget(input: { runId: string; targetKey: string }): Promise<SourceCollectionTargetRun>;
  commitSnapshot(input: SnapshotWrite): Promise<SourceDatasetRunView>;
  finishTarget(input: { runId: string; targetKey: string; status: "completed" | "failed" | "stopped";
    terminationReason?: string }): Promise<SourceCollectionTargetRun>;
  finishRun(input: { runId: string; status: "completed" | "failed" | "stopped";
    terminationReason?: string; failureCategory?: SourceExecutionFailureCategory }): Promise<SourceCollectionRun>;
}

export function createSourceDatasetModule(
  db: WorkbenchDb,
  options: { assetCachePath?: string; assetStore?: SourceAssetStore; now?: () => Date } = {},
): SourceDatasetModule {
  const store = options.assetStore ?? createCacacheSourceAssetStore(
    options.assetCachePath ?? path.resolve("data", "source-assets"),
  );
  const admission = createSourceRequestAdmission(db, options.now);
  return {
    ...admission,
    listTask: (taskId) => loadSourceDatasetTaskView(db, taskId),
    listTaskRecords: (input) => loadSourceDatasetRecordPage(db, input),
    getRun: (runId) => loadRun(db, runId),
    exportRun: (input) => exportRun(db, input),
    openAsset: (input) => openAsset(db, store, input),
    acquireRunLease: (runId) => acquireSourceRunLease(db, runId),
    acquireBatchLease: (batchId) => acquireSourceBatchLease(db, batchId),
    recoverInterruptedBatches: (input) => recoverInterruptedSourceBatches(db, input?.taskId),
    listPendingRecoveryBatches: async () => (await db.select().from(sourceCollectionBatches)
      .where(eq(sourceCollectionBatches.recoveryState, "pending"))
      .orderBy(asc(sourceCollectionBatches.startedAt))).map(normalizeBatch),
    setBatchRecoveryState: (batchId, state) => setBatchRecoveryState(db, batchId, state),
    getBatch: async (batchId) => {
      const row = await db.query.sourceCollectionBatches.findFirst({
        where: eq(sourceCollectionBatches.id, batchId),
      });
      return row ? normalizeBatch(row) : null;
    },
    getBatchByCommandId: async (commandId) => {
      const row = await db.query.sourceCollectionBatches.findFirst({
        where: eq(sourceCollectionBatches.commandId, commandId),
      });
      return row ? normalizeBatch(row) : null;
    },
    listBatchRuns: async (batchId) => (await db.select().from(sourceCollectionRuns)
      .where(eq(sourceCollectionRuns.executionBatchId, batchId))
      .orderBy(asc(sourceCollectionRuns.startedAt))).map(normalizeRun),
    prepareRunForResume: (runId) => prepareSourceRunForResume(db, runId),
    startBatch: (input) => startBatch(db, input),
    finishBatch: (input) => finishBatch(db, input),
    startRun: (input) => startRun(db, input),
    startTarget: (input) => startTarget(db, input),
    commitSnapshot: (input) => commitSnapshot(db, store, input),
    finishTarget: (input) => finishTarget(db, input),
    finishRun: (input) => finishRun(db, input),
  };
}

async function startBatch(db: WorkbenchDb, input: Parameters<SourceDatasetModule["startBatch"]>[0]) {
  const row = { id: `source-batch-${randomUUID()}`, taskId: input.taskId,
    commandId: input.commandId ?? null,
    sourceCollectionPlanId: input.planId, sourceCollectionPlanVersion: input.planVersion,
    taskRevision: input.taskRevision, status: "running" as const, recoveryState: "none" as const,
    plannedSourceCount: input.plannedSourceCount, startedAt: new Date().toISOString(),
    finishedAt: null, terminationReason: null };
  await db.insert(sourceCollectionBatches).values(row);
  return normalizeBatch(row);
}

async function setBatchRecoveryState(
  db: WorkbenchDb,
  batchId: string,
  state: "pending" | "running" | "completed",
) {
  const [row] = await db.update(sourceCollectionBatches).set({ recoveryState: state })
    .where(eq(sourceCollectionBatches.id, batchId)).returning();
  if (!row) throw new SourceDatasetError("batch_not_found", `来源批次不存在：${batchId}`);
  return normalizeBatch(row);
}

async function finishBatch(db: WorkbenchDb, input: Parameters<SourceDatasetModule["finishBatch"]>[0]) {
  const changed = await db.update(sourceCollectionBatches).set({ status: input.status,
    finishedAt: new Date().toISOString(), terminationReason: input.terminationReason })
    .where(and(eq(sourceCollectionBatches.id, input.batchId), eq(sourceCollectionBatches.status, "running")))
    .returning();
  if (changed.length !== 1) throw new SourceDatasetError("invalid_state", "抓取批次不存在或已经结束");
  return normalizeBatch(changed[0]!);
}

async function startRun(
  db: WorkbenchDb,
  input: Parameters<SourceDatasetModule["startRun"]>[0],
) {
  const targetKeys = [...new Set(input.targetKeys)];
  if (targetKeys.length === 0 || targetKeys.length !== input.targetKeys.length) {
    throw new SourceDatasetError("invalid_state", "来源运行必须包含非空且唯一的 target key");
  }
  const row = { id: `source-run-${randomUUID()}`, taskId: input.taskId,
    executionBatchId: input.batchId,
    resumedFromRunId: input.resumedFromRunId,
    sourceCollectionPlanId: input.planId, sourceCollectionPlanSourceKey: input.sourceKey,
    sourceCollectionPlanVersion: input.planVersion, providerKey: input.providerKey,
    providerVersion: input.providerVersion, accessPolicy: input.accessPolicy,
    requestBudget: input.requestBudget,
    status: "running" as const, startedAt: new Date().toISOString() };
  await db.transaction(async (transaction) => {
    if (input.resumedFromRunId) await validateAndReleaseResume(transaction, input);
    await transaction.insert(sourceCollectionRuns).values(row);
    await transaction.insert(sourceCollectionTargetRuns).values(targetKeys.map((targetKey) => ({
      id: `source-target-run-${randomUUID()}`, runId: row.id, targetKey, status: "pending" as const,
    })));
  });
  return normalizeRun((await db.query.sourceCollectionRuns.findFirst({
    where: eq(sourceCollectionRuns.id, row.id),
  }))!);
}

async function validateAndReleaseResume(
  transaction: WorkbenchTransaction,
  input: Parameters<SourceDatasetModule["startRun"]>[0],
) {
  const previous = await transaction.query.sourceCollectionRuns.findFirst({
    where: eq(sourceCollectionRuns.id, input.resumedFromRunId!),
  });
  if (!previous || (previous.status !== "failed" && previous.status !== "stopped")
    || previous.taskId !== input.taskId || previous.sourceCollectionPlanId !== input.planId
    || previous.sourceCollectionPlanVersion !== input.planVersion
    || previous.sourceCollectionPlanSourceKey !== input.sourceKey
    || previous.providerKey !== input.providerKey || previous.providerVersion !== input.providerVersion
    || previous.requestBudget !== input.requestBudget) {
    throw new SourceDatasetError("invalid_state", "只能从同一计划、来源、Provider 和预算的已停止运行显式继续");
  }
  const attempts = await transaction.select({ gateKey: sourceRequestAttempts.gateKey })
    .from(sourceRequestAttempts).where(eq(sourceRequestAttempts.runId, previous.id));
  const gateKeys = [...new Set(attempts.map((attempt) => attempt.gateKey))];
  if (gateKeys.length === 0) return;
  // WHY：人工继续只解除持久开路；冷却时间和窗口计数继续保留，不能借恢复绕过频控。
  await transaction.update(sourceAccessGateStates).set({ circuitState: "closed",
    blockedAt: null, blockedReason: null, manualResumeRequired: false,
    updatedAt: new Date().toISOString() })
    .where(and(inArray(sourceAccessGateStates.key, gateKeys),
      eq(sourceAccessGateStates.manualResumeRequired, true)));
}

async function startTarget(db: WorkbenchDb, input: { runId: string; targetKey: string }) {
  const now = new Date().toISOString();
  const changed = await db.update(sourceCollectionTargetRuns).set({ status: "running", startedAt: now })
    .where(and(eq(sourceCollectionTargetRuns.runId, input.runId),
      eq(sourceCollectionTargetRuns.targetKey, input.targetKey), eq(sourceCollectionTargetRuns.status, "pending")))
    .returning();
  if (changed.length !== 1) throw new SourceDatasetError("invalid_state", `target 不存在或不能启动：${input.targetKey}`);
  return normalizeTarget(changed[0]!);
}

async function finishTarget(
  db: WorkbenchDb,
  input: Parameters<SourceDatasetModule["finishTarget"]>[0],
) {
  const row = await db.query.sourceCollectionTargetRuns.findFirst({ where: and(
    eq(sourceCollectionTargetRuns.runId, input.runId), eq(sourceCollectionTargetRuns.targetKey, input.targetKey),
  ) });
  if (!row || (row.status !== "running" && !(row.status === "pending" && input.status === "stopped"))) {
    throw new SourceDatasetError("invalid_state", `target 不存在或已经结束：${input.targetKey}`);
  }
  if (input.status === "completed") {
    // WHY：快照数无法表达动态发现队列是否耗尽；target 只能由持久工作账本证明完整完成。
    const incompleteWork = await db.select({ id: sourceCaptureWorkItems.id }).from(sourceCaptureWorkItems)
      .where(and(eq(sourceCaptureWorkItems.runId, input.runId),
        eq(sourceCaptureWorkItems.targetKey, input.targetKey), ne(sourceCaptureWorkItems.status, "completed")))
      .limit(1);
    if (incompleteWork.length > 0) {
      throw new SourceDatasetError("invalid_state", `target 仍有未完成捕获工作：${input.targetKey}`);
    }
  }
  await db.update(sourceCollectionTargetRuns).set({ status: input.status,
    finishedAt: new Date().toISOString(), terminationReason: input.terminationReason })
    .where(eq(sourceCollectionTargetRuns.id, row.id));
  const updated = await db.query.sourceCollectionTargetRuns.findFirst({
    where: eq(sourceCollectionTargetRuns.id, row.id),
  });
  return normalizeTarget(updated!);
}

async function finishRun(db: WorkbenchDb, input: Parameters<SourceDatasetModule["finishRun"]>[0]) {
  const openTargets = await db.select({ id: sourceCollectionTargetRuns.id }).from(sourceCollectionTargetRuns)
    .where(and(eq(sourceCollectionTargetRuns.runId, input.runId),
      inArray(sourceCollectionTargetRuns.status, ["pending", "running"])));
  if (openTargets.length > 0) throw new SourceDatasetError("invalid_state", "来源运行仍有未结束 target");
  if (input.status === "completed") {
    const incomplete = await db.select({ id: sourceCollectionTargetRuns.id }).from(sourceCollectionTargetRuns)
      .where(and(eq(sourceCollectionTargetRuns.runId, input.runId), ne(sourceCollectionTargetRuns.status, "completed")));
    if (incomplete.length > 0) throw new SourceDatasetError("invalid_state", "只有全部 target 完成的来源运行才能 completed");
  }
  await db.update(sourceCollectionRuns).set({ status: input.status, finishedAt: new Date().toISOString(),
    terminationReason: input.terminationReason,
    failureCategory: input.failureCategory }).where(eq(sourceCollectionRuns.id, input.runId));
  const row = await db.query.sourceCollectionRuns.findFirst({ where: eq(sourceCollectionRuns.id, input.runId) });
  if (!row) throw new SourceDatasetError("run_not_found", `来源运行不存在：${input.runId}`);
  return normalizeRun(row);
}

async function commitSnapshot(db: WorkbenchDb, store: SourceAssetStore, raw: SnapshotWrite) {
  const { assets: rawAssets, resourceReferences: rawReferences, ...snapshot } = raw;
  const input = sourceSnapshotCommitSchema.parse(snapshot);
  const assets = sourceProviderAssetSchema.array().max(20).parse(rawAssets ?? []);
  const resourceReferences = sourceProviderResourceReferenceSchema.array().parse(rawReferences ?? []);
  if (input.observation.state === "accessible" && !input.payload) {
    throw new SourceDatasetError("invalid_state", "accessible capture 必须包含原始 payload");
  }
  validateInlinePayloadHash(input);
  validateAssetBinding(input, assets);
  const prepared = await Promise.all(assets.map(async (asset) => ({ ...asset,
    casIntegrity: await store.put({ key: `${input.runId}:${input.targetKey}:${asset.assetKey}:${asset.contentHash}`,
      contentHash: asset.contentHash, content: asset.content }) })));
  await db.transaction(async (transaction) => {
    const run = await transaction.query.sourceCollectionRuns.findFirst({ where: eq(sourceCollectionRuns.id, input.runId) });
    const target = await transaction.query.sourceCollectionTargetRuns.findFirst({ where: and(
      eq(sourceCollectionTargetRuns.runId, input.runId), eq(sourceCollectionTargetRuns.targetKey, input.targetKey),
    ) });
    if (!run || run.status !== "running" || !target || target.status !== "running") {
      throw new SourceDatasetError("invalid_state", "来源运行或 target 不存在，或已经结束");
    }
    if (input.lineage) {
      const work = await transaction.query.sourceCaptureWorkItems.findFirst({ where: and(
        eq(sourceCaptureWorkItems.runId, input.runId),
        eq(sourceCaptureWorkItems.targetKey, input.targetKey),
        eq(sourceCaptureWorkItems.workKey, input.lineage.workKey),
      ) });
      if (!work) throw new SourceDatasetError("invalid_state", "Snapshot 血缘引用了不存在的捕获工作");
    }
    const objectId = await upsertObject(transaction, run.taskId, input);
    const hash = contentHash({ observation: input.observation, payload: input.payload,
      resourceReferences, lineage: input.lineage });
    const snapshotId = `source-snapshot-${randomUUID()}`;
    const inserted = await transaction.insert(sourceSnapshots).values({ id: snapshotId,
      runId: run.id, targetKey: input.targetKey, objectId, idempotencyKey: input.idempotencyKey,
      lineage: input.lineage, observation: input.observation, payload: input.payload, contentHash: hash })
      .onConflictDoNothing().returning({ id: sourceSnapshots.id });
    if (inserted.length === 0) {
      await assertIdempotentReplay(transaction, input.runId, input.idempotencyKey, hash);
      return;
    }
    if (prepared.length > 0) await transaction.insert(sourceAssets).values(prepared.map((asset) => ({
      id: `source-asset-${randomUUID()}`, snapshotId, assetKey: asset.assetKey, filename: asset.filename,
      sourceUrl: asset.sourceUrl, mediaType: asset.mediaType, contentHash: asset.contentHash,
      casIntegrity: asset.casIntegrity, bytes: asset.content.byteLength,
    })));
    if (resourceReferences.length > 0) {
      await transaction.insert(sourceResourceReferences).values(resourceReferences.map((reference) => ({
        id: `source-resource-reference-${randomUUID()}`,
        snapshotId,
        ...reference,
      })));
    }
    const counterOutcome = sourceSnapshotOutcome(input.observation);
    await incrementCounters(transaction, run.id, target.id, counterOutcome, prepared.length);
  });
  return (await loadRun(db, input.runId))!;
}

function validateInlinePayloadHash(input: SourceSnapshotCommit) {
  if (input.payload?.kind !== "inline_text") return;
  const actual = createHash("sha256").update(input.payload.text).digest("hex");
  if (actual !== input.payload.contentHash || Buffer.byteLength(input.payload.text) !== input.payload.bytes) {
    throw new SourceDatasetError("invalid_state", "inline_text payload 的字节数或内容哈希不一致");
  }
}

function validateAssetBinding(input: SourceSnapshotCommit, assets: SourceProviderAsset[]) {
  const keys = new Set(assets.map((asset) => asset.assetKey));
  if (keys.size !== assets.length) throw new SourceDatasetError("invalid_state", "同一快照包含重复 asset key");
  const payload = input.payload;
  if (payload?.kind !== "asset") {
    if (assets.length > 0) throw new SourceDatasetError("invalid_state", "非 asset payload 不得携带附件字节");
    return;
  }
  const asset = assets.find((item) => item.assetKey === payload.assetKey);
  if (!asset || assets.length !== 1) throw new SourceDatasetError("invalid_state", "asset payload 必须绑定唯一附件字节");
  if (asset.filename !== payload.filename || asset.mediaType !== payload.mediaType
    || asset.contentHash !== payload.contentHash || asset.content.byteLength !== payload.bytes) {
    throw new SourceDatasetError("invalid_state", "asset payload 与附件元数据不一致");
  }
}

async function upsertObject(transaction: WorkbenchTransaction, taskId: string, input: SourceSnapshotCommit) {
  await transaction.insert(sourceObjects).values({ id: `source-object-${randomUUID()}`, taskId, ...input.object })
    .onConflictDoNothing();
  const object = await transaction.query.sourceObjects.findFirst({ where: sql`${sourceObjects.taskId}=${taskId}
    and ${sourceObjects.sourceIdentity}=${input.object.sourceIdentity} and ${sourceObjects.kind}=${input.object.kind}
    and ${sourceObjects.externalKey}=${input.object.externalKey}` });
  if (!object) throw new Error("来源对象写入失败");
  return object.id;
}

async function assertIdempotentReplay(transaction: WorkbenchTransaction, runId: string, key: string, hash: string) {
  const existing = await transaction.query.sourceSnapshots.findFirst({ where: sql`${sourceSnapshots.runId}=${runId}
    and ${sourceSnapshots.idempotencyKey}=${key}` });
  if (!existing || existing.contentHash !== hash) throw new Error("同一幂等键对应了不同来源内容");
}

async function incrementCounters(transaction: WorkbenchTransaction, runId: string, targetId: string,
  outcome: "accepted" | "supporting" | "failed", assetCount: number) {
  const runUpdate = { snapshotCount: sql`${sourceCollectionRuns.snapshotCount} + 1`,
    accessibleCount: outcome === "accepted" ? sql`${sourceCollectionRuns.accessibleCount} + 1` : sourceCollectionRuns.accessibleCount,
    failedCount: outcome === "failed" ? sql`${sourceCollectionRuns.failedCount} + 1` : sourceCollectionRuns.failedCount,
    assetCount: assetCount > 0 ? sql`${sourceCollectionRuns.assetCount} + ${assetCount}` : sourceCollectionRuns.assetCount };
  await transaction.update(sourceCollectionRuns).set(runUpdate).where(eq(sourceCollectionRuns.id, runId));
  await transaction.update(sourceCollectionTargetRuns).set({
    snapshotCount: sql`${sourceCollectionTargetRuns.snapshotCount} + 1`,
    accessibleCount: outcome === "accepted" ? sql`${sourceCollectionTargetRuns.accessibleCount} + 1` : sourceCollectionTargetRuns.accessibleCount,
    failedCount: outcome === "failed" ? sql`${sourceCollectionTargetRuns.failedCount} + 1` : sourceCollectionTargetRuns.failedCount,
    assetCount: assetCount > 0 ? sql`${sourceCollectionTargetRuns.assetCount} + ${assetCount}` : sourceCollectionTargetRuns.assetCount,
  }).where(eq(sourceCollectionTargetRuns.id, targetId));
}

async function loadRun(db: WorkbenchDb, runId: string): Promise<SourceDatasetRunView | null> {
  const runRow = await db.query.sourceCollectionRuns.findFirst({ where: eq(sourceCollectionRuns.id, runId) });
  if (!runRow) return null;
  const [targetRows, snapshotRows, requestState] = await Promise.all([
    db.select().from(sourceCollectionTargetRuns).where(eq(sourceCollectionTargetRuns.runId, runId))
      .orderBy(asc(sourceCollectionTargetRuns.targetKey)),
    db.select().from(sourceSnapshots).where(eq(sourceSnapshots.runId, runId)).orderBy(asc(sourceSnapshots.createdAt)),
    loadSourceRequestState(db, runId),
  ]);
  const objectIds = [...new Set(snapshotRows.map((item) => item.objectId))];
  const snapshotIds = snapshotRows.map((item) => item.id);
  const [objectRows, assetRows, referenceRows] = await Promise.all([
    objectIds.length > 0 ? db.select().from(sourceObjects).where(inArray(sourceObjects.id, objectIds)) : [],
    snapshotIds.length > 0 ? db.select().from(sourceAssets).where(inArray(sourceAssets.snapshotId, snapshotIds)) : [],
    snapshotIds.length > 0 ? db.select().from(sourceResourceReferences)
      .where(inArray(sourceResourceReferences.snapshotId, snapshotIds))
      .orderBy(asc(sourceResourceReferences.ordinal)) : [],
  ]);
  const objectsById = new Map(objectRows.map((item) => [item.id, item]));
  const assetsBySnapshot = new Map<string, typeof assetRows>();
  for (const asset of assetRows) assetsBySnapshot.set(asset.snapshotId,
    [...(assetsBySnapshot.get(asset.snapshotId) ?? []), asset]);
  const referencesBySnapshot = new Map<string, typeof referenceRows>();
  for (const reference of referenceRows) referencesBySnapshot.set(reference.snapshotId,
    [...(referencesBySnapshot.get(reference.snapshotId) ?? []), reference]);
  const records = snapshotRows.flatMap((row) => {
    const object = objectsById.get(row.objectId);
    return object ? [{ object: sourceObjectSchema.parse({ ...object, createdAt: normalizeTimestamp(object.createdAt) }),
      snapshot: normalizeSnapshot(row), assets: (assetsBySnapshot.get(row.id) ?? []).map(normalizeAsset),
      resourceReferences: (referencesBySnapshot.get(row.id) ?? []).map(normalizeResourceReference) }] : [];
  });
  return sourceDatasetRunViewSchema.parse({ run: normalizeRun(runRow),
    targets: targetRows.map(normalizeTarget), ...requestState, records });
}

async function openAsset(db: WorkbenchDb, store: SourceAssetStore,
  input: { runId: string; assetId: string }) {
  const rows = await db.select({ asset: sourceAssets }).from(sourceAssets)
    .innerJoin(sourceSnapshots, eq(sourceSnapshots.id, sourceAssets.snapshotId))
    .where(and(eq(sourceAssets.id, input.assetId), eq(sourceSnapshots.runId, input.runId))).limit(1);
  if (!rows[0]) throw new SourceDatasetError("asset_not_found", `来源附件不存在：${input.assetId}`);
  const asset = normalizeAsset(rows[0].asset);
  return { asset, content: store.open(asset.casIntegrity) };
}

async function* exportRun(db: WorkbenchDb, input: { runId: string; format: "jsonl" | "csv" }) {
  const view = await loadRun(db, input.runId);
  if (!view) throw new SourceDatasetError("run_not_found", `来源运行不存在：${input.runId}`);
  yield* serializeSourceDataset(view, input.format);
}
