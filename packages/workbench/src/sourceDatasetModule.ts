import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Readable } from "node:stream";

import type { WorkbenchDb } from "@domain-analysis/db";
import {
  sourceAssets,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceObjects,
  sourceSnapshots,
} from "@domain-analysis/db";
import {
  rawSourceObservationSchema,
  rawSourcePayloadSchema,
  sourceAssetSchema,
  sourceCollectionRunSchema,
  sourceCollectionTargetRunSchema,
  sourceDatasetRunViewSchema,
  sourceObjectSchema,
  sourceProviderAssetSchema,
  sourceSnapshotCommitSchema,
  sourceSnapshotSchema,
  type SourceAccessPolicy,
  type SourceAsset,
  type SourceCollectionRun,
  type SourceCollectionTargetRun,
  type SourceDatasetRunView,
  type SourceProviderAsset,
  type SourceSnapshotCommit,
} from "@domain-analysis/shared";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { contentHash } from "./contentHash";
import { createCacacheSourceAssetStore, type SourceAssetStore } from "./sourceAssetStore";
import { serializeSourceDataset } from "./sourceDatasetExport";
import { SourceDatasetError } from "./sourceDatasetError";

type SnapshotWrite = SourceSnapshotCommit & { assets?: SourceProviderAsset[] };
type WorkbenchTransaction = Parameters<Parameters<WorkbenchDb["transaction"]>[0]>[0];

export interface SourceDatasetModule {
  listTask(taskId: string): Promise<SourceCollectionRun[]>;
  getRun(runId: string): Promise<SourceDatasetRunView | null>;
  exportRun(input: { runId: string; format: "jsonl" | "csv" }): AsyncIterable<string>;
  openAsset(input: { runId: string; assetId: string }): Promise<{ asset: SourceAsset; content: Readable }>;
  startRun(input: { taskId: string; planId: string; planVersion: number; sourceKey: string;
    providerKey: string; providerVersion: string; accessPolicy: SourceAccessPolicy; targetKeys: string[] }): Promise<SourceCollectionRun>;
  startTarget(input: { runId: string; targetKey: string }): Promise<SourceCollectionTargetRun>;
  commitSnapshot(input: SnapshotWrite): Promise<SourceDatasetRunView>;
  finishTarget(input: { runId: string; targetKey: string; status: "completed" | "failed" | "stopped";
    terminationReason?: string }): Promise<SourceCollectionTargetRun>;
  finishRun(input: { runId: string; status: "completed" | "failed" | "stopped";
    terminationReason?: string }): Promise<SourceCollectionRun>;
}

export function createSourceDatasetModule(
  db: WorkbenchDb,
  options: { assetCachePath?: string; assetStore?: SourceAssetStore } = {},
): SourceDatasetModule {
  const store = options.assetStore ?? createCacacheSourceAssetStore(
    options.assetCachePath ?? path.resolve("data", "source-assets"),
  );
  return {
    listTask: async (taskId) => (await db.select().from(sourceCollectionRuns)
      .where(eq(sourceCollectionRuns.taskId, taskId)).orderBy(desc(sourceCollectionRuns.startedAt)))
      .map(normalizeRun),
    getRun: (runId) => loadRun(db, runId),
    exportRun: (input) => exportRun(db, input),
    openAsset: (input) => openAsset(db, store, input),
    startRun: (input) => startRun(db, input),
    startTarget: (input) => startTarget(db, input),
    commitSnapshot: (input) => commitSnapshot(db, store, input),
    finishTarget: (input) => finishTarget(db, input),
    finishRun: (input) => finishRun(db, input),
  };
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
    sourceCollectionPlanId: input.planId, sourceCollectionPlanSourceKey: input.sourceKey,
    sourceCollectionPlanVersion: input.planVersion, providerKey: input.providerKey,
    providerVersion: input.providerVersion, accessPolicy: input.accessPolicy,
    status: "running" as const, startedAt: new Date().toISOString() };
  await db.transaction(async (transaction) => {
    await transaction.insert(sourceCollectionRuns).values(row);
    await transaction.insert(sourceCollectionTargetRuns).values(targetKeys.map((targetKey) => ({
      id: `source-target-run-${randomUUID()}`, runId: row.id, targetKey, status: "pending" as const,
    })));
  });
  return normalizeRun((await db.query.sourceCollectionRuns.findFirst({
    where: eq(sourceCollectionRuns.id, row.id),
  }))!);
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
    terminationReason: input.terminationReason }).where(eq(sourceCollectionRuns.id, input.runId));
  const row = await db.query.sourceCollectionRuns.findFirst({ where: eq(sourceCollectionRuns.id, input.runId) });
  if (!row) throw new SourceDatasetError("run_not_found", `来源运行不存在：${input.runId}`);
  return normalizeRun(row);
}

async function commitSnapshot(db: WorkbenchDb, store: SourceAssetStore, raw: SnapshotWrite) {
  const { assets: rawAssets, ...snapshot } = raw;
  const input = sourceSnapshotCommitSchema.parse(snapshot);
  const assets = sourceProviderAssetSchema.array().max(20).parse(rawAssets ?? []);
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
    const objectId = await upsertObject(transaction, run.taskId, input);
    const hash = contentHash({ observation: input.observation, payload: input.payload });
    const snapshotId = `source-snapshot-${randomUUID()}`;
    const inserted = await transaction.insert(sourceSnapshots).values({ id: snapshotId,
      runId: run.id, targetKey: input.targetKey, objectId, idempotencyKey: input.idempotencyKey,
      observation: input.observation, payload: input.payload, contentHash: hash })
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
    await incrementCounters(transaction, run.id, target.id,
      input.observation.state === "accessible", prepared.length);
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
  accessible: boolean, assetCount: number) {
  const runUpdate = { snapshotCount: sql`${sourceCollectionRuns.snapshotCount} + 1`,
    accessibleCount: accessible ? sql`${sourceCollectionRuns.accessibleCount} + 1` : sourceCollectionRuns.accessibleCount,
    failedCount: accessible ? sourceCollectionRuns.failedCount : sql`${sourceCollectionRuns.failedCount} + 1`,
    assetCount: assetCount > 0 ? sql`${sourceCollectionRuns.assetCount} + ${assetCount}` : sourceCollectionRuns.assetCount };
  await transaction.update(sourceCollectionRuns).set(runUpdate).where(eq(sourceCollectionRuns.id, runId));
  await transaction.update(sourceCollectionTargetRuns).set({
    snapshotCount: sql`${sourceCollectionTargetRuns.snapshotCount} + 1`,
    accessibleCount: accessible ? sql`${sourceCollectionTargetRuns.accessibleCount} + 1` : sourceCollectionTargetRuns.accessibleCount,
    failedCount: accessible ? sourceCollectionTargetRuns.failedCount : sql`${sourceCollectionTargetRuns.failedCount} + 1`,
    assetCount: assetCount > 0 ? sql`${sourceCollectionTargetRuns.assetCount} + ${assetCount}` : sourceCollectionTargetRuns.assetCount,
  }).where(eq(sourceCollectionTargetRuns.id, targetId));
}

async function loadRun(db: WorkbenchDb, runId: string): Promise<SourceDatasetRunView | null> {
  const runRow = await db.query.sourceCollectionRuns.findFirst({ where: eq(sourceCollectionRuns.id, runId) });
  if (!runRow) return null;
  const [targetRows, snapshotRows] = await Promise.all([
    db.select().from(sourceCollectionTargetRuns).where(eq(sourceCollectionTargetRuns.runId, runId))
      .orderBy(asc(sourceCollectionTargetRuns.targetKey)),
    db.select().from(sourceSnapshots).where(eq(sourceSnapshots.runId, runId)).orderBy(asc(sourceSnapshots.createdAt)),
  ]);
  const objectIds = [...new Set(snapshotRows.map((item) => item.objectId))];
  const snapshotIds = snapshotRows.map((item) => item.id);
  const [objectRows, assetRows] = await Promise.all([
    objectIds.length > 0 ? db.select().from(sourceObjects).where(inArray(sourceObjects.id, objectIds)) : [],
    snapshotIds.length > 0 ? db.select().from(sourceAssets).where(inArray(sourceAssets.snapshotId, snapshotIds)) : [],
  ]);
  const objectsById = new Map(objectRows.map((item) => [item.id, item]));
  const assetsBySnapshot = new Map<string, typeof assetRows>();
  for (const asset of assetRows) assetsBySnapshot.set(asset.snapshotId,
    [...(assetsBySnapshot.get(asset.snapshotId) ?? []), asset]);
  const records = snapshotRows.flatMap((row) => {
    const object = objectsById.get(row.objectId);
    return object ? [{ object: sourceObjectSchema.parse({ ...object, createdAt: normalizeTimestamp(object.createdAt) }),
      snapshot: normalizeSnapshot(row), assets: (assetsBySnapshot.get(row.id) ?? []).map(normalizeAsset) }] : [];
  });
  return sourceDatasetRunViewSchema.parse({ run: normalizeRun(runRow),
    targets: targetRows.map(normalizeTarget), records });
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

function normalizeRun(row: typeof sourceCollectionRuns.$inferSelect) {
  return sourceCollectionRunSchema.parse({ ...row,
    sourceCollectionPlanId: row.sourceCollectionPlanId ?? undefined,
    sourceCollectionPlanSourceKey: row.sourceCollectionPlanSourceKey ?? undefined,
    sourceCollectionPlanVersion: row.sourceCollectionPlanVersion ?? undefined,
    providerVersion: row.providerVersion ?? undefined, startedAt: normalizeTimestamp(row.startedAt),
    finishedAt: row.finishedAt ? normalizeTimestamp(row.finishedAt) : undefined,
    terminationReason: row.terminationReason ?? undefined });
}

function normalizeTarget(row: typeof sourceCollectionTargetRuns.$inferSelect) {
  return sourceCollectionTargetRunSchema.parse({ ...row,
    startedAt: row.startedAt ? normalizeTimestamp(row.startedAt) : undefined,
    finishedAt: row.finishedAt ? normalizeTimestamp(row.finishedAt) : undefined,
    terminationReason: row.terminationReason ?? undefined });
}

function normalizeSnapshot(row: typeof sourceSnapshots.$inferSelect) {
  const rawObservation = row.observation as Record<string, unknown>;
  const legacyHttp = rawObservation.httpValidation as { status?: number } | undefined;
  const observation = rawSourceObservationSchema.parse({ requestedUrl: rawObservation.requestedUrl,
    finalUrl: rawObservation.finalUrl ?? undefined, observedAt: rawObservation.observedAt,
    state: normalizeState(rawObservation.state), httpStatus: rawObservation.httpStatus ?? legacyHttp?.status,
    responseHeaders: rawObservation.responseHeaders ?? {},
    error: rawObservation.error ?? rawObservation.failureDetail ?? undefined });
  const parsedPayload = rawSourcePayloadSchema.safeParse(row.payload);
  return sourceSnapshotSchema.parse({ id: row.id, runId: row.runId, targetKey: row.targetKey ?? undefined,
    objectId: row.objectId, idempotencyKey: row.idempotencyKey, observation,
    payload: row.payload == null ? undefined : parsedPayload.success ? parsedPayload.data
      : { kind: "legacy_structured_json", value: row.payload }, contentHash: row.contentHash,
    createdAt: normalizeTimestamp(row.createdAt) });
}

function normalizeAsset(row: typeof sourceAssets.$inferSelect) {
  return sourceAssetSchema.parse({ ...row, createdAt: normalizeTimestamp(row.createdAt) });
}

function normalizeState(value: unknown) {
  const states = ["accessible", "login_required", "verification_required", "access_denied", "rate_limited", "not_found", "source_error"] as const;
  return states.find((state) => state === String(value)) ?? "source_error";
}

function normalizeTimestamp(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
