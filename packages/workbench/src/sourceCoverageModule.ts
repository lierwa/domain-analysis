import {
  sourceCollectionBatches,
  sourceCollectionPlans,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceCaptureSubjects,
  sourceCaptureWorkItems,
  sourceRequestAttempts,
  sourceSnapshots,
  type WorkbenchDb,
} from "@domain-analysis/db";
import {
  crawlPlanContentSchema,
  multiSourcePlanningAuditSchema,
  requiredSourceCoverageFacets,
  sourceCoverageAssessmentSchema,
  sourceCoverageFamilies,
  sourceCoverageFamilyKinds,
  type PublicResearchFacet,
  type PublicResearchSourceKind,
  type SourceCoverageAssessment,
  type SourceCoverageFamily,
} from "@domain-analysis/shared";
import { desc, eq, inArray } from "drizzle-orm";

import { normalizeSnapshot } from "./sourceDatasetNormalization";

const minimumSources = 3;
const minimumFacetSources = 2;
const minimumOrigins = 2;

type PublicSourceMetadata = {
  sourceKey: string;
  url: string;
  publisher: string;
  sourceKind: PublicResearchSourceKind;
  facets: PublicResearchFacet[];
  planId: string;
  planVersion: number;
};

export interface SourceCoverageModule {
  assessTask(taskId: string): Promise<SourceCoverageAssessment>;
}

export function createSourceCoverageModule(
  db: WorkbenchDb,
  now: () => Date = () => new Date(),
): SourceCoverageModule {
  return { assessTask: (taskId) => assessSourceCoverage(db, taskId, now()) };
}

async function assessSourceCoverage(db: WorkbenchDb, taskId: string, assessedAt: Date) {
  const [planRows, batchRows, runRows] = await Promise.all([
    db.select().from(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, taskId))
      .orderBy(desc(sourceCollectionPlans.version)),
    db.select().from(sourceCollectionBatches).where(eq(sourceCollectionBatches.taskId, taskId))
      .orderBy(desc(sourceCollectionBatches.startedAt)),
    db.select().from(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId))
      .orderBy(desc(sourceCollectionRuns.startedAt)),
  ]);
  const runIds = runRows.map((run) => run.id);
  const [snapshotRows, subjectRows, workItemRows, targetRows, attemptRows] = await Promise.all([
    runIds.length > 0 ? db.select().from(sourceSnapshots)
      .where(inArray(sourceSnapshots.runId, runIds)) : [],
    db.select({ id: sourceCaptureSubjects.id,
      executionBatchId: sourceCaptureSubjects.executionBatchId,
      kind: sourceCaptureSubjects.kind }).from(sourceCaptureSubjects)
      .innerJoin(sourceCollectionBatches,
        eq(sourceCollectionBatches.id, sourceCaptureSubjects.executionBatchId))
      .where(eq(sourceCollectionBatches.taskId, taskId)),
    runIds.length > 0 ? db.select({ id: sourceCaptureWorkItems.id,
      runId: sourceCaptureWorkItems.runId, subjectId: sourceCaptureWorkItems.subjectId,
      status: sourceCaptureWorkItems.status }).from(sourceCaptureWorkItems)
      .where(inArray(sourceCaptureWorkItems.runId, runIds)) : [],
    runIds.length > 0 ? db.select({ id: sourceCollectionTargetRuns.id,
      runId: sourceCollectionTargetRuns.runId, status: sourceCollectionTargetRuns.status })
      .from(sourceCollectionTargetRuns).where(inArray(sourceCollectionTargetRuns.runId, runIds)) : [],
    runIds.length > 0 ? db.select({ id: sourceRequestAttempts.id,
      runId: sourceRequestAttempts.runId, state: sourceRequestAttempts.state })
      .from(sourceRequestAttempts).where(inArray(sourceRequestAttempts.runId, runIds)) : [],
  ]);
  const publicRuns = runRows.filter((run) => run.providerKey === "public.web-resource");
  const { metadata, attemptedUrls } = collectPlanMetadata(planRows, publicRuns);
  const acceptedSources = collectAcceptedSources(publicRuns, snapshotRows, metadata);
  const productCatalog = completedProductCatalog(
    batchRows, runRows, subjectRows, workItemRows, snapshotRows,
  );
  const families = sourceCoverageFamilies.map((key) => coverageDimension(
    key,
    acceptedSources.filter((source) => sourceCoverageFamilyKinds[key].includes(source.sourceKind as never)),
    minimumSources,
  ));
  const facets = requiredSourceCoverageFacets.map((key) => coverageDimension(
    key,
    acceptedSources.filter((source) => source.facets.includes(key)),
    minimumFacetSources,
  ));
  const unfinishedExecutionIds = findUnfinishedExecutions(
    batchRows, runRows, targetRows, workItemRows, attemptRows,
  );
  const gaps = [
    ...(productCatalog.status === "gap" ? [{ kind: "product_catalog" as const,
      key: "zol.catalog-gallery", missingSources: 1, missingOrigins: 1,
      targetCandidateCount: 1, targetOriginCount: 1 }] : []),
    ...families.filter((item) => item.status === "gap").map((item) => coverageGap("family", item)),
    ...facets.filter((item) => item.status === "gap").map((item) => coverageGap("facet", item)),
  ];
  return sourceCoverageAssessmentSchema.parse({
    policyVersion: "source-coverage-v1",
    status: unfinishedExecutionIds.length > 0 ? "in_progress" : gaps.length > 0 ? "gaps" : "satisfied",
    productCatalog,
    acceptedSources,
    attemptedUrls: [...attemptedUrls].sort(),
    families,
    facets,
    gaps,
    unfinishedExecutionIds,
    assessedAt: assessedAt.toISOString(),
  });
}

function collectPlanMetadata(
  planRows: (typeof sourceCollectionPlans.$inferSelect)[],
  publicRuns: (typeof sourceCollectionRuns.$inferSelect)[],
) {
  const metadata = new Map<string, PublicSourceMetadata>();
  const attemptedUrls = new Set<string>();
  const executedSources = new Set(publicRuns.flatMap((run) => run.sourceCollectionPlanId
    && run.sourceCollectionPlanVersion && run.sourceCollectionPlanSourceKey
    ? [metadataKey(run.sourceCollectionPlanId, run.sourceCollectionPlanVersion,
      run.sourceCollectionPlanSourceKey)] : []));
  for (const plan of planRows) {
    const content = crawlPlanContentSchema.safeParse(plan.content);
    if (!content.success) continue;
    for (const source of content.data.sources.filter((item) => item.provider.key === "public.web-resource")) {
      // WHY：Draft 只是待确认候选；只有已经创建 Source Run 的来源才算真正进入过执行。
      if (executedSources.has(metadataKey(plan.id, plan.version, source.key))) {
        for (const url of source.entryUrls) attemptedUrls.add(normalizeUrl(url));
      }
    }
    const audit = multiSourcePlanningAuditSchema.safeParse(content.data.researchAudit);
    if (!audit.success) continue;
    const topicFacets = new Map(audit.data.publicSourceResearch.topics.map((topic) => [topic.key, topic.facet]));
    for (const source of audit.data.publicSourceResearch.sources) {
      const facets = [...new Set(source.topics.flatMap((topic) => {
        const facet = topicFacets.get(topic);
        return facet ? [facet] : [];
      }))];
      if (facets.length === 0) continue;
      const sourceKey = `public.${source.key}`;
      metadata.set(metadataKey(plan.id, plan.version, sourceKey), {
        sourceKey, url: normalizeUrl(source.url), publisher: source.publisher,
        sourceKind: source.sourceKind, facets, planId: plan.id, planVersion: plan.version,
      });
    }
  }
  return { metadata, attemptedUrls };
}

function collectAcceptedSources(
  runRows: (typeof sourceCollectionRuns.$inferSelect)[],
  snapshotRows: (typeof sourceSnapshots.$inferSelect)[],
  metadata: Map<string, PublicSourceMetadata>,
) {
  const snapshotsByRun = new Map<string, (typeof sourceSnapshots.$inferSelect)[]>();
  for (const snapshot of snapshotRows) {
    snapshotsByRun.set(snapshot.runId, [...(snapshotsByRun.get(snapshot.runId) ?? []), snapshot]);
  }
  const accepted = new Map<string, SourceCoverageAssessment["acceptedSources"][number]>();
  for (const run of runRows) {
    if (run.status !== "completed" || !run.sourceCollectionPlanId
      || !run.sourceCollectionPlanVersion || !run.sourceCollectionPlanSourceKey) continue;
    const item = metadata.get(metadataKey(run.sourceCollectionPlanId,
      run.sourceCollectionPlanVersion, run.sourceCollectionPlanSourceKey));
    if (!item || accepted.has(item.url)) continue;
    const snapshot = (snapshotsByRun.get(run.id) ?? []).map(normalizeSnapshot).find((candidate) =>
      candidate.observation.state === "accessible"
      && candidate.observation.contentAssessment?.status === "accepted"
      && normalizeUrl(candidate.observation.requestedUrl) === item.url
      && candidate.lineage
      && candidate.payload?.kind !== "legacy_structured_json"
      && (candidate.payload?.bytes ?? 0) > 0);
    if (!snapshot) continue;
    accepted.set(item.url, { ...item, origin: new URL(item.url).origin,
      facetEvidenceBasis: "confirmed_plan_topic_mapping" as const,
      runId: run.id, snapshotId: snapshot.id });
  }
  return [...accepted.values()];
}

function completedProductCatalog(
  batchRows: (typeof sourceCollectionBatches.$inferSelect)[],
  runRows: (typeof sourceCollectionRuns.$inferSelect)[],
  subjectRows: { id: string; executionBatchId: string; kind: "brand" | "product_model" }[],
  workItemRows: { id: string; runId: string; subjectId: string | null;
    status: "pending" | "running" | "completed" | "failed" | "stopped" }[],
  snapshotRows: (typeof sourceSnapshots.$inferSelect)[],
): SourceCoverageAssessment["productCatalog"] {
  const batch = batchRows.find((candidate) => candidate.status === "completed"
    && runRows.some((run) => run.executionBatchId === candidate.id
      && run.providerKey === "zol.catalog-gallery" && run.status === "completed"));
  if (!batch) return { status: "gap" };
  // WHY：恢复链的早期 Run 可以失败，但其中已完成的型号事实仍属于同一不可变 Batch。
  const catalogRuns = runRows.filter((run) => run.executionBatchId === batch.id
    && run.providerKey === "zol.catalog-gallery");
  const catalogRunIds = new Set(catalogRuns.map((run) => run.id));
  const brands = subjectRows.filter((subject) => subject.executionBatchId === batch.id
    && subject.kind === "brand");
  const models = subjectRows.filter((subject) => subject.executionBatchId === batch.id
    && subject.kind === "product_model");
  const acceptedCatalogSnapshots = snapshotRows.filter((row) => catalogRunIds.has(row.runId))
    .map(normalizeSnapshot).filter((snapshot) => snapshot.captureWorkItemId
      && snapshot.lineage
      && snapshot.observation.state === "accessible"
      && snapshot.observation.contentAssessment?.status === "accepted"
      && snapshot.payload?.kind !== "legacy_structured_json"
      && (snapshot.payload?.bytes ?? 0) > 0);
  const acceptedWorkItemKeys = new Set(acceptedCatalogSnapshots
    .map((snapshot) => `${snapshot.runId}\u0000${snapshot.captureWorkItemId}`));
  const completedSubjectIds = new Set(workItemRows.filter((item) => catalogRunIds.has(item.runId)
    && item.status === "completed" && item.subjectId
    && acceptedWorkItemKeys.has(`${item.runId}\u0000${item.id}`)).map((item) => item.subjectId!));
  const coveredModelCount = models.filter((model) => completedSubjectIds.has(model.id)).length;
  // WHY：Run 计数是便于展示的汇总，覆盖门必须回到逐条不可变 Snapshot，避免计数漂移放行空目录。
  const acceptedSnapshotCount = acceptedCatalogSnapshots.length;
  if (brands.length === 0 || models.length === 0 || coveredModelCount !== models.length
    || acceptedSnapshotCount === 0) return { status: "gap" };
  return { status: "satisfied", reference: { providerKey: "zol.catalog-gallery",
    sourceBatchId: batch.id, reason: "同一 Capture Task 的 ZOL Source Dataset 已完成验收" },
    brandCount: brands.length, modelCount: models.length, coveredModelCount, acceptedSnapshotCount };
}

function coverageDimension<Key extends SourceCoverageFamily | (typeof requiredSourceCoverageFacets)[number]>(
  key: Key,
  sources: SourceCoverageAssessment["acceptedSources"],
  minimumAcceptedSources: number,
) {
  const distinctOriginCount = new Set(sources.map((source) => source.origin)).size;
  return { key, acceptedSourceCount: sources.length, distinctOriginCount,
    minimumAcceptedSources, minimumDistinctOrigins: minimumOrigins,
    status: sources.length >= minimumAcceptedSources && distinctOriginCount >= minimumOrigins
      ? "satisfied" as const : "gap" as const };
}

function coverageGap(kind: "family" | "facet", item: ReturnType<typeof coverageDimension>) {
  const missingSources = Math.max(0, item.minimumAcceptedSources - item.acceptedSourceCount);
  const missingOrigins = Math.max(0, item.minimumDistinctOrigins - item.distinctOriginCount);
  return { kind, key: item.key, missingSources, missingOrigins,
    // WHY：两个额外候选让单个入口失败时仍能继续，不把失败重试当作覆盖增长。
    targetCandidateCount: missingSources + 2,
    targetOriginCount: Math.max(3, missingOrigins + 1) };
}

function findUnfinishedExecutions(
  batchRows: (typeof sourceCollectionBatches.$inferSelect)[],
  runRows: (typeof sourceCollectionRuns.$inferSelect)[],
  targetRows: { id: string; runId: string;
    status: "pending" | "running" | "completed" | "failed" | "stopped" }[],
  workItemRows: { id: string; runId: string;
    status: "pending" | "running" | "completed" | "failed" | "stopped" }[],
  attemptRows: { id: string; runId: string;
    state: "started" | "completed" | "restricted" | "failed" | "cancelled" }[],
) {
  const result = new Set(runRows.filter((run) => run.status === "running").map((run) => run.id));
  for (const target of targetRows.filter((item) => item.status === "pending" || item.status === "running")) {
    result.add(target.id);
  }
  for (const workItem of workItemRows.filter((item) => item.status === "pending" || item.status === "running")) {
    result.add(workItem.id);
  }
  for (const attempt of attemptRows.filter((item) => item.state === "started")) result.add(attempt.id);
  for (const batch of batchRows) {
    // WHY：failed/stopped/partial 都是可审计终态；只有活动 Batch 或已进入恢复调度的 Batch 才阻止缺口规划。
    if (batch.status === "running" || batch.recoveryState === "pending"
      || batch.recoveryState === "running") result.add(batch.id);
  }
  return [...result];
}

function metadataKey(planId: string, planVersion: number, sourceKey: string) {
  return `${planId}\u0000${planVersion}\u0000${sourceKey}`;
}

function normalizeUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}
