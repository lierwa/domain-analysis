import type { WorkbenchDb } from "@domain-analysis/db";
import {
  sourceAssets,
  sourceCaptureWorkItems,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceObjects,
  sourceResourceReferences,
  sourceSnapshots,
} from "@domain-analysis/db";
import {
  sourceDatasetRunAuditViewSchema,
  sourceDatasetRunViewSchema,
  sourceObjectSchema,
  type SourceDatasetRunAuditView,
  type SourceDatasetRunView,
} from "@domain-analysis/shared";
import { asc, eq, inArray, sql } from "drizzle-orm";

import { serializeSourceDataset } from "./sourceDatasetExport";
import { SourceDatasetError } from "./sourceDatasetError";
import {
  normalizeAsset,
  normalizeResourceReference,
  normalizeRun,
  normalizeSnapshot,
  normalizeTarget,
  normalizeTimestamp,
} from "./sourceDatasetNormalization";
import { loadSourceRequestState } from "./sourceRequestAdmission";

export async function loadSourceDatasetRun(
  db: WorkbenchDb,
  runId: string,
): Promise<SourceDatasetRunView | null> {
  const runRow = await db.query.sourceCollectionRuns.findFirst({ where: eq(sourceCollectionRuns.id, runId) });
  if (!runRow) return null;
  const [targetRows, snapshotRows, requestState] = await Promise.all([
    db.select().from(sourceCollectionTargetRuns).where(eq(sourceCollectionTargetRuns.runId, runId))
      .orderBy(asc(sourceCollectionTargetRuns.targetKey)),
    db.select().from(sourceSnapshots).where(eq(sourceSnapshots.runId, runId))
      .orderBy(asc(sourceSnapshots.createdAt)),
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

export async function loadSourceDatasetRunAudit(
  db: WorkbenchDb,
  runId: string,
): Promise<SourceDatasetRunAuditView | null> {
  const runRow = await db.query.sourceCollectionRuns.findFirst({ where: eq(sourceCollectionRuns.id, runId) });
  if (!runRow) return null;
  const [targetRows, requestState, groups] = await Promise.all([
    db.select().from(sourceCollectionTargetRuns).where(eq(sourceCollectionTargetRuns.runId, runId))
      .orderBy(asc(sourceCollectionTargetRuns.targetKey)),
    loadSourceRequestState(db, runId),
    db.select({ targetKey: sourceCaptureWorkItems.targetKey,
      resourceKind: sourceCaptureWorkItems.resourceKind,
      totalCount: sql<number>`count(${sourceSnapshots.id})::int` })
      .from(sourceCaptureWorkItems)
      .leftJoin(sourceSnapshots, eq(sourceSnapshots.captureWorkItemId, sourceCaptureWorkItems.id))
      .where(eq(sourceCaptureWorkItems.runId, runId))
      .groupBy(sourceCaptureWorkItems.targetKey, sourceCaptureWorkItems.resourceKind),
  ]);
  return sourceDatasetRunAuditViewSchema.parse({
    run: normalizeRun(runRow), targets: targetRows.map(normalizeTarget), ...requestState,
    recordGroups: groups.map((group) => ({ targetKey: group.targetKey,
      resourceKind: group.resourceKind ?? undefined, totalCount: Number(group.totalCount) })),
  });
}

export async function* exportSourceDatasetRun(
  db: WorkbenchDb,
  input: { runId: string; format: "jsonl" | "csv" },
) {
  const view = await loadSourceDatasetRun(db, input.runId);
  if (!view) throw new SourceDatasetError("run_not_found", `来源运行不存在：${input.runId}`);
  yield* serializeSourceDataset(view, input.format);
}
