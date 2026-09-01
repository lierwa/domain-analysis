import { createHash } from "node:crypto";

import type { WorkbenchDb } from "@domain-analysis/db";
import {
  sourceAssets,
  sourceCaptureSubjects,
  sourceCaptureWorkItems,
  sourceCollectionPlans,
  sourceSnapshots,
} from "@domain-analysis/db";
import {
  brandRankingPlanningAuditSchema,
  multiSourcePlanningAuditSchema,
  sourceDatasetBrandSummarySchema,
  sourceDatasetCurrentExecutionSchema,
  sourceDatasetIssueSummarySchema,
  type SourceCollectionBatch,
  type SourceCollectionRun,
  type SourceDatasetBrandSummary,
  type SourceDatasetIssueSummary,
  type SourceCaptureWorkItem,
} from "@domain-analysis/shared";
import { eq, inArray } from "drizzle-orm";

import { normalizeSnapshot } from "./sourceDatasetNormalization";

type Projection = {
  currentExecution?: ReturnType<typeof sourceDatasetCurrentExecutionSchema.parse>;
  capturedBrands: SourceDatasetBrandSummary[];
  issues: SourceDatasetIssueSummary[];
};

export async function loadCapturedSubjectProjection(
  db: WorkbenchDb,
  batches: SourceCollectionBatch[],
  runs: SourceCollectionRun[],
): Promise<Projection> {
  const batch = batches[0];
  if (!batch) return { capturedBrands: [], issues: [] };
  const batchRuns = runs.filter((run) => run.executionBatchId === batch.id);
  const runIds = batchRuns.map((run) => run.id);
  const subjects = await db.select().from(sourceCaptureSubjects)
    .where(eq(sourceCaptureSubjects.executionBatchId, batch.id));
  if (subjects.length === 0) return {
    currentExecution: sourceDatasetCurrentExecutionSchema.parse({
      batchId: batch.id, status: batch.status, recoveryState: batch.recoveryState,
      planVersion: batch.sourceCollectionPlanVersion, runCount: batchRuns.length,
      snapshotCount: sum(batchRuns.map((run) => run.snapshotCount)),
      assetCount: sum(batchRuns.map((run) => run.assetCount)), brandCount: 0, modelCount: 0,
      completedModelCount: 0, needsAttentionModelCount: 0, issueCount: 0,
      cumulativeRunDurationMs: cumulativeRunDuration(batchRuns), startedAt: batch.startedAt,
      finishedAt: batch.finishedAt,
    }),
    capturedBrands: [], issues: [],
  };

  const subjectIds = subjects.map((subject) => subject.id);
  const workItems = await db.select().from(sourceCaptureWorkItems)
    .where(inArray(sourceCaptureWorkItems.subjectId, subjectIds));
  const snapshots = runIds.length > 0 ? await db.select().from(sourceSnapshots)
    .where(inArray(sourceSnapshots.runId, runIds)) : [];
  const snapshotIds = snapshots.map((snapshot) => snapshot.id);
  const assets = snapshotIds.length > 0 ? await db.select({ snapshotId: sourceAssets.snapshotId })
    .from(sourceAssets).where(inArray(sourceAssets.snapshotId, snapshotIds)) : [];
  const plan = await db.query.sourceCollectionPlans.findFirst({
    where: eq(sourceCollectionPlans.id, batch.sourceCollectionPlanId),
  });
  const rawPlanContent: unknown = plan?.content;
  const planContent = isRecord(rawPlanContent) ? rawPlanContent : undefined;
  const brandMetadata = projectBrandMetadata(planContent?.["researchAudit"]);
  const workById = new Map(workItems.map((work) => [work.id, work]));
  const completedModelSubjects = new Set(workItems.flatMap((work) => work.resourceKind === "model_bundle"
    && work.status === "completed" && work.subjectId ? [work.subjectId] : []));
  const issueProjection = projectIssues(snapshots, workById, completedModelSubjects);
  const assetCountBySubject = countAssetsBySubject(assets, snapshots, workById);
  const capturedBrands = projectBrands(subjects, workItems, issueProjection.issues, assetCountBySubject,
    brandMetadata);
  const models = capturedBrands.flatMap((brand) => brand.models);
  return {
    capturedBrands,
    issues: issueProjection.issues,
    currentExecution: sourceDatasetCurrentExecutionSchema.parse({
      batchId: batch.id, status: batch.status, recoveryState: batch.recoveryState,
      planVersion: batch.sourceCollectionPlanVersion, runCount: batchRuns.length,
      snapshotCount: sum(batchRuns.map((run) => run.snapshotCount)),
      assetCount: sum(batchRuns.map((run) => run.assetCount)), brandCount: capturedBrands.length,
      modelCount: models.length,
      completedModelCount: models.filter((model) => model.status === "completed").length,
      needsAttentionModelCount: models.filter((model) => model.status === "needs_attention").length,
      issueCount: issueProjection.issues.length,
      cumulativeRunDurationMs: cumulativeRunDuration(batchRuns), startedAt: batch.startedAt,
      finishedAt: batch.finishedAt,
    }),
  };
}

function projectBrands(
  subjects: Array<typeof sourceCaptureSubjects.$inferSelect>,
  workItems: Array<typeof sourceCaptureWorkItems.$inferSelect>,
  issues: SourceDatasetIssueSummary[],
  assetCountBySubject: Map<string, number>,
  metadata: Map<string, { name: string; order: number }>,
) {
  const workBySubject = groupBy(workItems, (work) => work.subjectId ?? "");
  const issuesBySubject = groupBy(issues, (issue) => issue.subjectId ?? "");
  const modelsByBrand = groupBy(subjects.filter((subject) => subject.kind === "product_model"),
    (subject) => subject.parentSubjectId ?? "");
  return subjects.filter((subject) => subject.kind === "brand").map((brand) => {
    const models = (modelsByBrand.get(brand.id) ?? []).map((model) => {
      const modelWork = workBySubject.get(model.id) ?? [];
      const modelIssues = issuesBySubject.get(model.id) ?? [];
      return {
        subjectId: model.id, sourceEntityId: model.sourceEntityId, displayName: model.displayName,
        status: modelStatus(modelWork, modelIssues.length),
        resources: {
          parameterPages: uniqueWorkCount(modelWork, "parameters"),
          galleryPages: uniqueWorkCount(modelWork, "gallery"),
          pictureSets: uniqueWorkCount(modelWork, "picture_set"),
          images: assetCountBySubject.get(model.id) ?? 0,
        },
        issueCount: modelIssues.length,
      };
    }).sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
    const completed = models.filter((model) => model.status === "completed").length;
    const needsAttention = models.filter((model) => model.status === "needs_attention").length;
    return sourceDatasetBrandSummarySchema.parse({
      subjectId: brand.id, sourceEntityId: brand.sourceEntityId,
      displayName: metadata.get(brand.sourceEntityId)?.name ?? brand.displayName,
      models, counts: { total: models.length, completed, needsAttention },
    });
  }).sort((left, right) => (metadata.get(left.sourceEntityId)?.order ?? Number.MAX_SAFE_INTEGER)
    - (metadata.get(right.sourceEntityId)?.order ?? Number.MAX_SAFE_INTEGER));
}

function projectIssues(
  rows: Array<typeof sourceSnapshots.$inferSelect>,
  workById: Map<string, typeof sourceCaptureWorkItems.$inferSelect>,
  completedModelSubjects: Set<string>,
) {
  const grouped = new Map<string, SourceDatasetIssueSummary>();
  for (const row of rows) {
    const snapshot = normalizeSnapshot(row);
    const assessment = snapshot.observation.contentAssessment;
    const rejected = assessment?.status === "rejected";
    if (!rejected && snapshot.observation.state === "accessible") continue;
    const work = snapshot.captureWorkItemId ? workById.get(snapshot.captureWorkItemId) : undefined;
    const subjectId = work?.subjectId ?? undefined;
    const reason = assessment?.reason ?? snapshot.observation.error ?? snapshot.observation.state;
    const key = [subjectId ?? "unclassified", snapshot.observation.requestedUrl,
      assessment?.ruleVersion ?? "", reason].join("\u0000");
    const id = `source-issue-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
    const existing = grouped.get(id);
    grouped.set(id, sourceDatasetIssueSummarySchema.parse({
      id, classification: rejected ? "content_rejected" : "request_failed", subjectId,
      requestedUrl: snapshot.observation.requestedUrl, ruleVersion: assessment?.ruleVersion,
      reason, httpStatus: snapshot.observation.httpStatus,
      occurrenceCount: (existing?.occurrenceCount ?? 0) + 1,
      runIds: [...new Set([...(existing?.runIds ?? []), snapshot.runId])],
      latestSnapshotId: snapshot.id,
    }));
  }
  // WHY：历史失败快照继续保留审计；同一型号后续完成后，只退出“当前问题”投影。
  return { issues: [...grouped.values()].filter((issue) => !issue.subjectId
    || !completedModelSubjects.has(issue.subjectId)) };
}

function countAssetsBySubject(
  assets: Array<{ snapshotId: string }>,
  snapshots: Array<typeof sourceSnapshots.$inferSelect>,
  workById: Map<string, typeof sourceCaptureWorkItems.$inferSelect>,
) {
  const subjectBySnapshot = new Map(snapshots.flatMap((snapshot) => {
    const subjectId = snapshot.captureWorkItemId ? workById.get(snapshot.captureWorkItemId)?.subjectId : undefined;
    return subjectId ? [[snapshot.id, subjectId] as const] : [];
  }));
  const counts = new Map<string, number>();
  for (const asset of assets) {
    const subjectId = subjectBySnapshot.get(asset.snapshotId);
    if (subjectId) counts.set(subjectId, (counts.get(subjectId) ?? 0) + 1);
  }
  return counts;
}

function modelStatus(workItems: Array<typeof sourceCaptureWorkItems.$inferSelect>, issueCount: number) {
  const bundle = workItems.filter((work) => work.resourceKind === "model_bundle");
  if (bundle.some((work) => work.status === "completed")) return "completed" as const;
  if (issueCount > 0 || bundle.some((work) => work.status === "failed" || work.status === "stopped")) {
    return "needs_attention" as const;
  }
  if (bundle.some((work) => work.status === "running")) return "running" as const;
  return "pending" as const;
}

function uniqueWorkCount(
  workItems: Array<typeof sourceCaptureWorkItems.$inferSelect>,
  kind: NonNullable<SourceCaptureWorkItem["resourceKind"]>,
) {
  return new Set(workItems.filter((work) => work.resourceKind === kind).map((work) => work.workKey)).size;
}

function projectBrandMetadata(value: unknown) {
  const multiSource = multiSourcePlanningAuditSchema.safeParse(value);
  const catalogAudit = multiSource.success
    && multiSource.data.productCatalog.kind !== "completed_source_reference"
    ? multiSource.data.productCatalog : value;
  const parsed = brandRankingPlanningAuditSchema.safeParse(catalogAudit);
  if (!parsed.success || parsed.data.rankingStatus !== "verified") return new Map<string, { name: string; order: number }>();
  return new Map(parsed.data.executionBrands.map((brand, order) => [brand.key, { name: brand.name, order }]));
}

function cumulativeRunDuration(runs: SourceCollectionRun[]) {
  const now = Date.now();
  return sum(runs.map((run) => Math.max(0,
    new Date(run.finishedAt ?? now).getTime() - new Date(run.startedAt).getTime())));
}

function groupBy<T>(values: T[], key: (value: T) => string) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), value]);
  }
  return groups;
}

function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
