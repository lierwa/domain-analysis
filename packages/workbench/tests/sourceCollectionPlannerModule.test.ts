import {
  categoryResearchBriefVersionSchema,
  productProjectViewSchema,
  sourceCollectionPlanSchema,
  sourceCollectionPipelineRunSchema,
  sourceCollectionRunSchema,
  type CategoryResearchBriefVersion,
  type ProductProjectView,
  type SourceCollectionPlan,
  type SourceCollectionRequest,
} from "@domain-analysis/shared";
import { describe, expect, it, vi } from "vitest";

import type { CategoryInterviewModule } from "../src/categoryInterviewModule";
import type { ProductProjectModule } from "../src/productProjectModule";
import type { SourceCollectionPipelineModule } from "../src/sourceCollectionPipelineModule";
import {
  createSourceCollectionPlannerModule,
  type SourceCollectionPlanningRule,
} from "../src/sourceCollectionPlannerModule";
import type { SaveSourceCollectionPlan, SourceDatasetModule } from "../src/sourceDatasetModule";

const now = "2026-08-17T08:00:00.000Z";
const hash = "a".repeat(64);

describe("SourceCollectionPlannerModule", () => {
  it("同一个 Planner 为冰箱和电视生成确定性且带知识目的的生产工作项", async () => {
    const fixtures = [
      categoryFixture("refrigerator", "冰箱", "category:refrigerator", "https://example.com/refrigerators"),
      categoryFixture("television", "电视", "category:television", "https://example.com/televisions"),
    ];
    const datasets = datasetHarness(new Map(fixtures.map(({ project }) => [project.project.id, project])));
    const pipeline = pipelineHarness();
    const planner = createSourceCollectionPlannerModule(
      projectModule(fixtures),
      interviewModule(fixtures),
      datasets.module,
      pipeline.module,
      { recipeVersion: "source-plan-v1", rules: [allowedRule()] },
    );

    const refrigeratorPlan = await planner.plan("project-refrigerator");
    const repeatedPlan = await planner.plan("project-refrigerator");
    const televisionPlan = await planner.plan("project-television");
    expect(repeatedPlan.id).toBe(refrigeratorPlan.id);
    expect(refrigeratorPlan.content.lanes[0]?.batches[0]?.workItems[0]).toMatchObject({
      requestedUrl: "https://example.com/refrigerators",
      targetKeys: ["category:refrigerator"],
      knowledgeNeedIds: ["need-refrigerator"],
    });
    expect(televisionPlan.content.lanes[0]?.batches[0]?.workItems[0]).toMatchObject({
      requestedUrl: "https://example.com/televisions",
      targetKeys: ["category:television"],
      knowledgeNeedIds: ["need-television"],
    });

    await planner.start("project-television");
    expect(datasets.startRun).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-television",
      sourceCollectionPlanId: televisionPlan.id,
    }));
    expect(pipeline.start).toHaveBeenCalledWith(expect.objectContaining({
      workItems: [expect.objectContaining({
        targetKeys: ["category:television"],
        knowledgeNeedIds: ["need-television"],
      })],
    }));
  });

  it("权限不允许时保留 typed waiting，不创建来源运行", async () => {
    const fixture = categoryFixture(
      "refrigerator",
      "冰箱",
      "category:refrigerator",
      "https://example.com/refrigerators",
    );
    const datasets = datasetHarness(new Map([[fixture.project.project.id, fixture.project]]));
    const pipeline = pipelineHarness();
    const planner = createSourceCollectionPlannerModule(
      projectModule([fixture]),
      interviewModule([fixture]),
      datasets.module,
      pipeline.module,
      {
        recipeVersion: "source-plan-v1",
        rules: [{
          ...allowedRule(),
          usagePermission: {
            ...allowedRule().usagePermission,
            localRead: "denied",
            basis: "来源条款禁止本地读取",
          },
        }],
      },
    );

    const plan = await planner.plan("project-refrigerator");
    expect(plan.content.lanes).toEqual([expect.objectContaining({
      status: "waiting",
      batches: [],
      issues: [expect.objectContaining({ code: "local_read_not_allowed" })],
    })]);
    await expect(planner.start("project-refrigerator")).rejects.toMatchObject({
      code: "no_executable_work",
    });
    expect(datasets.startRun).not.toHaveBeenCalled();
    expect(pipeline.start).not.toHaveBeenCalled();
  });

  it("证据保存许可未知时同样不生成可执行批次", async () => {
    const fixture = categoryFixture(
      "television",
      "电视",
      "category:television",
      "https://example.com/televisions",
    );
    const datasets = datasetHarness(new Map([[fixture.project.project.id, fixture.project]]));
    const rule = allowedRule();
    rule.usagePermission.evidenceStorage = "unknown";
    const planner = createSourceCollectionPlannerModule(
      projectModule([fixture]),
      interviewModule([fixture]),
      datasets.module,
      pipelineHarness().module,
      { recipeVersion: "source-plan-v1", rules: [rule] },
    );

    const plan = await planner.plan("project-television");
    expect(plan.content.lanes[0]).toMatchObject({
      status: "waiting",
      issues: [expect.objectContaining({ code: "evidence_storage_not_allowed" })],
    });
    expect(datasets.startRun).not.toHaveBeenCalled();
  });

  it("只把 confirmed brief 中的通用资源选择请求交给声明支持它的 Provider", async () => {
    const request: SourceCollectionRequest = {
      kind: "document_excerpt",
      requiredIdentityText: "MODEL-TV-1",
      requiredSectionTerms: ["安装距离"],
      section: "安装条件",
      maximumSourceBytes: 2_000_000,
      maximumExcerptBytes: 100_000,
    };
    const fixture = categoryFixture(
      "television",
      "电视",
      "category:television",
      "https://example.com/manual.pdf",
      request,
    );
    const datasets = datasetHarness(new Map([[fixture.project.project.id, fixture.project]]));
    const planner = createSourceCollectionPlannerModule(
      projectModule([fixture]),
      interviewModule([fixture]),
      datasets.module,
      pipelineHarness().module,
      {
        recipeVersion: "source-plan-v1",
        rules: [{ ...allowedRule(), requestKinds: ["document_excerpt"] }],
      },
    );

    const plan = await planner.plan("project-television");
    expect(plan.content.lanes[0]?.batches[0]?.workItems[0]?.request).toEqual(request);

    const unsupported = createSourceCollectionPlannerModule(
      projectModule([fixture]),
      interviewModule([fixture]),
      datasets.module,
      pipelineHarness().module,
      { recipeVersion: "source-plan-v2", rules: [allowedRule()] },
    );
    expect((await unsupported.plan("project-television")).content.lanes[0]).toMatchObject({
      status: "waiting",
      issues: [expect.objectContaining({ code: "planning_rule_missing" })],
    });
  });
});

function categoryFixture(
  categoryCode: string,
  label: string,
  targetKey: string,
  sourceUrl: string,
  request?: SourceCollectionRequest,
) {
  const projectId = `project-${categoryCode}`;
  const definitionId = `definition-${categoryCode}`;
  const scopeId = `scope-${categoryCode}`;
  const boardId = `board-${categoryCode}`;
  const lane = {
    id: `lane-${categoryCode}`,
    sourceAuthorityType: "brand_official_site" as const,
    accessMode: "public_web" as const,
    targetKeys: [targetKey],
    knowledgeLayers: ["identity" as const, "specification" as const],
    refreshPolicy: "manual" as const,
    stopConditions: ["access_denied" as const],
  };
  const attribute = {
    code: `${categoryCode}.model`,
    label: `${label}型号`,
    description: `${label}官方型号`,
    knowledgeLayer: "identity" as const,
    valueKind: "text" as const,
    externalMappings: [],
    filterable: true,
    comparable: true,
  };
  const project = productProjectViewSchema.parse({
    project: {
      id: projectId, name: `${label}知识项目`, knowledgeTopic: `${label}商品与品类知识`, market: "CN",
      status: "ready", revision: 1, createdAt: now, updatedAt: now,
    },
    categoryDefinition: {
      id: definitionId, projectId, categoryCode, label, market: "CN", version: 1,
      status: "confirmed", contentHash: hash, createdAt: now, confirmedAt: now,
      sourceAuthorityPolicy: ["brand_official_site"], attributes: [attribute],
      decisionDimensions: [{
        code: `${categoryCode}.comparison`, label: `${label}比较`, description: `比较${label}型号`,
        relatedAttributeCodes: [attribute.code],
      }],
      competencyQuestions: [`如何比较${label}？`],
    },
    confirmedScope: {
      id: scopeId, projectId, categoryDefinitionVersionId: definitionId, market: "CN", version: 1,
      status: "confirmed", contentHash: hash, createdAt: now, confirmedAt: now,
      populationLayers: ["official_current_catalog"],
      targets: [{
        key: targetKey, kind: "category", label, evidenceReferenceIds: [`reference-${categoryCode}`],
        disposition: "included", reason: "当前品类的官方目录",
      }],
    },
    collectionBoard: {
      id: boardId, projectId, confirmedScopeVersionId: scopeId, version: 1,
      status: "confirmed", contentHash: hash, createdAt: now, confirmedAt: now, lanes: [lane],
    },
  });
  const content = {
    category: { code: categoryCode, label, market: "CN" },
    objective: `建立${label}商品和品类底层知识`,
    audience: "中国大陆消费者",
    priorityScenarios: [`理解和比较${label}`],
    excludedScope: [],
    knowledgeNeeds: [{
      id: `need-${categoryCode}`,
      question: `${label}型号和关键规格是什么？`,
      knowledgeLayers: ["identity" as const, "specification" as const],
      priority: "must" as const,
    }],
    categoryFramework: {
      attributes: [attribute],
      decisionDimensions: project.categoryDefinition.decisionDimensions,
      competencyQuestions: project.categoryDefinition.competencyQuestions,
    },
    targetPopulation: {
      populationLayers: ["official_current_catalog" as const],
      targets: [{ key: targetKey, kind: "category" as const, label, disposition: "included" as const, reason: "官方目录" }],
    },
    sourcePolicy: {
      authorityTypes: ["brand_official_site" as const],
      accessModes: ["public_web" as const],
      freshnessPolicy: "manual" as const,
      stopConditions: ["access_denied" as const],
    },
    collectionLanes: [lane],
    sourceAssignments: [{
      collectionLaneId: lane.id,
      factReferenceId: `reference-${categoryCode}`,
      knowledgeNeedIds: [`need-${categoryCode}`],
      request,
    }],
    acceptanceCriteria: ["来源对象可定位、可审核、可重跑"],
    decisionIds: [`decision-${categoryCode}`],
    factReferences: [{
      id: `reference-${categoryCode}`, label: `${label}官方目录`, url: sourceUrl,
      sourceAuthorityType: "brand_official_site" as const, observedAt: now,
    }],
    investigatedFacts: ([
      "brand", "model", "parameter", "component", "mechanism", "source_entrypoint",
    ] as const).map((kind) => ({
      id: `${categoryCode}-${kind}`, kind, statement: `${label}${kind}调查`,
      factReferenceIds: [`reference-${categoryCode}`],
    })),
  };
  const brief = categoryResearchBriefVersionSchema.parse({
    id: `brief-${categoryCode}`, sessionId: `session-${categoryCode}`, version: 1,
    status: "confirmed", contentHash: hash, content, projectId, createdAt: now, confirmedAt: now,
  });
  return { project, brief };
}

function allowedRule(): SourceCollectionPlanningRule {
  return {
    id: "fixture-public-web-v1",
    providerKey: "fixture-public-web",
    sourceIdentity: "fixture-official-site",
    sourceAuthorityType: "brand_official_site",
    accessMode: "public_web",
    urlMatch: { kind: "origin", origin: "https://example.com" },
    objectKind: "catalog_entry",
    parsing: { adapterId: "fixture-public-web", adapterVersion: "1.0.0" },
    claimScopes: ["brand_claim", "model_fact"],
    usagePermission: {
      localRead: "allowed", modelInput: "allowed", evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed", sourceRedistribution: "denied", basis: "测试夹具",
    },
    accessPolicy: { kind: "manual", version: "fixture-policy-v1" },
  };
}

function projectModule(fixtures: Array<{ project: ProductProjectView }>): ProductProjectModule {
  const projects = new Map(fixtures.map(({ project }) => [project.project.id, project]));
  return {
    list: async () => [...projects.values()].map(({ project }) => project),
    get: async (projectId) => projects.get(projectId) ?? null,
    saveDraft: vi.fn(),
    confirm: vi.fn(),
  } as ProductProjectModule;
}

function interviewModule(fixtures: Array<{ brief: CategoryResearchBriefVersion }>): CategoryInterviewModule {
  const briefs = new Map(fixtures.map(({ brief }) => [brief.projectId!, brief]));
  return {
    getConfirmedBriefForProject: async (projectId) => briefs.get(projectId) ?? null,
  } as CategoryInterviewModule;
}

function datasetHarness(projects: Map<string, ProductProjectView>) {
  const plans = new Map<string, SourceCollectionPlan>();
  const savePlan = vi.fn(async (input: SaveSourceCollectionPlan) => {
    const existing = [...plans.values()].find((plan) =>
      plan.projectId === input.projectId && JSON.stringify(plan.content) === JSON.stringify(input.content));
    if (existing) return existing;
    const project = projects.get(input.projectId)!;
    const plan = sourceCollectionPlanSchema.parse({
      id: `plan-${input.projectId}`, projectId: input.projectId, projectRevision: project.project.revision,
      categoryDefinitionVersionId: project.categoryDefinition.id,
      confirmedScopeVersionId: project.confirmedScope.id,
      collectionBoardVersionId: project.collectionBoard.id,
      contentHash: hash, content: input.content, createdAt: now,
    });
    plans.set(plan.id, plan);
    return plan;
  });
  const startRun = vi.fn(async (input) => sourceCollectionRunSchema.parse({
    id: `run-${input.projectId}`, ...input,
    categoryDefinitionVersionId: projects.get(input.projectId)!.categoryDefinition.id,
    confirmedScopeVersionId: projects.get(input.projectId)!.confirmedScope.id,
    collectionBoardVersionId: projects.get(input.projectId)!.collectionBoard.id,
    categoryCode: projects.get(input.projectId)!.categoryDefinition.categoryCode,
    sourceAuthorityType: "brand_official_site", status: "running",
    snapshotCount: 0, accessibleCount: 0, failedCount: 0, assetCount: 0, startedAt: now,
  }));
  return {
    savePlan,
    startRun,
    module: {
      savePlan,
      startRun,
      finishRun: vi.fn(),
    } as unknown as SourceDatasetModule,
  };
}

function pipelineHarness() {
  const start = vi.fn(async (input) => sourceCollectionPipelineRunSchema.parse({
    id: `pipeline-${input.sourceRunId}`, sourceRunId: input.sourceRunId, inputHash: hash,
    lifecycleStatus: "queued", totalItems: input.workItems.length, completedItems: 0,
    recentRequestStartedAt: [], createdAt: now, updatedAt: now,
  }));
  return { start, module: { start } as unknown as SourceCollectionPipelineModule };
}
