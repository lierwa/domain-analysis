import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  EvidenceRequestDraft,
  ProductProjectDraftInput,
} from "@domain-analysis/shared";
import { openKnowledgeRuntime } from "@domain-analysis/knowledge-runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  openProductKnowledgeWorkbench,
  type ProductKnowledgeWorkbench,
} from "../src/productKnowledgeWorkbench";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("SourceDataset → Evidence → Factory → Review integration", () => {
  const open: ProductKnowledgeWorkbench[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(open.splice(0).map((workbench) => workbench.close()));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("同一条生产链处理微波炉和电视，并且重跑不重复证据或知识批次", async () => {
    const microwave = await executeCategory({
      categoryCode: "microwave_oven",
      label: "微波炉",
      targetKey: "model:mw-900",
      targetLabel: "MW-900",
      attributeCode: "heating.power",
      attributeLabel: "微波输出功率",
      value: "900",
      unit: "W",
    });
    const television = await executeCategory({
      categoryCode: "television",
      label: "电视",
      targetKey: "model:tv-144",
      targetLabel: "TV-144",
      attributeCode: "display.refresh_rate",
      attributeLabel: "刷新率",
      value: "144",
      unit: "Hz",
    });

    expect(microwave.reviewed).toMatchObject({
      subject: { kind: "model", key: "model:mw-900" },
      predicate: "heating.power",
      value: { kind: "decimal", raw: "规格参数\n微波输出功率: 900 W", value: 900, unitCode: "W" },
    });
    expect(television.reviewed).toMatchObject({
      subject: { kind: "model", key: "model:tv-144" },
      predicate: "display.refresh_rate",
      value: { kind: "decimal", raw: "规格参数\n刷新率: 144 Hz", value: 144, unitCode: "Hz" },
    });
    expect(microwave.batch.candidates).toHaveLength(1);
    expect(television.batch.candidates).toHaveLength(1);
    expect(microwave.runtimeState).toMatchObject({ kind: "fact", entry: { predicate: "heating.power" } });
    expect(television.runtimeState).toMatchObject({ kind: "fact", entry: { predicate: "display.refresh_rate" } });
  });

  it("同属性出现两个值时只产生冲突，人工选择后才形成已审核知识", async () => {
    const fixture = categoryFixture({
      categoryCode: "television",
      label: "电视",
      targetKey: "model:tv-conflict",
      targetLabel: "TV-Conflict",
      attributeCode: "display.refresh_rate",
      attributeLabel: "刷新率",
      value: "120",
      unit: "Hz",
    });
    const workbench = await openWorkbench();
    const project = await confirmProject(workbench, fixture);
    const request = await workbench.evidence.createRequest({
      ...requestDraft(project, fixture),
      minimumEvidenceItemsPerTarget: 2,
      minimumDistinctSourcesPerTarget: 2,
    });
    const evidenceIds = [];
    for (const [index, value] of ["120", "144"].entries()) {
      const snapshot = await createSnapshot(workbench, project.project.id, fixture, {
        sourceIdentity: `fixture-source-${index + 1}`,
        value,
      });
      const item = await workbench.sourceEvidence.materialize({
        requestId: request.id,
        snapshotId: snapshot.snapshot.id,
        selection: { kind: "ordered_field", groupIndex: 0, fieldIndex: 0 },
      });
      evidenceIds.push(item.id);
    }

    const batch = await workbench.knowledgeFactory.run({
      projectId: project.project.id,
      categoryDefinitionVersionId: project.categoryDefinition.id,
      recipeVersion: "factory-recipe-v1",
      evidenceRequestIds: [request.id],
    });
    expect(batch.candidates).toHaveLength(0);
    expect(batch.conflicts).toMatchObject([{
      reasonCode: "distinct_normalized_values",
      alternatives: [
        { evidenceIds: [evidenceIds[0]] },
        { evidenceIds: [evidenceIds[1]] },
      ],
    }]);
    expect(await workbench.knowledgeReview.listReviewed(project.project.id)).toEqual([]);

    const conflict = batch.conflicts[0]!;
    await workbench.knowledgeReview.decide({
      batchId: batch.batch.id,
      reviewer: "fixture-reviewer",
      rationale: "fixture 明确选择第二个来源值",
      grouping: {
        categoryDefinitionVersionId: project.categoryDefinition.id,
        knowledgeNeedId: request.knowledgeNeed.id,
        reasonCode: conflict.reasonCode,
        evidenceKind: "web_text",
        sourceAuthorityType: "brand_official_site",
      },
      selection: {
        action: "resolve_conflict",
        targetIds: [conflict.id],
        selectedAlternativeIndex: 1,
      },
    });
    const reviewed = await workbench.knowledgeReview.listReviewed(project.project.id);
    expect(reviewed).toMatchObject([{
      sourceTargetKind: "conflict",
      sourceTargetId: conflict.id,
      value: { kind: "decimal", raw: "规格参数\n刷新率: 144 Hz", value: 144, unitCode: "Hz" },
      evidenceIds: [evidenceIds[1]],
    }]);
  });

  it("来源没有明确派生发布许可时，即使证据可保存也不能接受为知识", async () => {
    const fixture = categoryFixture({
      categoryCode: "television",
      label: "电视",
      targetKey: "model:tv-private",
      targetLabel: "TV-Private",
      attributeCode: "display.refresh_rate",
      attributeLabel: "刷新率",
      value: "120",
      unit: "Hz",
    });
    const workbench = await openWorkbench();
    const project = await confirmProject(workbench, fixture);
    const request = await workbench.evidence.createRequest(requestDraft(project, fixture));
    const snapshot = await createSnapshot(workbench, project.project.id, fixture, {
      sourceIdentity: "fixture-local-only",
      value: fixture.value,
      derivedKnowledgePublication: "denied",
    });
    const item = await workbench.sourceEvidence.materialize({
      requestId: request.id,
      snapshotId: snapshot.snapshot.id,
      selection: { kind: "ordered_field", groupIndex: 0, fieldIndex: 0 },
    });
    expect(item.privacyClass).toBe("public");
    const batch = await workbench.knowledgeFactory.run({
      projectId: project.project.id,
      categoryDefinitionVersionId: project.categoryDefinition.id,
      recipeVersion: "factory-recipe-v1",
      evidenceRequestIds: [request.id],
    });
    await expect(workbench.knowledgeReview.decide({
      batchId: batch.batch.id,
      reviewer: "fixture-reviewer",
      rationale: "不应绕过来源发布许可",
      grouping: { categoryDefinitionVersionId: project.categoryDefinition.id },
      selection: { action: "accept_candidates", targetIds: [batch.candidates[0]!.id] },
    })).rejects.toMatchObject({ code: "publication_not_allowed" });
  });

  async function executeCategory(input: CategoryFixture) {
    const fixture = categoryFixture(input);
    const workbench = await openWorkbench();
    const project = await confirmProject(workbench, fixture);
    const request = await workbench.evidence.createRequest(requestDraft(project, fixture));
    const snapshot = await createSnapshot(workbench, project.project.id, fixture, {
      sourceIdentity: "fixture-brand-site",
      value: fixture.value,
    });
    const firstEvidence = await workbench.sourceEvidence.materialize({
      requestId: request.id,
      snapshotId: snapshot.snapshot.id,
      selection: { kind: "ordered_field", groupIndex: 0, fieldIndex: 0 },
    });
    const repeatedEvidence = await workbench.sourceEvidence.materialize({
      requestId: request.id,
      snapshotId: snapshot.snapshot.id,
      selection: { kind: "ordered_field", groupIndex: 0, fieldIndex: 0 },
    });
    expect(repeatedEvidence.id).toBe(firstEvidence.id);

    const runInput = {
      projectId: project.project.id,
      categoryDefinitionVersionId: project.categoryDefinition.id,
      recipeVersion: "factory-recipe-v1",
      evidenceRequestIds: [request.id],
    };
    const batch = await workbench.knowledgeFactory.run(runInput);
    const repeatedBatch = await workbench.knowledgeFactory.run(runInput);
    expect(repeatedBatch.batch.id).toBe(batch.batch.id);
    const candidate = batch.candidates[0]!;
    await workbench.knowledgeReview.decide({
      batchId: batch.batch.id,
      reviewer: "fixture-reviewer",
      rationale: "fixture 字段与证据一致",
      grouping: {
        categoryDefinitionVersionId: project.categoryDefinition.id,
        knowledgeNeedId: request.knowledgeNeed.id,
        evidenceKind: "web_text",
        sourceAuthorityType: "brand_official_site",
      },
      selection: { action: "accept_candidates", targetIds: [candidate.id] },
    });
    const reviewed = (await workbench.knowledgeReview.listReviewed(project.project.id))[0]!;
    const descriptor = await workbench.knowledgePackages.build(project.project.id);
    await workbench.knowledgePackages.activate(project.project.id, descriptor.versionHash);
    const runtime = await openKnowledgeRuntime(descriptor.filePath, descriptor.databaseSha256);
    const runtimeState = (await runtime.exact({
      subjectKey: fixture.targetKey,
      predicate: fixture.attributeCode,
    }))[0];
    runtime.close();
    return { batch, reviewed, runtimeState };
  }

  async function openWorkbench() {
    const prefix = `knowledge-${randomUUID()}`;
    const root = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
    roots.push(root);
    const projectCounters = { project: 0, definition: 0, scope: 0, board: 0 };
    const sourceCounters = { plan: 0, run: 0, object: 0, snapshot: 0, asset: 0 };
    const evidenceCounters = { request: 0, observation: 0, evidence: 0 };
    const workbench = await openProductKnowledgeWorkbench({
      databaseUrl: databaseUrl!,
      evidenceRoot: root,
      productProjectModule: {
        now: () => new Date("2026-08-17T07:00:00.000Z"),
        createId: (kind) => `${prefix}-${kind}-${++projectCounters[kind]}`,
      },
      sourceDatasetModule: {
        now: () => new Date("2026-08-17T08:00:00.000Z"),
        createId: (kind) => `${prefix}-${kind}-${++sourceCounters[kind]}`,
      },
      evidenceModule: {
        now: () => new Date("2026-08-17T09:00:00.000Z"),
        createId: (kind) => `${prefix}-${kind}-${++evidenceCounters[kind]}`,
      },
      knowledgeFactoryModule: { now: () => new Date("2026-08-17T10:00:00.000Z") },
      knowledgeReviewModule: { now: () => new Date("2026-08-17T11:00:00.000Z") },
      knowledgePackageModule: {
        root: path.join(root, "knowledge-packages"),
        now: () => new Date("2026-08-17T12:00:00.000Z"),
      },
    });
    open.push(workbench);
    return workbench;
  }
});

async function confirmProject(workbench: ProductKnowledgeWorkbench, fixture: CategoryFixture) {
  const draft = await workbench.productProjects.saveDraft(projectDraft(fixture));
  return workbench.productProjects.confirm(draft.project.id, draft.project.revision);
}

async function createSnapshot(
  workbench: ProductKnowledgeWorkbench,
  projectId: string,
  fixture: CategoryFixture,
  source: {
    sourceIdentity: string;
    value: string;
    derivedKnowledgePublication?: "allowed" | "denied" | "unknown";
  },
) {
  const run = await workbench.sourceDatasets.startRun({
    projectId,
    collectionLaneId: laneId(fixture),
    providerKey: source.sourceIdentity,
    accessPolicy: { kind: "manual", version: "fixture-v1" },
  });
  const record = await workbench.sourceDatasets.commitSnapshot({
    runId: run.id,
    idempotencyKey: `${source.sourceIdentity}-${source.value}`,
    object: { sourceIdentity: source.sourceIdentity, kind: "product", externalKey: fixture.targetLabel },
    targetKeys: [fixture.targetKey],
    knowledgeNeedIds: [needId(fixture)],
    observation: {
      requestedUrl: `https://example.com/${fixture.categoryCode}/${source.sourceIdentity}`,
      finalUrl: `https://example.com/${fixture.categoryCode}/${source.sourceIdentity}`,
      observedAt: "2026-08-17T08:00:00.000Z",
      state: "accessible",
    },
    content: {
      kind: "ordered_record",
      title: fixture.targetLabel,
      fieldGroups: [{
        label: "规格参数",
        fields: [{ name: fixture.attributeLabel, value: source.value, unit: fixture.unit }],
      }],
      blocks: [],
    },
    parsing: { adapterId: "fixture", adapterVersion: "v1" },
    claimScopes: ["model_fact"],
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: source.derivedKnowledgePublication ?? "allowed",
      sourceRedistribution: "allowed",
      basis: "项目自有 fixture",
    },
    relations: [],
  });
  await workbench.sourceDatasets.finishRun({ runId: run.id, status: "completed" });
  return record;
}

function requestDraft(
  project: Awaited<ReturnType<ProductKnowledgeWorkbench["productProjects"]["confirm"]>>,
  fixture: CategoryFixture,
): EvidenceRequestDraft {
  return {
    projectId: project.project.id,
    categoryDefinitionVersionId: project.categoryDefinition.id,
    confirmedScopeVersionId: project.confirmedScope.id,
    collectionBoardVersionId: project.collectionBoard.id,
    collectionLaneIds: [laneId(fixture)],
    knowledgeNeed: { id: needId(fixture), kind: "attribute", attributeCode: fixture.attributeCode },
    question: `${fixture.targetLabel} 的${fixture.attributeLabel}是多少？`,
    knowledgeLayer: "specification",
    targetKeys: [fixture.targetKey],
    allowedSourceAuthorityTypes: ["brand_official_site"],
    acceptedEvidenceKinds: ["web_text"],
    evidenceByteLimits: { web_text: 4096 },
    freshness: { maxAgeDays: 30 },
    minimumEvidenceItemsPerTarget: 1,
    minimumDistinctSourcesPerTarget: 1,
    evidencePolicyVersion: "fixture-policy-v1",
    stopConditions: ["access_denied", "source_abnormal"],
    priority: 50,
  };
}

function projectDraft(fixture: CategoryFixture): ProductProjectDraftInput {
  return {
    name: `${fixture.label}知识工厂 fixture`,
    knowledgeTopic: `${fixture.label}型号事实`,
    market: "CN",
    categoryDefinition: {
      categoryCode: fixture.categoryCode,
      label: fixture.label,
      sourceAuthorityPolicy: ["brand_official_site"],
      attributes: [{
        code: fixture.attributeCode,
        label: fixture.attributeLabel,
        description: `${fixture.label}${fixture.attributeLabel}`,
        knowledgeLayer: "specification",
        valueKind: "decimal",
        canonicalUnitCode: fixture.unit,
        externalMappings: [fixture.attributeLabel],
        filterable: true,
        comparable: true,
      }],
      decisionDimensions: [{
        code: "product.comparison",
        label: "商品比较",
        description: "比较同品类型号规格",
        relatedAttributeCodes: [fixture.attributeCode],
      }],
      competencyQuestions: [`怎样比较${fixture.label}？`],
    },
    confirmedScope: {
      populationLayers: ["official_current_catalog"],
      targets: [{
        key: fixture.targetKey,
        kind: "model",
        label: fixture.targetLabel,
        evidenceReferenceIds: [`scope:${fixture.categoryCode}`],
        disposition: "included",
        reason: "跨品类知识工厂 fixture",
      }],
    },
    collectionBoard: {
      lanes: [{
        id: laneId(fixture),
        sourceAuthorityType: "brand_official_site",
        accessMode: "public_web",
        targetKeys: [fixture.targetKey],
        knowledgeLayers: ["specification"],
        refreshPolicy: "manual",
        stopConditions: ["access_denied", "source_abnormal"],
      }],
    },
  };
}

function categoryFixture(input: CategoryFixture): CategoryFixture {
  return input;
}

function laneId(fixture: CategoryFixture) {
  return `lane:${fixture.categoryCode}:official`;
}

function needId(fixture: CategoryFixture) {
  return `need:${fixture.attributeCode}`;
}

interface CategoryFixture {
  categoryCode: string;
  label: string;
  targetKey: string;
  targetLabel: string;
  attributeCode: string;
  attributeLabel: string;
  value: string;
  unit: string;
}
