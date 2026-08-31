import type { WorkbenchDb } from "@domain-analysis/db";
import {
  sourceAssets,
  sourceCaptureWorkItems,
  sourceCollectionBatches,
  sourceCollectionPlans,
  sourceCollectionRuns,
  sourceObjects,
  sourceResourceReferences,
  sourceSnapshots,
} from "@domain-analysis/db";
import {
  sourceDatasetPlanSourceSchema,
  sourceDatasetPlanBrandSchema,
  sourceDatasetRecordGroupKeySchema,
  sourceDatasetRecordGroupSummarySchema,
  sourceDatasetRecordPageSchema,
  sourceDatasetRecordSummarySchema,
  sourceDatasetResourceFormatSchema,
  sourceDatasetTaskViewSchema,
  type SourceDatasetPlanBrand,
  type SourceDatasetPlanSource,
  type SourceDatasetRecordGroupKey,
  type SourceDatasetResourceFormat,
  type SourceCaptureWorkItem,
} from "@domain-analysis/shared";
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  normalizeBatch,
  normalizeRun,
  normalizeSnapshot,
  sourceSnapshotOutcome,
} from "./sourceDatasetNormalization";
import { loadCapturedSubjectProjection } from "./sourceDatasetCapturedSubjects";

type RecordGroupSummary = z.infer<typeof sourceDatasetRecordGroupSummarySchema>;
type SnapshotRow = typeof sourceSnapshots.$inferSelect;
type ResourceKind = NonNullable<SourceCaptureWorkItem["resourceKind"]>;
export type SourceDatasetRecordPageInput = { taskId: string; cursor?: string; limit: number } & (
  | { sourceKey: string; targetKey: string; groupKey: SourceDatasetRecordGroupKey }
  | { subjectId: string; resourceKind: ResourceKind }
);
type AggregatedRecordRow = {
  planId: string | null;
  planVersion: number | null;
  sourceKey: string | null;
  targetKey: string | null;
  groupKey: string;
  outcome: string;
  format: string;
  count: number;
};

const cursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().min(1) }).strict();

export async function loadSourceDatasetTaskView(db: WorkbenchDb, taskId: string) {
  const [batchRows, runRows, planRows, recordGroupRows] = await Promise.all([
    db.select().from(sourceCollectionBatches).where(eq(sourceCollectionBatches.taskId, taskId))
      .orderBy(desc(sourceCollectionBatches.startedAt)),
    db.select().from(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId))
      .orderBy(desc(sourceCollectionRuns.startedAt)),
    db.select().from(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, taskId))
      .orderBy(desc(sourceCollectionPlans.version)),
    loadAggregatedRecordRows(db, taskId),
  ]);
  const runs = runRows.map(normalizeRun);
  const batches = batchRows.map(normalizeBatch);
  const groups = aggregateRecordGroups(recordGroupRows);
  const captured = await loadCapturedSubjectProjection(db, batches, runs);
  return sourceDatasetTaskViewSchema.parse({
    batches,
    runs,
    executions: projectExecutions(batches, runs),
    // WHY：首屏只返回来源结构和聚合计数；单条快照由记录组展开动作分页读取。
    sources: planRows.flatMap((plan) => projectPlanSources(plan, groups)),
    brands: planRows.flatMap(projectPlanBrands),
    ...captured,
  });
}

function projectExecutions(
  batches: ReturnType<typeof normalizeBatch>[],
  runs: ReturnType<typeof normalizeRun>[],
) {
  return batches.map((batch) => {
    const latestBySource = new Map<string, ReturnType<typeof normalizeRun>>();
    for (const run of runs) {
      if (run.executionBatchId !== batch.id || !run.sourceCollectionPlanSourceKey
        || latestBySource.has(run.sourceCollectionPlanSourceKey)) continue;
      latestBySource.set(run.sourceCollectionPlanSourceKey, run);
    }
    const latestRuns = [...latestBySource.values()];
    const counts = {
      running: latestRuns.filter((run) => run.status === "running").length,
      completed: latestRuns.filter((run) => run.status === "completed").length,
      failed: latestRuns.filter((run) => run.status === "failed").length,
      stopped: latestRuns.filter((run) => run.status === "stopped").length,
      missing: Math.max(0, batch.plannedSourceCount - latestRuns.length),
    };
    const failureCounts = latestRuns.reduce<Record<string, number>>((result, run) => {
      if (run.failureCategory) result[run.failureCategory] = (result[run.failureCategory] ?? 0) + 1;
      return result;
    }, {});
    return {
      batchId: batch.id, taskId: batch.taskId,
      sourceCollectionPlanId: batch.sourceCollectionPlanId,
      sourceCollectionPlanVersion: batch.sourceCollectionPlanVersion,
      taskRevision: batch.taskRevision, plannedSourceCount: batch.plannedSourceCount,
      latestRuns, counts, failureCounts, status: projectedExecutionStatus(batch.status, counts),
    };
  });
}

function projectedExecutionStatus(
  storedStatus: ReturnType<typeof normalizeBatch>["status"],
  counts: { running: number; completed: number; failed: number; stopped: number; missing: number },
) {
  if (counts.running > 0 || (storedStatus === "running" && counts.missing > 0)) return "running" as const;
  if (counts.completed > 0 && counts.failed + counts.stopped + counts.missing > 0) return "partial" as const;
  if (counts.completed > 0 && counts.failed + counts.stopped + counts.missing === 0) return "completed" as const;
  if (counts.failed > 0) return "failed" as const;
  if (counts.stopped > 0) return "stopped" as const;
  return storedStatus;
}

export async function loadSourceDatasetRecordPage(db: WorkbenchDb, input: SourceDatasetRecordPageInput) {
  if ("subjectId" in input) return loadSubjectRecordPage(db, input);
  const [plan] = await db.select().from(sourceCollectionPlans).where(and(
    eq(sourceCollectionPlans.taskId, input.taskId), eq(sourceCollectionPlans.status, "confirmed"),
  )).orderBy(desc(sourceCollectionPlans.version)).limit(1);
  if (!plan || !planContainsTarget(plan, input.sourceKey, input.targetKey)) {
    return sourceDatasetRecordPageSchema.parse({ items: [], totalCount: 0 });
  }
  const runRows = await db.select().from(sourceCollectionRuns).where(and(
    eq(sourceCollectionRuns.taskId, input.taskId),
    eq(sourceCollectionRuns.sourceCollectionPlanId, plan.id),
    eq(sourceCollectionRuns.sourceCollectionPlanVersion, plan.version),
    eq(sourceCollectionRuns.sourceCollectionPlanSourceKey, input.sourceKey),
  ));
  const runIds = runRows.map((run) => run.id);
  if (runIds.length === 0) return sourceDatasetRecordPageSchema.parse({ items: [], totalCount: 0 });

  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
  const conditions = [
    inArray(sourceSnapshots.runId, runIds),
    eq(sourceSnapshots.targetKey, input.targetKey),
    groupCondition(input.groupKey),
  ];
  if (cursor) conditions.push(or(
    lt(sourceSnapshots.createdAt, cursor.createdAt),
    and(eq(sourceSnapshots.createdAt, cursor.createdAt), lt(sourceSnapshots.id, cursor.id)),
  )!);
  const where = and(...conditions)!;
  const [rows, totalRows] = await Promise.all([
    db.select().from(sourceSnapshots).where(where)
      .orderBy(desc(sourceSnapshots.createdAt), desc(sourceSnapshots.id)).limit(input.limit + 1),
    db.select({ count: sql<number>`count(*)::int` }).from(sourceSnapshots).where(and(
      inArray(sourceSnapshots.runId, runIds),
      eq(sourceSnapshots.targetKey, input.targetKey),
      groupCondition(input.groupKey),
    )!),
  ]);
  const hasNext = rows.length > input.limit;
  const pageRows = rows.slice(0, input.limit);
  const items = await summarizeRecords(db, pageRows);
  const last = pageRows.at(-1);
  return sourceDatasetRecordPageSchema.parse({
    items,
    totalCount: Number(totalRows[0]?.count ?? 0),
    ...(hasNext && last ? { nextCursor: encodeCursor(last) } : {}),
  });
}

async function loadSubjectRecordPage(db: WorkbenchDb, input: Extract<SourceDatasetRecordPageInput,
  { subjectId: string }>) {
  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
  const baseConditions = [
    eq(sourceCollectionRuns.taskId, input.taskId),
    eq(sourceCaptureWorkItems.subjectId, input.subjectId),
    eq(sourceCaptureWorkItems.resourceKind, input.resourceKind),
  ];
  const pageConditions = [...baseConditions];
  if (cursor) pageConditions.push(or(
    lt(sourceSnapshots.createdAt, cursor.createdAt),
    and(eq(sourceSnapshots.createdAt, cursor.createdAt), lt(sourceSnapshots.id, cursor.id)),
  )!);
  const [rows, totalRows] = await Promise.all([
    db.select({ snapshot: sourceSnapshots }).from(sourceSnapshots)
      .innerJoin(sourceCaptureWorkItems, eq(sourceCaptureWorkItems.id, sourceSnapshots.captureWorkItemId))
      .innerJoin(sourceCollectionRuns, eq(sourceCollectionRuns.id, sourceSnapshots.runId))
      .where(and(...pageConditions)).orderBy(desc(sourceSnapshots.createdAt), desc(sourceSnapshots.id))
      .limit(input.limit + 1),
    db.select({ count: sql<number>`count(*)::int` }).from(sourceSnapshots)
      .innerJoin(sourceCaptureWorkItems, eq(sourceCaptureWorkItems.id, sourceSnapshots.captureWorkItemId))
      .innerJoin(sourceCollectionRuns, eq(sourceCollectionRuns.id, sourceSnapshots.runId))
      .where(and(...baseConditions)),
  ]);
  const pageRows = rows.slice(0, input.limit).map((row) => row.snapshot);
  const last = pageRows.at(-1);
  return sourceDatasetRecordPageSchema.parse({
    items: await summarizeRecords(db, pageRows),
    totalCount: Number(totalRows[0]?.count ?? 0),
    ...(rows.length > input.limit && last ? { nextCursor: encodeCursor(last) } : {}),
  });
}

async function loadAggregatedRecordRows(db: WorkbenchDb, taskId: string): Promise<AggregatedRecordRow[]> {
  const groupKey = sql<string>`case when ${sourceSnapshots.lineage} is null then 'unrecorded'
    else (${sourceSnapshots.lineage}->>'discoveryKind') || ':' || (${sourceSnapshots.lineage}->>'depth') end`;
  const outcome = sql<string>`case
    when coalesce(${sourceSnapshots.observation}->>'state', '') <> 'accessible' then 'failed'
    when ${sourceSnapshots.observation}#>>'{contentAssessment,status}' = 'rejected' then 'rejected'
    when ${sourceSnapshots.observation}#>>'{contentAssessment,status}' = 'supporting' then 'supporting'
    else 'accepted' end`;
  const format = sql<string>`case
    when ${sourceSnapshots.payload} is null then 'unknown'
    when ${sourceSnapshots.payload}->>'kind' is null then 'legacy'
    when ${sourceSnapshots.payload}->>'kind' = 'legacy_structured_json' then 'legacy'
    when lower(coalesce(${sourceSnapshots.payload}->>'mediaType', '')) like '%html%' then 'html'
    when lower(coalesce(${sourceSnapshots.payload}->>'mediaType', '')) like '%json%' then 'json'
    when lower(coalesce(${sourceSnapshots.payload}->>'mediaType', '')) like '%csv%'
      or lower(coalesce(${sourceSnapshots.payload}->>'filename', '')) like '%.csv' then 'csv'
    when lower(coalesce(${sourceSnapshots.payload}->>'mediaType', '')) like '%xml%' then 'xml'
    when lower(coalesce(${sourceSnapshots.payload}->>'mediaType', '')) = 'application/pdf'
      or lower(coalesce(${sourceSnapshots.payload}->>'filename', '')) like '%.pdf' then 'pdf'
    when lower(coalesce(${sourceSnapshots.payload}->>'mediaType', '')) like '%spreadsheet%'
      or lower(coalesce(${sourceSnapshots.payload}->>'mediaType', '')) like '%excel%'
      or lower(coalesce(${sourceSnapshots.payload}->>'filename', '')) ~ '\\.xlsx?$' then 'spreadsheet'
    when lower(coalesce(${sourceSnapshots.payload}->>'mediaType', '')) like '%wordprocessing%'
      or lower(coalesce(${sourceSnapshots.payload}->>'mediaType', '')) like '%msword%'
      or lower(coalesce(${sourceSnapshots.payload}->>'filename', '')) ~ '\\.docx?$' then 'word'
    when lower(coalesce(${sourceSnapshots.payload}->>'mediaType', '')) like 'image/%' then 'image'
    when lower(coalesce(${sourceSnapshots.payload}->>'mediaType', '')) like 'video/%' then 'video'
    when lower(coalesce(${sourceSnapshots.payload}->>'mediaType', '')) like 'text/%' then 'text'
    when ${sourceSnapshots.payload}->>'kind' = 'asset' then 'binary'
    else 'unknown' end`;
  return db.select({ planId: sourceCollectionRuns.sourceCollectionPlanId,
    planVersion: sourceCollectionRuns.sourceCollectionPlanVersion,
    sourceKey: sourceCollectionRuns.sourceCollectionPlanSourceKey,
    targetKey: sourceSnapshots.targetKey, groupKey, outcome, format,
    count: sql<number>`count(*)::int` })
    .from(sourceSnapshots).innerJoin(sourceCollectionRuns, eq(sourceCollectionRuns.id, sourceSnapshots.runId))
    .where(and(eq(sourceCollectionRuns.taskId, taskId),
      isNotNull(sourceCollectionRuns.sourceCollectionPlanId),
      isNotNull(sourceCollectionRuns.sourceCollectionPlanVersion),
      isNotNull(sourceCollectionRuns.sourceCollectionPlanSourceKey),
      isNotNull(sourceSnapshots.targetKey)))
    .groupBy(sourceCollectionRuns.sourceCollectionPlanId, sourceCollectionRuns.sourceCollectionPlanVersion,
      sourceCollectionRuns.sourceCollectionPlanSourceKey, sourceSnapshots.targetKey, groupKey, outcome, format);
}

function aggregateRecordGroups(rows: AggregatedRecordRow[]) {
  const groups = new Map<string, Map<SourceDatasetRecordGroupKey, RecordGroupSummary>>();
  for (const row of rows) {
    if (!row.planId || !row.planVersion || !row.sourceKey || !row.targetKey) continue;
    const targetKey = aggregateTargetKey(row.planId, row.planVersion, row.sourceKey, row.targetKey);
    const groupKey = sourceDatasetRecordGroupKeySchema.parse(row.groupKey);
    const byGroup = groups.get(targetKey) ?? new Map<SourceDatasetRecordGroupKey, RecordGroupSummary>();
    const summary = byGroup.get(groupKey) ?? emptyGroupSummary(groupKey);
    const count = Number(row.count);
    const outcome = z.enum(["accepted", "supporting", "rejected", "failed"]).parse(row.outcome);
    const format = sourceDatasetResourceFormatSchema.parse(row.format);
    summary.totalCount += count;
    summary.outcomes[outcome] += count;
    const existing = summary.formats.find((item) => item.format === format);
    if (existing) existing.count += count;
    else summary.formats.push({ format, count });
    byGroup.set(groupKey, summary);
    groups.set(targetKey, byGroup);
  }
  return new Map([...groups].map(([key, value]) => [key,
    [...value.values()].sort((left, right) => groupOrder(left.groupKey) - groupOrder(right.groupKey))]));
}

async function summarizeRecords(db: WorkbenchDb, rows: SnapshotRow[]) {
  const objectIds = [...new Set(rows.map((row) => row.objectId))];
  const snapshotIds = rows.map((row) => row.id);
  const workItemIds = [...new Set(rows.flatMap((row) => row.captureWorkItemId ? [row.captureWorkItemId] : []))];
  const [objectRows, assetRows, referenceRows, workItems] = await Promise.all([
    objectIds.length > 0 ? db.select().from(sourceObjects).where(inArray(sourceObjects.id, objectIds)) : [],
    snapshotIds.length > 0 ? db.select().from(sourceAssets)
      .where(inArray(sourceAssets.snapshotId, snapshotIds)) : [],
    snapshotIds.length > 0 ? db.select({ snapshotId: sourceResourceReferences.snapshotId })
      .from(sourceResourceReferences).where(inArray(sourceResourceReferences.snapshotId, snapshotIds)) : [],
    workItemIds.length > 0 ? db.select().from(sourceCaptureWorkItems)
      .where(inArray(sourceCaptureWorkItems.id, workItemIds)) : [],
  ]);
  const objectsById = new Map(objectRows.map((row) => [row.id, row]));
  const workById = new Map(workItems.map((row) => [row.id, row]));
  const assetsBySnapshot = groupRowsBySnapshot(assetRows);
  const assetCounts = countBySnapshot(assetRows);
  const referenceCounts = countBySnapshot(referenceRows);
  return rows.flatMap((row) => {
    const object = objectsById.get(row.objectId);
    if (!object) return [];
    const snapshot = normalizeSnapshot(row);
    const work = snapshot.captureWorkItemId ? workById.get(snapshot.captureWorkItemId) : undefined;
    return [sourceDatasetRecordSummarySchema.parse({ snapshotId: snapshot.id, runId: snapshot.runId,
      targetKey: snapshot.targetKey, sourceIdentity: object.sourceIdentity, objectKind: object.kind,
      externalKey: object.externalKey, observation: snapshot.observation,
      outcome: sourceSnapshotOutcome(snapshot.observation), lineage: snapshot.lineage,
      captureSubjectId: work?.subjectId ?? undefined, resourceKind: work?.resourceKind ?? undefined,
      resourceSection: work?.resourceSection ?? undefined,
      resourceOrdinal: work?.resourceOrdinal ?? undefined,
      payload: summarizePayload(snapshot.payload), resourceFormat: resourceFormatFor(snapshot.payload),
      assets: (assetsBySnapshot.get(snapshot.id) ?? []).map((asset) => ({ id: asset.id,
        filename: asset.filename, sourceUrl: asset.sourceUrl, mediaType: asset.mediaType, bytes: asset.bytes })),
      assetCount: assetCounts.get(snapshot.id) ?? 0,
      resourceReferenceCount: referenceCounts.get(snapshot.id) ?? 0 })];
  });
}

function groupRowsBySnapshot<T extends { snapshotId: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(row.snapshotId, [...(grouped.get(row.snapshotId) ?? []), row]);
  return grouped;
}

function projectPlanBrands(plan: typeof sourceCollectionPlans.$inferSelect): SourceDatasetPlanBrand[] {
  const content: Record<string, unknown> = isRecord(plan.content) ? plan.content : {};
  const audit = isRecord(content.researchAudit) ? content.researchAudit : {};
  const brands: unknown[] = Array.isArray(audit.brands) ? audit.brands : [];
  return brands.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const projected = sourceDatasetPlanBrandSchema.safeParse({
      planId: plan.id, planVersion: plan.version, planStatus: plan.status,
      name: raw.name, aliases: Array.isArray(raw.aliases) ? raw.aliases : [], status: raw.status,
      officialSourceKeys: Array.isArray(raw.officialSourceKeys) ? raw.officialSourceKeys : [],
    });
    return projected.success ? [projected.data] : [];
  });
}

function projectPlanSources(
  plan: typeof sourceCollectionPlans.$inferSelect,
  groups: Map<string, RecordGroupSummary[]>,
): SourceDatasetPlanSource[] {
  const content: Record<string, unknown> = isRecord(plan.content) ? plan.content : {};
  const sources: unknown[] = Array.isArray(content.sources) ? content.sources : [];
  return sources.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.key !== "string" || raw.key.length === 0) return [];
    const sourceKey = raw.key;
    const targets = Array.isArray(raw.targets) ? raw.targets.flatMap((target) => projectTarget(
      target, groups, plan.id, plan.version, sourceKey,
    )) : [];
    const projected = sourceDatasetPlanSourceSchema.safeParse({ planId: plan.id, planVersion: plan.version,
      planStatus: plan.status, sourceKey,
      name: typeof raw.name === "string" && raw.name ? raw.name : sourceKey,
      publisher: optionalText(raw.publisher), sourceKind: optionalText(raw.sourceKind),
      role: optionalText(raw.role), targets });
    return projected.success ? [projected.data] : [];
  });
}

function projectTarget(value: unknown, groups: Map<string, RecordGroupSummary[]>,
  planId: string, planVersion: number, sourceKey: string) {
  if (!isRecord(value) || typeof value.key !== "string" || value.key.length === 0) return [];
  return [{ targetKey: value.key,
    name: typeof value.name === "string" && value.name ? value.name : value.key,
    captureUnit: typeof value.captureUnit === "string" && value.captureUnit
      ? value.captureUnit : "原始来源响应",
    taskTopics: Array.isArray(value.taskTopics)
      ? value.taskTopics.filter((topic): topic is string => typeof topic === "string" && topic.length > 0) : [],
    recordGroups: groups.get(aggregateTargetKey(planId, planVersion, sourceKey, value.key)) ?? [] }];
}

function planContainsTarget(plan: typeof sourceCollectionPlans.$inferSelect, sourceKey: string, targetKey: string) {
  return projectPlanSources(plan, new Map()).some((source) => source.sourceKey === sourceKey
    && source.targets.some((target) => target.targetKey === targetKey));
}

function groupCondition(groupKey: SourceDatasetRecordGroupKey) {
  if (groupKey === "unrecorded") return isNull(sourceSnapshots.lineage);
  const [kind, rawDepth] = groupKey.split(":");
  const depth = Number(rawDepth);
  return sql<boolean>`${sourceSnapshots.lineage}->>'discoveryKind' = ${kind}
    and (${sourceSnapshots.lineage}->>'depth')::int = ${depth}`;
}

function resourceFormatFor(payload: ReturnType<typeof normalizeSnapshot>["payload"]): SourceDatasetResourceFormat {
  if (!payload) return "unknown";
  if (payload.kind === "legacy_structured_json") return "legacy";
  const mediaType = payload.mediaType.toLowerCase();
  const filename = payload.kind === "asset" ? payload.filename.toLowerCase() : "";
  const format = mediaType.includes("html") ? "html"
    : mediaType.includes("json") ? "json"
    : mediaType.includes("csv") || filename.endsWith(".csv") ? "csv"
    : mediaType.includes("xml") ? "xml"
    : mediaType === "application/pdf" || filename.endsWith(".pdf") ? "pdf"
    : mediaType.includes("spreadsheet") || mediaType.includes("excel") || /\.xlsx?$/.test(filename)
      ? "spreadsheet"
    : mediaType.includes("wordprocessing") || mediaType.includes("msword") || /\.docx?$/.test(filename)
      ? "word"
    : mediaType.startsWith("image/") ? "image"
    : mediaType.startsWith("video/") ? "video"
    : mediaType.startsWith("text/") ? "text"
    : payload.kind === "asset" ? "binary" : "unknown";
  return sourceDatasetResourceFormatSchema.parse(format);
}

function summarizePayload(payload: ReturnType<typeof normalizeSnapshot>["payload"]) {
  if (!payload) return undefined;
  if (payload.kind === "legacy_structured_json") return { kind: payload.kind } as const;
  return { kind: payload.kind, mediaType: payload.mediaType,
    ...(payload.kind === "asset" ? { filename: payload.filename } : {}), bytes: payload.bytes };
}

function emptyGroupSummary(groupKey: SourceDatasetRecordGroupKey): RecordGroupSummary {
  return sourceDatasetRecordGroupSummarySchema.parse({ groupKey, totalCount: 0,
    outcomes: { accepted: 0, supporting: 0, rejected: 0, failed: 0 }, formats: [] });
}

function groupOrder(value: SourceDatasetRecordGroupKey) {
  return sourceDatasetRecordGroupKeySchema.options.indexOf(value);
}

function aggregateTargetKey(planId: string, planVersion: number, sourceKey: string, targetKey: string) {
  return [planId, planVersion, sourceKey, targetKey].join("\u0000");
}

function encodeCursor(row: SnapshotRow) {
  return Buffer.from(JSON.stringify({ createdAt: new Date(row.createdAt).toISOString(), id: row.id }))
    .toString("base64url");
}

function decodeCursor(value: string) {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw new Error("原始数据分页位置无效");
  }
}

function countBySnapshot(rows: Array<{ snapshotId: string }>) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.snapshotId, (counts.get(row.snapshotId) ?? 0) + 1);
  return counts;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
