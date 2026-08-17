import type { PipelineRunView, ProductProjectDraftInput } from "@domain-analysis/shared";
import {
  openProductKnowledgeWorkbench,
  type ProductPipelineModule,
} from "@domain-analysis/workbench";
import { describe, expect, it } from "vitest";

import { buildServer } from "../server";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("product project routes", () => {
  it("saves, lists, reads and confirms one complete draft", async () => {
    const app = await createTestServer();
    const created = await app.inject({
      method: "PUT",
      url: "/api/product-projects/draft",
      payload: createDraft(),
    });
    expect(created.statusCode).toBe(201);
    const projectId = created.json().item.project.id as string;

    const list = await app.inject({ method: "GET", url: "/api/product-projects" });
    expect(list.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: projectId }),
    ]));
    const detail = await app.inject({ method: "GET", url: `/api/product-projects/${projectId}` });
    expect(detail.json().item.categoryDefinition.categoryCode).toBe("microwave_oven");

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/product-projects/${projectId}/confirm`,
      payload: { expectedRevision: 1 },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().item.project.status).toBe("ready");
    await app.close();
  });

  it("maps invalid input and missing projects to client errors", async () => {
    const app = await createTestServer();
    const invalid = await app.inject({
      method: "PUT",
      url: "/api/product-projects/draft",
      payload: { name: "不完整" },
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: "GET",
      url: "/api/product-projects/missing",
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("returns conflict instead of overwriting a newer revision", async () => {
    const app = await createTestServer();
    const created = await app.inject({
      method: "PUT", url: "/api/product-projects/draft", payload: createDraft(),
    });
    const first = created.json().item;
    await app.inject({
      method: "PUT",
      url: "/api/product-projects/draft",
      payload: {
        ...createDraft(),
        projectId: first.project.id,
        expectedRevision: first.project.revision,
        name: "微波炉知识项目 v2",
      },
    });

    const stale = await app.inject({
      method: "PUT",
      url: "/api/product-projects/draft",
      payload: {
        ...createDraft(),
        projectId: first.project.id,
        expectedRevision: first.project.revision,
        name: "过期草稿",
      },
    });
    expect(stale.statusCode).toBe(409);
    await app.close();
  });

  it("starts a confirmed project through the injected Product Pipeline module", async () => {
    const starts: Array<{ projectId: string; requestedBy: string }> = [];
    const productPipeline: ProductPipelineModule = {
      start: async (projectId, requestedBy) => {
        starts.push({ projectId, requestedBy });
        return pipelineRun(projectId);
      },
    };
    const app = await createTestServer(productPipeline);
    const created = await app.inject({
      method: "PUT", url: "/api/product-projects/draft", payload: createDraft(),
    });
    const projectId = created.json().item.project.id as string;
    await app.inject({
      method: "POST",
      url: `/api/product-projects/${projectId}/confirm`,
      payload: { expectedRevision: 1 },
    });

    const started = await app.inject({
      method: "POST",
      url: `/api/product-projects/${projectId}/pipeline-runs`,
    });
    expect(started.statusCode).toBe(202);
    expect(started.json().item.lifecycleStatus).toBe("queued");
    expect(starts).toEqual([{ projectId, requestedBy: "local-user" }]);
    await app.close();
  });
});

async function createTestServer(productPipeline?: ProductPipelineModule) {
  const workbench = await openProductKnowledgeWorkbench({
    databaseUrl: databaseUrl!,
  });
  return buildServer({ logger: false, workbench, productPipeline });
}

function pipelineRun(projectId: string): PipelineRunView {
  const hash = "a".repeat(64);
  const now = "2026-08-14T12:00:00.000Z";
  return {
    id: `run-${projectId}`,
    workflowId: `workflow-${projectId}`,
    input: {
      projectId,
      projectRevision: 1,
      categoryDefinitionVersionId: "definition-1",
      categoryDefinitionHash: hash,
      confirmedScopeVersionId: "scope-1",
      confirmedScopeHash: hash,
      collectionBoardVersionId: "board-1",
      collectionBoardHash: hash,
    },
    lifecycleStatus: "queued",
    stages: [],
    interventions: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createDraft(): ProductProjectDraftInput {
  return {
    name: "微波炉知识项目",
    knowledgeTopic: "中国市场微波炉专业导购知识",
    market: "CN",
    categoryDefinition: {
      categoryCode: "microwave_oven",
      label: "微波炉",
      sourceAuthorityPolicy: ["brand_official_site"],
      attributes: [{
        code: "heating.power",
        label: "微波输出功率",
        description: "产品标称微波输出功率",
        knowledgeLayer: "specification",
        valueKind: "decimal",
        canonicalUnitCode: "W",
        externalMappings: [],
        filterable: true,
        comparable: true,
      }],
      decisionDimensions: [{
        code: "cooking.speed",
        label: "加热效率",
        description: "判断日常加热速度",
        relatedAttributeCodes: ["heating.power"],
      }],
      competencyQuestions: ["多大功率适合日常热饭？"],
    },
    confirmedScope: {
      populationLayers: ["official_current_catalog"],
      targets: [{
        key: "brand:midea",
        kind: "brand",
        label: "美的",
        evidenceReferenceIds: ["evidence-midea"],
        disposition: "included",
        reason: "官方在售主流品牌",
      }],
    },
    collectionBoard: {
      lanes: [{
        id: "lane-midea-official",
        sourceAuthorityType: "brand_official_site",
        accessMode: "public_web",
        targetKeys: ["brand:midea"],
        knowledgeLayers: ["identity", "specification"],
        refreshPolicy: "weekly",
        stopConditions: ["access_denied", "source_abnormal"],
      }],
    },
  };
}
