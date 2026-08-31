import { createHash } from "node:crypto";

import {
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  sourceCaptureSubjects,
  sourceCaptureWorkItems,
  sourceCollectionBatches,
  sourceCollectionPlans,
  sourceCollectionRuns,
  sourceResourceReferences,
  sourceSnapshots,
} from "@domain-analysis/db";
import { brandRankingPlanningAuditSchema } from "@domain-analysis/shared";
import {
  parseZolCaptureWorkKey,
  parseZolCatalogPage,
  zolResourceKindForWorkKey,
} from "@domain-analysis/worker";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

const taskId = argument("--task");
await migrateWorkbenchDatabase();
const db = createWorkbenchDb();

try {
  const batches = await db.select().from(sourceCollectionBatches)
    .where(eq(sourceCollectionBatches.taskId, taskId));
  if (batches.length === 0) throw new Error(`任务没有 Source Batch：${taskId}`);
  const latestBatch = batches.sort((left, right) =>
    new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0]!;
  const plan = await db.query.sourceCollectionPlans.findFirst({
    where: eq(sourceCollectionPlans.id, latestBatch.sourceCollectionPlanId),
  });
  const audit = brandRankingPlanningAuditSchema.parse(isRecord(plan?.content)
    ? plan.content["researchAudit"] : undefined);
  if (audit.rankingStatus !== "verified") throw new Error("当前计划没有已验证执行品牌");
  const runs = await db.select().from(sourceCollectionRuns)
    .where(eq(sourceCollectionRuns.executionBatchId, latestBatch.id));
  const runIds = runs.map((run) => run.id);
  if (runIds.length === 0) throw new Error(`Batch 没有 Source Run：${latestBatch.id}`);
  const [workItems, snapshots] = await Promise.all([
    db.select().from(sourceCaptureWorkItems).where(inArray(sourceCaptureWorkItems.runId, runIds)),
    db.select().from(sourceSnapshots).where(inArray(sourceSnapshots.runId, runIds)),
  ]);
  const references = snapshots.length > 0 ? await db.select().from(sourceResourceReferences)
    .where(inArray(sourceResourceReferences.snapshotId, snapshots.map((snapshot) => snapshot.id))) : [];
  const referencesBySnapshot = groupBy(references, (reference) => reference.snapshotId);
  const sectionByUrl = new Map(references.map((reference) => [reference.sourceUrl, reference.section]));
  const snapshotsByWorkKey = groupBy(snapshots, (snapshot) => {
    const lineage = isRecord(snapshot.lineage) ? snapshot.lineage : undefined;
    return typeof lineage?.["workKey"] === "string" ? lineage["workKey"] : "";
  });
  const executedModels = new Map<string, string | undefined>();
  for (const work of workItems) {
    const parsed = parseZolCaptureWorkKey(work.workKey);
    if (!parsed || parsed.kind === "brand_catalog") continue;
    executedModels.set(parsed.modelId, parsed.kind === "model_bundle"
      ? parsed.brandKey : executedModels.get(parsed.modelId));
  }
  const models = new Map<string, { id: string; name: string; brandKey: string }>();
  for (const row of snapshots) {
    const lineage = isRecord(row.lineage) ? row.lineage : undefined;
    const parsedKey = typeof lineage?.["workKey"] === "string"
      ? parseZolCaptureWorkKey(lineage["workKey"]) : undefined;
    if (parsedKey?.kind !== "brand_catalog" || !isRecord(row.payload)
      || row.payload["kind"] !== "inline_text" || typeof row.payload["text"] !== "string"
      || !isRecord(row.observation)) continue;
    const requestedUrl = row.observation["requestedUrl"];
    if (typeof requestedUrl !== "string") continue;
    // WHY：Snapshot 的 inline_text 已在采集时解码成 Unicode；回填只重放该文本，不能再按源站 GBK header 二次解码。
    const headers = { ...(isStringRecord(row.observation["responseHeaders"])
      ? row.observation["responseHeaders"] : {}), "content-type": "text/html; charset=UTF-8" };
    const facts = parseZolCatalogPage({ statusCode: Number(row.observation["httpStatus"] ?? 200),
      headers, body: Buffer.from(row.payload["text"]),
      finalUrl: typeof row.observation["finalUrl"] === "string"
        ? row.observation["finalUrl"] : requestedUrl }, new URL(requestedUrl), parsedKey.page, audit.categorySlug);
    for (const model of facts.models) {
      if (executedModels.has(model.id)) models.set(model.id, { ...model,
        brandKey: executedModels.get(model.id) ?? parsedKey.brandKey });
    }
  }
  const missingModels = [...executedModels.keys()].filter((modelId) => !models.has(modelId));
  if (missingModels.length > 0) {
    throw new Error(`执行型号在品牌目录快照中缺失：${missingModels.join(", ")}`);
  }

  await db.transaction(async (transaction) => {
    const brandIds = new Map<string, string>();
    for (const brand of audit.executionBrands) {
      brandIds.set(brand.key, await upsertSubject(transaction, {
        batchId: latestBatch.id, sourceKey: runs[0]!.sourceCollectionPlanSourceKey!, kind: "brand",
        sourceEntityId: brand.key, displayName: brand.name,
      }));
    }
    const modelIds = new Map<string, string>();
    for (const model of models.values()) {
      const parentSubjectId = brandIds.get(model.brandKey);
      if (!parentSubjectId) continue;
      modelIds.set(model.id, await upsertSubject(transaction, {
        batchId: latestBatch.id, sourceKey: runs[0]!.sourceCollectionPlanSourceKey!, kind: "product_model",
        sourceEntityId: model.id, displayName: model.name, parentSubjectId,
      }));
    }
    if (modelIds.size > 0) await transaction.delete(sourceCaptureSubjects).where(and(
      eq(sourceCaptureSubjects.executionBatchId, latestBatch.id),
      eq(sourceCaptureSubjects.kind, "product_model"),
      notInArray(sourceCaptureSubjects.sourceEntityId, [...modelIds.keys()]),
    ));
    for (const work of workItems) {
      const parsed = parseZolCaptureWorkKey(work.workKey);
      if (!parsed) continue;
      const subjectId = parsed.kind === "brand_catalog"
        ? brandIds.get(parsed.brandKey)
        : modelIds.get(parsed.modelId);
      if (!subjectId) continue;
      const position = capturePosition(parsed, snapshotsByWorkKey.get(work.workKey) ?? [],
        referencesBySnapshot, sectionByUrl);
      await transaction.update(sourceCaptureWorkItems).set({ subjectId,
        resourceKind: zolResourceKindForWorkKey(work.workKey), ...position })
        .where(eq(sourceCaptureWorkItems.id, work.id));
    }
    // WHY：历史 Snapshot 已有经过校验的 run/workKey lineage；只补真实 FK，不改原始 observation、payload 或 hash。
    await transaction.execute(sql`
      update workbench.source_snapshots snapshots
      set capture_work_item_id = work.id
      from workbench.source_capture_work_items work, workbench.source_collection_runs runs
      where snapshots.run_id = work.run_id
        and snapshots.lineage_json->>'workKey' = work.work_key
        and runs.id = work.run_id
        and runs.execution_batch_id = ${latestBatch.id}
    `);
  });

  const [subjectCounts, linkedSnapshots] = await Promise.all([
    db.select({ kind: sourceCaptureSubjects.kind, count: sql<number>`count(*)::int` })
      .from(sourceCaptureSubjects).where(eq(sourceCaptureSubjects.executionBatchId, latestBatch.id))
      .groupBy(sourceCaptureSubjects.kind),
    db.select({ count: sql<number>`count(*)::int` }).from(sourceSnapshots)
      .where(and(inArray(sourceSnapshots.runId, runIds), sql`${sourceSnapshots.captureWorkItemId} is not null`)),
  ]);
  console.log(JSON.stringify({ taskId, batchId: latestBatch.id,
    brands: subjectCounts.find((row) => row.kind === "brand")?.count ?? 0,
    models: subjectCounts.find((row) => row.kind === "product_model")?.count ?? 0,
    linkedSnapshots: linkedSnapshots[0]?.count ?? 0 }, null, 2));
} finally {
  await db.$client.end();
}

async function upsertSubject(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { batchId: string; sourceKey: string; kind: "brand" | "product_model";
    sourceEntityId: string; displayName: string; parentSubjectId?: string },
) {
  const id = `source-subject-${createHash("sha256").update([
    input.batchId, input.sourceKey, input.kind, input.sourceEntityId,
  ].join("\u0000")).digest("hex").slice(0, 32)}`;
  await transaction.insert(sourceCaptureSubjects).values({ id,
    executionBatchId: input.batchId, sourceKey: input.sourceKey, kind: input.kind,
    sourceEntityId: input.sourceEntityId, displayName: input.displayName,
    parentSubjectId: input.parentSubjectId }).onConflictDoUpdate({
      target: [sourceCaptureSubjects.executionBatchId, sourceCaptureSubjects.sourceKey,
        sourceCaptureSubjects.kind, sourceCaptureSubjects.sourceEntityId],
      set: { displayName: input.displayName, parentSubjectId: input.parentSubjectId },
    });
  const row = await transaction.query.sourceCaptureSubjects.findFirst({ where: and(
    eq(sourceCaptureSubjects.executionBatchId, input.batchId),
    eq(sourceCaptureSubjects.sourceKey, input.sourceKey),
    eq(sourceCaptureSubjects.kind, input.kind),
    eq(sourceCaptureSubjects.sourceEntityId, input.sourceEntityId),
  ) });
  if (!row) throw new Error(`Capture Subject 写入失败：${input.kind}:${input.sourceEntityId}`);
  return row.id;
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`缺少参数 ${name}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function capturePosition(
  parsed: NonNullable<ReturnType<typeof parseZolCaptureWorkKey>>,
  snapshots: Array<typeof sourceSnapshots.$inferSelect>,
  referencesBySnapshot: Map<string, Array<typeof sourceResourceReferences.$inferSelect>>,
  sectionByUrl: Map<string, string>,
) {
  if (parsed.kind !== "image" && parsed.kind !== "picture_set") return {};
  const snapshot = snapshots[0];
  const requestedUrl = snapshot && isRecord(snapshot.observation)
    && typeof snapshot.observation["requestedUrl"] === "string"
    ? snapshot.observation["requestedUrl"] : undefined;
  const section = parsed.kind === "image" && requestedUrl
    ? sectionByUrl.get(requestedUrl)
    : snapshot ? referencesBySnapshot.get(snapshot.id)?.[0]?.section : undefined;
  return { resourceOrdinal: parsed.ordinal, ...(section ? { resourceSection: section } : {}) };
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(keyOf(row), [...(grouped.get(keyOf(row)) ?? []), row]);
  return grouped;
}
