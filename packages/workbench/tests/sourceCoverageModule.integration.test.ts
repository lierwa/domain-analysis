import { randomUUID } from "node:crypto";

import {
  captureTasks,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  sourceCollectionBatches,
  sourceCollectionPlans,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceCaptureSubjects,
  sourceCaptureWorkItems,
  sourceObjects,
  sourceSnapshots,
  type WorkbenchDb,
} from "@domain-analysis/db";
import {
  crawlPlanContentSchema,
  publicSourceResearchSchema,
  type PublicSourceResearch,
} from "@domain-analysis/shared";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createSourceCoverageModule } from "../src/sourceCoverageModule";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;
const at = "2026-09-01T00:00:00.000Z";

describeWithPostgres("Source Dataset 原始资料最低覆盖", () => {
  let db: WorkbenchDb | undefined;
  let taskId: string | undefined;

  afterEach(async () => {
    if (db && taskId) {
      const runs = await db.select({ id: sourceCollectionRuns.id }).from(sourceCollectionRuns)
        .where(eq(sourceCollectionRuns.taskId, taskId));
      if (runs.length > 0) await db.delete(sourceSnapshots)
        .where(inArray(sourceSnapshots.runId, runs.map((run) => run.id)));
      if (runs.length > 0) await db.delete(sourceCollectionTargetRuns)
        .where(inArray(sourceCollectionTargetRuns.runId, runs.map((run) => run.id)));
      await db.delete(sourceObjects).where(eq(sourceObjects.taskId, taskId));
      await db.delete(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId));
      await db.delete(sourceCollectionBatches).where(eq(sourceCollectionBatches.taskId, taskId));
      await db.delete(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, taskId));
      await db.delete(captureTasks).where(eq(captureTasks.id, taskId));
    }
    await db?.$client.end();
  });

  it("只计算已完成 Run 的 accepted 非空快照，并分别报告全部来源族和主题缺口", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-coverage-${randomUUID()}`;
    const planId = `plan-coverage-${randomUUID()}`;
    const zolBatchId = `batch-zol-${randomUUID()}`;
    const publicBatchId = `batch-public-${randomUUID()}`;
    const research = researchFixture();
    const content = planContent(taskId, zolBatchId, research);
    await db.insert(captureTasks).values({ id: taskId, name: "微波炉资料覆盖",
      originalRequest: "抓微波炉原始资料", marketScope: "中国大陆", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: planId, taskId, taskRevision: 1,
      version: 1, status: "confirmed", contentHash: "a".repeat(64), content,
      createdAt: at, confirmedAt: at });
    const draftOnlyUrl = "https://draft-only.example.org/not-executed";
    await db.insert(sourceCollectionPlans).values({ id: `plan-draft-${randomUUID()}`, taskId,
      taskRevision: 1, version: 2, status: "draft", contentHash: "c".repeat(64),
      content: { ...content, sources: [{ ...content.sources[0]!, key: "public.draft-only",
        entryUrls: [draftOnlyUrl], targets: [{ ...content.sources[0]!.targets[0]!,
          key: "public.draft-only.resource", providerConfiguration: [
            { key: "route", value: "exact" }, { key: "url", value: draftOnlyUrl },
          ] }] }] }, createdAt: at });
    await db.insert(sourceCollectionBatches).values([
      { id: zolBatchId, taskId, sourceCollectionPlanId: planId, sourceCollectionPlanVersion: 1,
        taskRevision: 1, status: "completed", plannedSourceCount: 1, startedAt: at, finishedAt: at },
      { id: publicBatchId, taskId, sourceCollectionPlanId: planId, sourceCollectionPlanVersion: 1,
        taskRevision: 1, status: "partial", plannedSourceCount: research.sources.length,
        startedAt: at, finishedAt: at },
    ]);
    const zolRunId = `run-zol-${randomUUID()}`;
    await db.insert(sourceCollectionRuns).values({ id: zolRunId, taskId,
      executionBatchId: zolBatchId, sourceCollectionPlanId: planId,
      sourceCollectionPlanSourceKey: "zol.catalog", sourceCollectionPlanVersion: 1,
      providerKey: "zol.catalog-gallery", providerVersion: "1.2.0", requestBudget: 1,
      accessPolicy: runAccessPolicy(), status: "completed", snapshotCount: 1, accessibleCount: 1,
      startedAt: at, finishedAt: at });
    const brandSubjectId = `brand-${randomUUID()}`;
    const modelSubjectId = `model-${randomUUID()}`;
    await db.insert(sourceCaptureSubjects).values([
      { id: brandSubjectId, executionBatchId: zolBatchId, sourceKey: "zol.catalog",
        kind: "brand", sourceEntityId: "fixture-brand", displayName: "Fixture 品牌", createdAt: at },
      { id: modelSubjectId, executionBatchId: zolBatchId, sourceKey: "zol.catalog",
        kind: "product_model", sourceEntityId: "fixture-model", displayName: "Fixture 型号",
        parentSubjectId: brandSubjectId, createdAt: at },
    ]);
    const modelWorkItemId = `work-${randomUUID()}`;
    await db.insert(sourceCaptureWorkItems).values({ id: modelWorkItemId, runId: zolRunId,
      subjectId: modelSubjectId, targetKey: "models", workKey: "model:fixture-model",
      captureUnit: "zol_model_bundle", observedUnitCount: 1, status: "completed",
      createdAt: at, startedAt: at, finishedAt: at });

    for (const source of research.sources) {
      const misbound = source.key === "technical-blocked";
      const runId = `run-${source.key}-${randomUUID()}`;
      await db.insert(sourceCollectionRuns).values({ id: runId, taskId,
        executionBatchId: publicBatchId, sourceCollectionPlanId: planId,
        sourceCollectionPlanSourceKey: `public.${source.key}`, sourceCollectionPlanVersion: 1,
        providerKey: "public.web-resource", providerVersion: "2.0.0", requestBudget: 1,
        accessPolicy: runAccessPolicy(), status: "completed", snapshotCount: 1,
        accessibleCount: 1, startedAt: at, finishedAt: at });
      await insertAcceptedSnapshot(db, taskId, runId,
        misbound ? "https://other.example.org/not-the-planned-url" : source.url);
    }

    const withoutCatalogSnapshot = await createSourceCoverageModule(db, () => new Date(at))
      .assessTask(taskId);
    expect(withoutCatalogSnapshot.productCatalog.status).toBe("gap");
    await insertAcceptedSnapshot(db, taskId, zolRunId,
      "https://detail.zol.com.cn/microwave_oven/fixture.html", modelWorkItemId, "models");

    const coverage = await createSourceCoverageModule(db, () => new Date(at)).assessTask(taskId);

    expect(coverage.productCatalog).toMatchObject({ status: "satisfied",
      reference: { sourceBatchId: zolBatchId } });
    expect(coverage.acceptedSources).toHaveLength(7);
    expect(coverage.attemptedUrls).toHaveLength(8);
    expect(coverage.attemptedUrls).not.toContain(draftOnlyUrl);
    expect(coverage.unfinishedExecutionIds).toEqual([]);
    expect(dimension(coverage.families, "standards_and_regulation")).toMatchObject({
      status: "satisfied", acceptedSourceCount: 3, distinctOriginCount: 2,
    });
    expect(dimension(coverage.families, "professional_technical")).toMatchObject({
      status: "gap", acceptedSourceCount: 1, distinctOriginCount: 1,
    });
    expect(dimension(coverage.families, "brand_official")).toMatchObject({
      status: "satisfied", acceptedSourceCount: 3, distinctOriginCount: 2,
    });
    expect(dimension(coverage.facets, "operating_principle")).toMatchObject({
      status: "gap", minimumAcceptedSources: 2, acceptedSourceCount: 1,
    });
    expect(coverage.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "family", key: "professional_technical",
        missingSources: 2, targetCandidateCount: 4 }),
      expect.objectContaining({ kind: "facet", key: "core_components" }),
    ]));

    const pendingTargetId = `target-${randomUUID()}`;
    const publicRunId = coverage.acceptedSources[0]!.runId;
    await db.insert(sourceCollectionTargetRuns).values({ id: pendingTargetId, runId: publicRunId,
      targetKey: "pending-target", status: "pending" });
    const inProgress = await createSourceCoverageModule(db, () => new Date(at)).assessTask(taskId);
    expect(inProgress.status).toBe("in_progress");
    expect(inProgress.unfinishedExecutionIds).toContain(pendingTargetId);

    await db.update(sourceCollectionTargetRuns).set({ status: "completed", finishedAt: at })
      .where(eq(sourceCollectionTargetRuns.id, pendingTargetId));
    await db.update(sourceCollectionBatches).set({ status: "stopped",
      plannedSourceCount: research.sources.length + 1, finishedAt: at })
      .where(eq(sourceCollectionBatches.id, publicBatchId));
    const stopped = await createSourceCoverageModule(db, () => new Date(at)).assessTask(taskId);
    expect(stopped.status).toBe("gaps");
    expect(stopped.unfinishedExecutionIds).not.toContain(publicBatchId);

    await db.update(sourceCollectionBatches).set({ recoveryState: "pending" })
      .where(eq(sourceCollectionBatches.id, publicBatchId));
    const recovering = await createSourceCoverageModule(db, () => new Date(at)).assessTask(taskId);
    expect(recovering.status).toBe("in_progress");
    expect(recovering.unfinishedExecutionIds).toContain(publicBatchId);
  });
});

function planContent(taskId: string, zolBatchId: string, research: PublicSourceResearch) {
  return crawlPlanContentSchema.parse({ taskId, taskRevision: 1, summary: "资料覆盖 fixture",
    excludedContent: [], planningBlockers: [], executionChecklistVersion: 6,
    researchAudit: { kind: "multi_source_planning", observedAt: at,
      productCatalog: { kind: "completed_source_reference", providerKey: "zol.catalog-gallery",
        sourceBatchId: zolBatchId, reason: "ZOL 已完成", observedAt: at },
      publicSourceResearch: research },
    sources: research.sources.map((source) => ({ key: `public.${source.key}`, name: source.name,
      publisher: source.publisher, sourceKind: source.sourceKind, sourceCandidateIds: [],
      role: source.reason, entryUrls: [source.url],
      provider: { key: "public.web-resource", version: "2.0.0", configuration: [] },
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 1, maximumRunMs: 1_000 },
      stopPolicy: { requestBudget: 1, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
      rawOutputPolicy: { formats: ["html"], retainAssets: false },
      observationLevel: "search_discovered", accessState: "public", observedAt: at,
      targets: [{ key: `public.${source.key}.resource`, name: source.name,
        taskTopics: ["原始资料"], captureUnit: "公开网页", rawFormats: ["HTML"],
        quantity: { mode: "target_count", targetCount: 1, unit: "入口", denominator: "1",
          rationale: "覆盖测试" }, uniqueKey: "URL", traversal: "exact URL",
        stopCondition: "一次完成", providerConfiguration: [] }], executionBlockers: [] })) });
}

function researchFixture() {
  const topics = [
    topic("principle", "operating_principle"), topic("components", "core_components"),
    topic("safety", "safety_and_regulation"), topic("testing", "performance_and_testing"),
    topic("maintenance", "use_and_maintenance"),
  ];
  return publicSourceResearchSchema.parse({ topics, blocked: [], sources: [
    source("standard-one", "standards_body", "https://std-a.example.org/one", ["safety", "testing"]),
    source("standard-two", "regulator", "https://std-b.example.org/two", ["safety", "testing"]),
    source("standard-three", "standards_body", "https://std-a.example.org/three", ["safety"]),
    source("technical-one", "industry_organization", "https://tech-a.example.org/one",
      ["principle", "components"]),
    source("technical-blocked", "technical_publisher", "https://tech-b.example.org/two",
      ["principle", "components"]),
    source("brand-one", "brand_official", "https://brand-a.example.org/one", ["maintenance", "testing"]),
    source("brand-two", "brand_official", "https://brand-b.example.org/two", ["maintenance"]),
    source("brand-three", "brand_official", "https://brand-a.example.org/three", ["maintenance"]),
  ] });
}

function topic(key: string, facet: string) {
  return { key, facet, label: key, searchTerms: [`${key} 资料`, `${key} 原文`], purpose: `${key} 原始资料` };
}

function source(key: string, sourceKind: string, url: string, topics: string[]) {
  return { key, name: key, publisher: `${key} publisher`, sourceKind, url, topics,
    rawFormats: ["HTML"], reason: `${key} 原始入口` };
}

function runAccessPolicy() {
  return { kind: "paced_http" as const, version: "fixture", maxRequestsPerMinute: 1,
    minimumIntervalMs: 1, maximumRunMs: 1_000, jitterMs: { min: 0, max: 0 },
    batchSize: 1, batchCooldownMs: 1 };
}

async function insertAcceptedSnapshot(
  db: WorkbenchDb,
  taskId: string,
  runId: string,
  url: string,
  captureWorkItemId?: string,
  targetKey = "public.resource",
) {
  const objectId = `object-${randomUUID()}`;
  await db.insert(sourceObjects).values({ id: objectId, taskId, sourceIdentity: url,
    kind: "public_resource", externalKey: url, createdAt: at });
  await db.insert(sourceSnapshots).values({ id: `snapshot-${randomUUID()}`, runId,
    captureWorkItemId, targetKey, objectId, idempotencyKey: `snapshot-${randomUUID()}`,
    lineage: { workKey: `work-${randomUUID()}`, discoveryKind: "planned_entry", depth: 0 },
    observation: { requestedUrl: url, finalUrl: url, observedAt: at, state: "accessible",
      httpStatus: 200, responseHeaders: {}, contentAssessment: { status: "accepted",
        ruleVersion: "fixture", matchedSignals: ["non-empty"], reason: "原始响应非空" } },
    payload: { kind: "inline_text", mediaType: "text/html", charset: "utf-8", text: "fixture",
      bytes: 7, contentHash: "b".repeat(64) }, contentHash: "b".repeat(64), createdAt: at });
}

function dimension<T extends { key: string }>(items: T[], key: string) {
  return items.find((item) => item.key === key);
}
