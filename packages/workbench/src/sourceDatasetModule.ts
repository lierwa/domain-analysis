import {
  rawSourceObservationSchema,
  rawSourcePayloadSchema,
  sourceAssetSchema,
  sourceCollectionRunSchema,
  sourceDatasetRunViewSchema,
  sourceObjectSchema,
  sourceSnapshotSchema,
  type SourceCollectionRun,
  type SourceDatasetRunView,
} from "@domain-analysis/shared";
import type { WorkbenchDb } from "@domain-analysis/db";
import { sourceAssets, sourceCollectionRuns, sourceObjects, sourceSnapshots } from "@domain-analysis/db";
import { asc, desc, eq, inArray } from "drizzle-orm";

import { serializeSourceDataset } from "./sourceDatasetExport";

export interface SourceDatasetModule {
  listTask(taskId: string): Promise<SourceCollectionRun[]>;
  getRun(runId: string): Promise<SourceDatasetRunView | null>;
  exportRun(input: { runId: string; format: "jsonl" | "csv" }): AsyncIterable<string>;
}

export function createSourceDatasetModule(db: WorkbenchDb): SourceDatasetModule {
  return {
    listTask: async (taskId) => (await db.select().from(sourceCollectionRuns)
      .where(eq(sourceCollectionRuns.taskId, taskId)).orderBy(desc(sourceCollectionRuns.startedAt)))
      .map(normalizeRun),
    getRun: (runId) => loadRun(db, runId),
    exportRun: (input) => exportRun(db, input),
  };
}

async function loadRun(db: WorkbenchDb, runId: string): Promise<SourceDatasetRunView | null> {
  const runRow = await db.query.sourceCollectionRuns.findFirst({ where: eq(sourceCollectionRuns.id, runId) });
  if (!runRow) return null;
  const snapshotRows = await db.select().from(sourceSnapshots)
    .where(eq(sourceSnapshots.runId, runId)).orderBy(asc(sourceSnapshots.createdAt));
  const objectIds = [...new Set(snapshotRows.map((item) => item.objectId))];
  const snapshotIds = snapshotRows.map((item) => item.id);
  const [objectRows, assetRows] = await Promise.all([
    objectIds.length > 0 ? db.select().from(sourceObjects).where(inArray(sourceObjects.id, objectIds)) : [],
    snapshotIds.length > 0 ? db.select().from(sourceAssets).where(inArray(sourceAssets.snapshotId, snapshotIds)) : [],
  ]);
  const objectsById = new Map(objectRows.map((item) => [item.id, item]));
  const assetsBySnapshot = new Map<string, typeof assetRows>();
  for (const asset of assetRows) {
    const items = assetsBySnapshot.get(asset.snapshotId) ?? [];
    items.push(asset);
    assetsBySnapshot.set(asset.snapshotId, items);
  }
  const records = snapshotRows.flatMap((row) => {
    const object = objectsById.get(row.objectId);
    if (!object) return [];
    return [{
      object: sourceObjectSchema.parse({ ...object, createdAt: normalizeTimestamp(object.createdAt) }),
      snapshot: normalizeSnapshot(row),
      assets: (assetsBySnapshot.get(row.id) ?? []).map((asset) => sourceAssetSchema.parse({
        ...asset,
        createdAt: normalizeTimestamp(asset.createdAt),
      })),
    }];
  });
  return sourceDatasetRunViewSchema.parse({ run: normalizeRun(runRow), records });
}

async function* exportRun(
  db: WorkbenchDb,
  input: { runId: string; format: "jsonl" | "csv" },
) {
  const view = await loadRun(db, input.runId);
  if (!view) throw new Error(`来源运行不存在：${input.runId}`);
  yield* serializeSourceDataset(view, input.format);
}

function normalizeRun(row: typeof sourceCollectionRuns.$inferSelect) {
  return sourceCollectionRunSchema.parse({
    ...row,
    sourceCollectionPlanId: row.sourceCollectionPlanId ?? undefined,
    sourceCollectionPlanSourceKey: row.sourceCollectionPlanSourceKey ?? undefined,
    startedAt: normalizeTimestamp(row.startedAt),
    finishedAt: row.finishedAt ? normalizeTimestamp(row.finishedAt) : undefined,
    terminationReason: row.terminationReason ?? undefined,
  });
}

function normalizeSnapshot(row: typeof sourceSnapshots.$inferSelect) {
  const rawObservation = row.observation as Record<string, unknown>;
  const legacyHttp = rawObservation.httpValidation as { status?: number } | undefined;
  const state = normalizeState(rawObservation.state);
  const observation = rawSourceObservationSchema.parse({
    requestedUrl: rawObservation.requestedUrl,
    finalUrl: rawObservation.finalUrl ?? undefined,
    observedAt: rawObservation.observedAt,
    state,
    httpStatus: rawObservation.httpStatus ?? legacyHttp?.status,
    responseHeaders: rawObservation.responseHeaders ?? {},
    error: rawObservation.error ?? rawObservation.failureDetail ?? undefined,
  });
  const parsedPayload = rawSourcePayloadSchema.safeParse(row.payload);
  return sourceSnapshotSchema.parse({
    id: row.id, runId: row.runId, objectId: row.objectId, idempotencyKey: row.idempotencyKey,
    observation,
    payload: row.payload == null ? undefined : parsedPayload.success
      ? parsedPayload.data
      : { kind: "legacy_structured_json", value: row.payload },
    contentHash: row.contentHash,
    createdAt: normalizeTimestamp(row.createdAt),
  });
}

function normalizeState(value: unknown) {
  const states = ["accessible", "login_required", "verification_required", "access_denied", "not_found", "source_error"] as const;
  return states.find((state) => state === String(value)) ?? "source_error";
}

function normalizeTimestamp(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
