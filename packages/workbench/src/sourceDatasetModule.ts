import { createHash, randomUUID } from "node:crypto";

import {
  commitSourceSnapshotSchema,
  commitSourceAssetSchema,
  finishSourceCollectionRunSchema,
  exportSourceCollectionRunSchema,
  sourceCollectionPlanContentSchema,
  sourceCollectionPlanSchema,
  sourceCollectionRunSchema,
  sourceCollectionRunViewSchema,
  sourceAssetSchema,
  sourceObjectSchema,
  sourceSnapshotRecordSchema,
  sourceSnapshotSchema,
  startSourceCollectionRunSchema,
  type CommitSourceSnapshot,
  type CommitSourceAsset,
  type FinishSourceCollectionRun,
  type ExportSourceCollectionRun,
  type SourceCollectionPlan,
  type SourceCollectionPlanContent,
  type SourceCollectionRun,
  type SourceCollectionRunView,
  type SourceAsset,
  type SourceSnapshotRecord,
  type StartSourceCollectionRun,
} from "@domain-analysis/shared";
import {
  sourceCollectionRuns,
  sourceCollectionPlans,
  sourceAssets,
  sourceObjects,
  sourceSnapshots,
  type ProductKnowledgeDb,
} from "@domain-analysis/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { contentHash } from "./contentHash";
import type { ContentAddressedStore } from "./cacacheContentStore";
import type { ProductProjectModule } from "./productProjectModule";
import { serializeSourceCollectionRun } from "./sourceDatasetExport";
import { SourceDatasetError } from "./sourceDatasetError";
import {
  findOrCreateObject,
  findRun,
  findSnapshotByIdempotency,
  normalizeAsset,
  normalizeObject,
  normalizePlan,
  normalizeRun,
  normalizeSnapshot,
  requireAssetReference,
  requireMatchingAsset,
  requireMatchingIdempotency,
  sourceSnapshotInputHash,
} from "./sourceDatasetPersistence";

export { SourceDatasetError } from "./sourceDatasetError";
export type { SourceDatasetErrorCode } from "./sourceDatasetError";

export interface SourceDatasetModule {
  savePlan(input: SaveSourceCollectionPlan): Promise<SourceCollectionPlan>;
  getPlan(planId: string): Promise<SourceCollectionPlan | null>;
  listPlans(projectId: string): Promise<SourceCollectionPlan[]>;
  startRun(input: StartSourceCollectionRun): Promise<SourceCollectionRun>;
  commitSnapshot(input: CommitSourceSnapshot): Promise<SourceSnapshotRecord>;
  commitAsset(input: CommitSourceAsset, content: Uint8Array): Promise<SourceAsset>;
  finishRun(input: FinishSourceCollectionRun): Promise<SourceCollectionRun>;
  getRun(runId: string): Promise<SourceCollectionRunView | null>;
  getSnapshot(snapshotId: string): Promise<SourceSnapshotRecord | null>;
  listProject(projectId: string): Promise<SourceCollectionRun[]>;
  exportRun(input: ExportSourceCollectionRun): AsyncIterable<string>;
}

export interface SourceDatasetModuleOptions {
  now?: () => Date;
  createId?: (kind: "plan" | "run" | "object" | "snapshot" | "asset") => string;
  maximumAssetBytes?: number;
}

export interface SaveSourceCollectionPlan {
  projectId: string;
  content: SourceCollectionPlanContent;
}

export function createSourceDatasetModule(
  db: ProductKnowledgeDb,
  projects: ProductProjectModule,
  contentStore: ContentAddressedStore,
  options: SourceDatasetModuleOptions = {},
): SourceDatasetModule {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((kind) => `${kind}-${randomUUID()}`);
  return {
    savePlan: (input) => savePlan(db, projects, input, now, createId),
    getPlan: (planId) => getPlan(db, planId),
    listPlans: (projectId) => listPlans(db, projectId),
    startRun: (input) => startRun(db, projects, input, now, createId),
    commitSnapshot: (input) => commitSnapshot(db, input, now, createId),
    commitAsset: (input, content) => commitAsset(
      db,
      contentStore,
      input,
      content,
      options.maximumAssetBytes ?? 20 * 1024 * 1024,
      now,
      createId,
    ),
    finishRun: (input) => finishRun(db, input, now),
    getRun: (runId) => getRun(db, runId),
    getSnapshot: (snapshotId) => getSnapshot(db, snapshotId),
    listProject: (projectId) => listProject(db, projectId),
    exportRun: (input) => exportRun(db, input),
  };
}

async function getSnapshot(
  db: ProductKnowledgeDb,
  snapshotId: string,
): Promise<SourceSnapshotRecord | null> {
  const row = await db.select({ snapshot: sourceSnapshots, object: sourceObjects })
    .from(sourceSnapshots)
    .innerJoin(sourceObjects, eq(sourceSnapshots.objectId, sourceObjects.id))
    .where(eq(sourceSnapshots.id, snapshotId));
  const match = row[0];
  if (!match) return null;
  const assets = await db.select().from(sourceAssets)
    .where(eq(sourceAssets.snapshotId, snapshotId))
    .orderBy(asc(sourceAssets.position), asc(sourceAssets.id));
  return sourceSnapshotRecordSchema.parse({
    object: normalizeObject(match.object),
    snapshot: normalizeSnapshot(match.snapshot),
    assets: assets.map(normalizeAsset),
  });
}

async function savePlan(
  db: ProductKnowledgeDb,
  projects: ProductProjectModule,
  rawInput: SaveSourceCollectionPlan,
  now: () => Date,
  createId: NonNullable<SourceDatasetModuleOptions["createId"]>,
) {
  const content = sourceCollectionPlanContentSchema.parse(rawInput.content);
  const project = await projects.get(rawInput.projectId);
  if (!project || project.project.status !== "ready") {
    throw new SourceDatasetError("project_not_confirmed", "来源计划只能绑定已确认项目");
  }
  const contentHashValue = contentHash({
    projectRevision: project.project.revision,
    categoryDefinitionVersionId: project.categoryDefinition.id,
    confirmedScopeVersionId: project.confirmedScope.id,
    collectionBoardVersionId: project.collectionBoard.id,
    content,
  });
  const existing = await db.query.sourceCollectionPlans.findFirst({
    where: and(
      eq(sourceCollectionPlans.projectId, rawInput.projectId),
      eq(sourceCollectionPlans.contentHash, contentHashValue),
    ),
  });
  if (existing) return normalizePlan(existing);
  const plan = sourceCollectionPlanSchema.parse({
    id: createId("plan"),
    projectId: rawInput.projectId,
    projectRevision: project.project.revision,
    categoryDefinitionVersionId: project.categoryDefinition.id,
    confirmedScopeVersionId: project.confirmedScope.id,
    collectionBoardVersionId: project.collectionBoard.id,
    contentHash: contentHashValue,
    content,
    createdAt: now().toISOString(),
  });
  const inserted = await db.insert(sourceCollectionPlans).values(plan)
    .onConflictDoNothing().returning();
  if (inserted[0]) return normalizePlan(inserted[0]);
  const raced = await db.query.sourceCollectionPlans.findFirst({
    where: and(
      eq(sourceCollectionPlans.projectId, rawInput.projectId),
      eq(sourceCollectionPlans.contentHash, contentHashValue),
    ),
  });
  if (!raced) throw new Error("来源计划幂等冲突后无法读取");
  return normalizePlan(raced);
}

async function getPlan(db: ProductKnowledgeDb, planId: string) {
  const row = await db.query.sourceCollectionPlans.findFirst({
    where: eq(sourceCollectionPlans.id, planId),
  });
  return row ? normalizePlan(row) : null;
}

async function listPlans(db: ProductKnowledgeDb, projectId: string) {
  const rows = await db.select().from(sourceCollectionPlans)
    .where(eq(sourceCollectionPlans.projectId, projectId))
    .orderBy(desc(sourceCollectionPlans.createdAt), desc(sourceCollectionPlans.id));
  return rows.map(normalizePlan);
}

async function listProject(db: ProductKnowledgeDb, projectId: string) {
  const rows = await db.select().from(sourceCollectionRuns)
    .where(eq(sourceCollectionRuns.projectId, projectId))
    .orderBy(desc(sourceCollectionRuns.startedAt), desc(sourceCollectionRuns.id));
  return rows.map(normalizeRun);
}

async function* exportRun(
  db: ProductKnowledgeDb,
  rawInput: ExportSourceCollectionRun,
): AsyncIterable<string> {
  const input = exportSourceCollectionRunSchema.parse(rawInput);
  const view = await getRun(db, input.runId);
  if (!view) throw new SourceDatasetError("run_not_found", `来源运行不存在：${input.runId}`);
  yield* serializeSourceCollectionRun(view, input.format);
}

async function startRun(
  db: ProductKnowledgeDb,
  projects: ProductProjectModule,
  rawInput: StartSourceCollectionRun,
  now: () => Date,
  createId: NonNullable<SourceDatasetModuleOptions["createId"]>,
) {
  const input = startSourceCollectionRunSchema.parse(rawInput);
  const project = await projects.get(input.projectId);
  if (!project || project.project.status !== "ready") {
    throw new SourceDatasetError("project_not_confirmed", "来源运行只能绑定已确认项目");
  }
  const lane = project.collectionBoard.lanes.find((candidate) =>
    candidate.id === input.collectionLaneId);
  if (!lane) {
    throw new SourceDatasetError("collection_lane_not_found", "来源运行没有绑定当前搜集板路线");
  }
  if (input.sourceCollectionPlanId) {
    if (!input.sourceCollectionPlanBatchKey) {
      throw new SourceDatasetError("plan_mismatch", "Planner 来源运行必须绑定计划批次");
    }
    const plan = await getPlan(db, input.sourceCollectionPlanId);
    if (!plan) throw new SourceDatasetError("plan_not_found", "来源运行绑定的计划不存在");
    const matchesProject = plan.projectId === input.projectId
      && plan.projectRevision === project.project.revision
      && plan.collectionBoardVersionId === project.collectionBoard.id;
    const matchesBatch = plan.content.lanes.some((plannedLane) =>
      plannedLane.collectionLaneId === input.collectionLaneId
      && plannedLane.batches.some((batch) =>
        batch.key === input.sourceCollectionPlanBatchKey
        &&
        batch.providerKey === input.providerKey
        && contentHash(batch.accessPolicy) === contentHash(input.accessPolicy)));
    if (!matchesProject || !matchesBatch) {
      throw new SourceDatasetError("plan_mismatch", "来源运行与冻结计划不一致");
    }
    const existing = await db.query.sourceCollectionRuns.findFirst({
      where: and(
        eq(sourceCollectionRuns.sourceCollectionPlanId, input.sourceCollectionPlanId),
        eq(sourceCollectionRuns.sourceCollectionPlanBatchKey, input.sourceCollectionPlanBatchKey),
        inArray(sourceCollectionRuns.status, ["running", "completed"]),
      ),
      orderBy: [desc(sourceCollectionRuns.startedAt)],
    });
    if (existing) return normalizeRun(existing);
  }
  const run = sourceCollectionRunSchema.parse({
    ...input,
    id: createId("run"),
    categoryDefinitionVersionId: project.categoryDefinition.id,
    confirmedScopeVersionId: project.confirmedScope.id,
    collectionBoardVersionId: project.collectionBoard.id,
    categoryCode: project.categoryDefinition.categoryCode,
    sourceAuthorityType: lane.sourceAuthorityType,
    status: "running",
    snapshotCount: 0,
    accessibleCount: 0,
    failedCount: 0,
    assetCount: 0,
    startedAt: now().toISOString(),
  });
  await db.insert(sourceCollectionRuns).values(run);
  return run;
}

async function commitSnapshot(
  db: ProductKnowledgeDb,
  rawInput: CommitSourceSnapshot,
  now: () => Date,
  createId: NonNullable<SourceDatasetModuleOptions["createId"]>,
) {
  const input = commitSourceSnapshotSchema.parse(rawInput);
  const run = await findRun(db, input.runId);
  if (!run) throw new SourceDatasetError("run_not_found", `来源运行不存在：${input.runId}`);
  if (run.status !== "running") {
    throw new SourceDatasetError("run_closed", `来源运行已经结束：${input.runId}`);
  }
  const inputHash = sourceSnapshotInputHash(input);
  const existing = await findSnapshotByIdempotency(db, input.runId, input.idempotencyKey);
  if (existing) return requireMatchingIdempotency(db, existing, inputHash);

  return db.transaction(async (transaction) => {
    const object = await findOrCreateObject(transaction, run.projectId, input, now, createId);
    const snapshot = sourceSnapshotSchema.parse({
      id: createId("snapshot"),
      runId: input.runId,
      objectId: object.id,
      idempotencyKey: input.idempotencyKey,
      observation: input.observation,
      targetKeys: input.targetKeys,
      knowledgeNeedIds: input.knowledgeNeedIds,
      content: input.content,
      parsing: input.parsing,
      claimScopes: input.claimScopes,
      usagePermission: input.usagePermission,
      relations: input.relations,
      contentHash: inputHash,
      createdAt: now().toISOString(),
    });
    const inserted = await transaction.insert(sourceSnapshots).values({
      ...snapshot,
      content: snapshot.content ?? null,
      observedAt: snapshot.observation.observedAt,
      state: snapshot.observation.state,
    }).onConflictDoNothing().returning({ id: sourceSnapshots.id });
    if (inserted.length === 0) {
      const raced = await findSnapshotByIdempotency(
        transaction,
        input.runId,
        input.idempotencyKey,
      );
      if (!raced) throw new Error("幂等冲突后无法读取来源快照");
      return requireMatchingIdempotency(transaction, raced, inputHash);
    }
    // WHY：计数与快照同事务提交，PC 不会看到“记录已经存在但进度仍落后一条”的中间状态。
    const accessibleIncrement = input.observation.state === "accessible" ? 1 : 0;
    const failedIncrement = input.observation.state === "accessible" ? 0 : 1;
    await transaction.update(sourceCollectionRuns).set({
      snapshotCount: sql`${sourceCollectionRuns.snapshotCount} + 1`,
      accessibleCount: sql`${sourceCollectionRuns.accessibleCount} + ${accessibleIncrement}`,
      failedCount: sql`${sourceCollectionRuns.failedCount} + ${failedIncrement}`,
    }).where(eq(sourceCollectionRuns.id, input.runId));
    return sourceSnapshotRecordSchema.parse({ object, snapshot, assets: [] });
  });
}

async function getRun(
  db: ProductKnowledgeDb,
  runId: string,
): Promise<SourceCollectionRunView | null> {
  const row = await findRun(db, runId);
  if (!row) return null;
  const records = await db.select({ snapshot: sourceSnapshots, object: sourceObjects })
    .from(sourceSnapshots)
    .innerJoin(sourceObjects, eq(sourceSnapshots.objectId, sourceObjects.id))
    .where(eq(sourceSnapshots.runId, runId))
    .orderBy(asc(sourceSnapshots.createdAt), asc(sourceSnapshots.id));
  const snapshotIds = records.map(({ snapshot }) => snapshot.id);
  const assets = snapshotIds.length === 0
    ? []
    : await db.select().from(sourceAssets)
      .where(inArray(sourceAssets.snapshotId, snapshotIds))
      .orderBy(asc(sourceAssets.snapshotId), asc(sourceAssets.position), asc(sourceAssets.id));
  const assetsBySnapshot = new Map<string, typeof assets>();
  for (const asset of assets) {
    const group = assetsBySnapshot.get(asset.snapshotId) ?? [];
    group.push(asset);
    assetsBySnapshot.set(asset.snapshotId, group);
  }
  return sourceCollectionRunViewSchema.parse({
    run: normalizeRun(row),
    records: records.map(({ object, snapshot }) => ({
      object: normalizeObject(object),
      snapshot: normalizeSnapshot(snapshot),
      assets: (assetsBySnapshot.get(snapshot.id) ?? []).map(normalizeAsset),
    })),
  });
}

async function commitAsset(
  db: ProductKnowledgeDb,
  store: ContentAddressedStore,
  rawInput: CommitSourceAsset,
  content: Uint8Array,
  maximumBytes: number,
  now: () => Date,
  createId: NonNullable<SourceDatasetModuleOptions["createId"]>,
) {
  const input = commitSourceAssetSchema.parse(rawInput);
  if (!(content instanceof Uint8Array) || content.byteLength === 0
    || content.byteLength > maximumBytes) {
    throw new SourceDatasetError("asset_too_large", `来源附件必须为 1-${maximumBytes} 字节`);
  }
  const snapshot = await db.query.sourceSnapshots.findFirst({
    where: eq(sourceSnapshots.id, input.snapshotId),
  });
  if (!snapshot) throw new SourceDatasetError("snapshot_not_found", "来源快照不存在");
  const run = await findRun(db, snapshot.runId);
  if (!run || run.status !== "running") {
    throw new SourceDatasetError("run_closed", "来源快照所属运行已经结束");
  }
  requireAssetReference(snapshot.content, input);
  const byteHash = createHash("sha256").update(content).digest("hex");
  const existing = await db.query.sourceAssets.findFirst({
    where: and(eq(sourceAssets.snapshotId, input.snapshotId), eq(sourceAssets.assetKey, input.assetKey)),
  });
  if (existing) return requireMatchingAsset(existing, byteHash);

  const stored = await store.put({
    privacyClass: input.privacyClass,
    content,
    metadata: { snapshotId: input.snapshotId, assetKey: input.assetKey },
  });
  const asset = sourceAssetSchema.parse({
    ...input,
    id: createId("asset"),
    contentHash: byteHash,
    casIntegrity: stored.integrity,
    bytes: stored.bytes,
    createdAt: now().toISOString(),
  });
  return persistAsset(db, asset, snapshot.runId);
}

async function persistAsset(db: ProductKnowledgeDb, asset: SourceAsset, runId: string) {
  return db.transaction(async (transaction) => {
    const inserted = await transaction.insert(sourceAssets).values({
      ...asset,
      dimensions: asset.dimensions ?? null,
    }).onConflictDoNothing().returning();
    if (inserted.length === 0) {
      const raced = await transaction.query.sourceAssets.findFirst({
        where: and(
          eq(sourceAssets.snapshotId, asset.snapshotId),
          eq(sourceAssets.assetKey, asset.assetKey),
        ),
      });
      if (!raced) throw new Error("附件幂等冲突后无法读取来源附件");
      return requireMatchingAsset(raced, asset.contentHash);
    }
    await transaction.update(sourceCollectionRuns).set({
      assetCount: sql`${sourceCollectionRuns.assetCount} + 1`,
    }).where(eq(sourceCollectionRuns.id, runId));
    return normalizeAsset(inserted[0]!);
  });
}

async function finishRun(
  db: ProductKnowledgeDb,
  rawInput: FinishSourceCollectionRun,
  now: () => Date,
) {
  const input = finishSourceCollectionRunSchema.parse(rawInput);
  const existing = await findRun(db, input.runId);
  if (!existing) throw new SourceDatasetError("run_not_found", `来源运行不存在：${input.runId}`);
  if (existing.status !== "running") {
    const sameResult = existing.status === input.status
      && (existing.terminationReason ?? undefined) === input.terminationReason;
    if (sameResult) return normalizeRun(existing);
    throw new SourceDatasetError("run_closed", `来源运行已经结束：${input.runId}`);
  }
  const finishedAt = now().toISOString();
  const [updated] = await db.update(sourceCollectionRuns).set({
    status: input.status,
    finishedAt,
    terminationReason: input.terminationReason,
  }).where(and(
    eq(sourceCollectionRuns.id, input.runId),
    eq(sourceCollectionRuns.status, "running"),
  )).returning();
  if (!updated) throw new SourceDatasetError("run_closed", `来源运行已经结束：${input.runId}`);
  return normalizeRun(updated);
}
