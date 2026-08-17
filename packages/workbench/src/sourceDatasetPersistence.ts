import {
  sourceAssetSchema,
  sourceCollectionPlanSchema,
  sourceCollectionRunSchema,
  sourceObjectSchema,
  sourceSnapshotRecordSchema,
  sourceSnapshotSchema,
  type CommitSourceAsset,
  type CommitSourceSnapshot,
} from "@domain-analysis/shared";
import {
  sourceAssets,
  sourceCollectionPlans,
  sourceCollectionRuns,
  sourceObjects,
  sourceSnapshots,
  type ProductKnowledgeDb,
} from "@domain-analysis/db";
import { and, eq } from "drizzle-orm";

import { contentHash } from "./contentHash";
import { SourceDatasetError } from "./sourceDatasetError";

type SourceDatasetDb = Pick<ProductKnowledgeDb, "query" | "insert" | "update" | "select">;
type SourceDatasetCreateId = (
  kind: "plan" | "run" | "object" | "snapshot" | "asset",
) => string;

export function requireAssetReference(
  content: typeof sourceSnapshots.$inferSelect.content,
  input: CommitSourceAsset,
) {
  const blocks = content?.kind === "ordered_record"
    ? content.blocks
    : content?.kind === "document"
      ? content.sections.flatMap((section) => section.blocks)
      : [];
  const reference = blocks.find((block) => block.kind === "asset_ref"
    && block.assetKey === input.assetKey);
  if (!reference || reference.kind !== "asset_ref"
    || reference.sourceUrl !== input.sourceUrl || reference.role !== input.purpose) {
    throw new SourceDatasetError("asset_reference_not_found", "附件没有匹配快照中的 asset_ref");
  }
}

export function requireMatchingAsset(
  asset: typeof sourceAssets.$inferSelect,
  contentHashValue: string,
) {
  if (asset.contentHash !== contentHashValue) {
    throw new SourceDatasetError("idempotency_conflict", "相同附件键提交了不同字节");
  }
  return normalizeAsset(asset);
}

export async function findOrCreateObject(
  db: SourceDatasetDb,
  projectId: string,
  input: CommitSourceSnapshot,
  now: () => Date,
  createId: SourceDatasetCreateId,
) {
  const match = and(
    eq(sourceObjects.projectId, projectId),
    eq(sourceObjects.sourceIdentity, input.object.sourceIdentity),
    eq(sourceObjects.kind, input.object.kind),
    eq(sourceObjects.externalKey, input.object.externalKey),
  );
  const existing = await db.query.sourceObjects.findFirst({ where: match });
  if (existing) return normalizeObject(existing);
  const object = sourceObjectSchema.parse({
    id: createId("object"),
    projectId,
    sourceIdentity: input.object.sourceIdentity,
    kind: input.object.kind,
    externalKey: input.object.externalKey,
    createdAt: now().toISOString(),
  });
  const inserted = await db.insert(sourceObjects).values(object)
    .onConflictDoNothing().returning({ id: sourceObjects.id });
  if (inserted.length > 0) return object;
  const raced = await db.query.sourceObjects.findFirst({ where: match });
  if (!raced) throw new Error("对象幂等冲突后无法读取来源对象");
  return normalizeObject(raced);
}

export function findRun(db: SourceDatasetDb, runId: string) {
  return db.query.sourceCollectionRuns.findFirst({
    where: eq(sourceCollectionRuns.id, runId),
  });
}

export function findSnapshotByIdempotency(
  db: SourceDatasetDb,
  runId: string,
  idempotencyKey: string,
) {
  return db.query.sourceSnapshots.findFirst({
    where: and(
      eq(sourceSnapshots.runId, runId),
      eq(sourceSnapshots.idempotencyKey, idempotencyKey),
    ),
  });
}

export async function requireMatchingIdempotency(
  db: SourceDatasetDb,
  snapshot: typeof sourceSnapshots.$inferSelect,
  inputHash: string,
) {
  if (snapshot.contentHash !== inputHash) {
    throw new SourceDatasetError(
      "idempotency_conflict",
      `相同幂等键提交了不同来源内容：${snapshot.idempotencyKey}`,
    );
  }
  const object = await db.query.sourceObjects.findFirst({
    where: eq(sourceObjects.id, snapshot.objectId),
  });
  if (!object) throw new Error(`来源快照引用了不存在的对象：${snapshot.objectId}`);
  return sourceSnapshotRecordSchema.parse({
    object: normalizeObject(object),
    snapshot: normalizeSnapshot(snapshot),
    assets: [],
  });
}

export function sourceSnapshotInputHash(input: CommitSourceSnapshot) {
  const { runId: _runId, idempotencyKey: _idempotencyKey, ...content } = input;
  return contentHash(content);
}

export function normalizeRun(row: typeof sourceCollectionRuns.$inferSelect) {
  return sourceCollectionRunSchema.parse({
    ...row,
    sourceCollectionPlanId: row.sourceCollectionPlanId ?? undefined,
    sourceCollectionPlanBatchKey: row.sourceCollectionPlanBatchKey ?? undefined,
    startedAt: normalizeTimestamp(row.startedAt),
    finishedAt: row.finishedAt ? normalizeTimestamp(row.finishedAt) : undefined,
    terminationReason: row.terminationReason ?? undefined,
  });
}

export function normalizePlan(row: typeof sourceCollectionPlans.$inferSelect) {
  return sourceCollectionPlanSchema.parse({
    ...row,
    createdAt: normalizeTimestamp(row.createdAt),
  });
}

export function normalizeObject(row: typeof sourceObjects.$inferSelect) {
  return sourceObjectSchema.parse({ ...row, createdAt: normalizeTimestamp(row.createdAt) });
}

export function normalizeSnapshot(row: typeof sourceSnapshots.$inferSelect) {
  return sourceSnapshotSchema.parse({
    id: row.id,
    runId: row.runId,
    objectId: row.objectId,
    idempotencyKey: row.idempotencyKey,
    targetKeys: row.targetKeys ?? undefined,
    knowledgeNeedIds: row.knowledgeNeedIds ?? undefined,
    observation: row.observation,
    content: row.content ?? undefined,
    parsing: row.parsing,
    claimScopes: row.claimScopes,
    usagePermission: row.usagePermission,
    relations: row.relations,
    contentHash: row.contentHash,
    createdAt: normalizeTimestamp(row.createdAt),
  });
}

export function normalizeAsset(row: typeof sourceAssets.$inferSelect) {
  return sourceAssetSchema.parse({
    ...row,
    dimensions: row.dimensions ?? undefined,
    createdAt: normalizeTimestamp(row.createdAt),
  });
}

function normalizeTimestamp(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
