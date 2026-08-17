import type { ProductProjectView, PublicWebTextCapture } from "@domain-analysis/shared";
import type { EvidenceModule, ProductProjectModule } from "@domain-analysis/workbench";
import type { PublicWebTextSource } from "@domain-analysis/worker";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerEvidenceRoutes } from "../src/routes/evidenceRoutes";

describe("Evidence collection HTTP contract", () => {
  it("turns one confirmed project clue into a persisted raw EvidenceItem", async () => {
    const projects = fakeProjects();
    const evidence = fakeEvidence();
    const source: PublicWebTextSource = { capture: vi.fn(async () => capture()) };
    const app = Fastify();
    await registerEvidenceRoutes(app, { projects, evidence, source });

    const response = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-fridge/evidence/public-web-text",
      payload: {
        collectionLaneId: "lane-official",
        targetKey: "category:fridge-cn",
        knowledgeNeed: { id: "need-model", kind: "attribute", attributeCode: "model_number" },
        question: "该官方页面声明的型号及规格是什么？",
        knowledgeLayer: "identity",
        sourceIdentity: "haier-official",
        requestedUrl: "https://www.haier.com/cooling/sample.shtml",
        selector: "script[type='application/ld+json']",
        requiredText: "BCD-500",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(source.capture).toHaveBeenCalledWith(expect.objectContaining({ maximumBytes: 40_000 }));
    expect(evidence.createRequest).toHaveBeenCalledWith(expect.objectContaining({
      categoryDefinitionVersionId: "definition-1",
      collectionLaneIds: ["lane-official"],
      targetKeys: ["category:fridge-cn"],
    }));
    expect(evidence.commit).toHaveBeenCalledWith(
      expect.objectContaining({ relationProof: expect.objectContaining({ method: "structured_data" }) }),
      new TextEncoder().encode(capture().content),
    );
    expect(response.json().item.assessment.status).toBe("sufficient");
    await app.close();
  });

  it("exposes only the Workbench evidence projection for a project", async () => {
    const evidence = fakeEvidence();
    const app = Fastify();
    await registerEvidenceRoutes(app, {
      projects: fakeProjects(),
      evidence,
      source: { capture: async () => capture() },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/product-projects/project-fridge/evidence",
    });
    expect(response.statusCode).toBe(200);
    expect(evidence.listProject).toHaveBeenCalledWith("project-fridge");
    await app.close();
  });

  it("persists an official energy-label response without turning it into cleaned facts", async () => {
    const projects = fakeProjects();
    const evidence = fakeEvidence();
    const regulatorySource = {
      requestedUrl: "https://www.energylabel.com.cn/admin-api/gateway/productRegistration/productDetailById",
      findRegistrationsByModel: vi.fn(async () => []),
      captureByModel: vi.fn(async () => ({
        ...capture(),
        requestedUrl: "https://www.energylabel.com.cn/admin-api/gateway/productRegistration/productDetailById",
        finalUrl: "https://www.energylabel.com.cn/admin-api/gateway/productRegistration/productDetailById",
        content: "{\"code\":200,\"data\":{\"productModel\":\"BCD-501WSPM(Q)\",\"registrationNumber\":\"record-1\"}}",
      })),
    };
    const app = Fastify();
    await registerEvidenceRoutes(app, {
      projects,
      evidence,
      source: { capture: async () => capture() },
      regulatorySource,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-fridge/evidence/energy-label-record",
      payload: {
        collectionLaneId: "lane-regulatory",
        targetKey: "category:fridge-cn",
        knowledgeNeed: { id: "need-energy", kind: "attribute", attributeCode: "energy_efficiency_grade" },
        question: "该型号在中国能效标识网的原始备案数据是什么？",
        knowledgeLayer: "specification",
        sourceIdentity: "china-energy-label",
        productModel: "BCD-501WSPM(Q)",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(regulatorySource.captureByModel).toHaveBeenCalledWith({
      productModel: "BCD-501WSPM(Q)",
      maximumBytes: 40_000,
    });
    expect(evidence.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: "text/plain; charset=utf-8",
        relationProof: expect.objectContaining({ method: "structured_data" }),
      }),
      expect.any(Uint8Array),
    );
    await app.close();
  });

  it("persists only the matching page excerpt from an official PDF manual", async () => {
    const projects = fakeProjects();
    const evidence = fakeEvidence();
    const pageText = "型号 MR-457WUSPZE 年综合耗电量 311kW·h/a 外形尺寸 753×600×1910mm";
    const documentSource = {
      capture: vi.fn(async () => ({
        requestedUrl: "https://manual.example/midea.pdf",
        finalUrl: "https://manual.example/midea.pdf",
        observedAt: "2026-08-16T10:00:00.000Z",
        httpValidation: { status: 200 },
        content: pageText,
        locator: {
          kind: "document_excerpt" as const,
          sourceDocumentSha256: "d".repeat(64),
          page: 14,
          section: "产品参数",
          quote: { prefix: pageText.slice(0, 1), exact: pageText.slice(1) },
        },
      })),
    };
    const app = Fastify();
    await registerEvidenceRoutes(app, {
      projects,
      evidence,
      source: { capture: async () => capture() },
      documentSource,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-fridge/evidence/document-excerpt",
      payload: {
        collectionLaneId: "lane-manual",
        targetKey: "category:fridge-cn",
        knowledgeNeed: { id: "need-manual-spec", kind: "attribute", attributeCode: "manual_specification" },
        question: "该官方说明书声明的型号、耗电量和外形尺寸是什么？",
        knowledgeLayer: "specification",
        sourceIdentity: "midea-official-manual",
        requestedUrl: "https://manual.example/midea.pdf",
        requiredText: "MR-457WUSPZE",
        requiredSectionTerms: ["年综合耗电量", "外形尺寸"],
        section: "产品参数",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(documentSource.capture).toHaveBeenCalledWith(expect.objectContaining({
      maximumSourceBytes: 4 * 1024 * 1024,
      maximumExcerptBytes: 40_000,
    }));
    expect(evidence.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "document_excerpt",
        mediaType: "text/plain; charset=utf-8",
        locator: expect.objectContaining({ kind: "document_excerpt", page: 14 }),
      }),
      new TextEncoder().encode(pageText),
    );
    await app.close();
  });

  it("persists only the header and unique row from an official registry workbook", async () => {
    const projects = fakeProjects();
    const evidence = fakeEvidence();
    const content = JSON.stringify({
      header: ["序号", "国家标准", "大类名称", "生产者名称", "规格型号", "备案号", "能效等级"],
      row: ["1471", "GB 12021.2-2015", "家用电冰箱 2015版", "合肥美的电冰箱有限公司", "MR-457WUSPZE", "record-1", "1"],
    });
    const registryTableSource = {
      requestedUrl: "https://www.cnis.ac.cn/registry.rar",
      captureByModel: vi.fn(async () => ({
        requestedUrl: "https://www.cnis.ac.cn/registry.rar",
        finalUrl: "https://www.cnis.ac.cn/registry.rar",
        observedAt: "2026-08-16T10:00:00.000Z",
        httpValidation: { status: 200 },
        content,
        locator: {
          kind: "table_region" as const,
          sourceDocumentSha256: "e".repeat(64),
          sheet: "结果",
          headerRange: "A2:G2",
          cellRange: "A479:G479",
          rowIdentity: "MR-457WUSPZE",
        },
      })),
    };
    const app = Fastify();
    await registerEvidenceRoutes(app, {
      projects,
      evidence,
      source: { capture: async () => capture() },
      registryTableSource,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-fridge/evidence/cnis-registry-row",
      payload: {
        collectionLaneId: "lane-regulatory",
        targetKey: "category:fridge-cn",
        knowledgeNeed: { id: "need-registry-row", kind: "attribute", attributeCode: "energy_efficiency_grade" },
        question: "该型号在监管工作簿中的原始备案行是什么？",
        knowledgeLayer: "specification",
        sourceIdentity: "cnis-refrigerator-registry",
        productModel: "MR-457WUSPZE",
        year: 2023,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(registryTableSource.captureByModel).toHaveBeenCalledWith({
      productModel: "MR-457WUSPZE",
      year: 2023,
      maximumArchiveBytes: 10 * 1024 * 1024,
      maximumEvidenceBytes: 4096,
    });
    expect(evidence.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "table_region",
        mediaType: "application/json",
        locator: expect.objectContaining({ headerRange: "A2:G2", cellRange: "A479:G479" }),
      }),
      new TextEncoder().encode(content),
    );
    await app.close();
  });
});

function fakeProjects() {
  return {
    get: vi.fn(async () => project()),
  } as unknown as ProductProjectModule;
}

function fakeEvidence() {
  return {
    createRequest: vi.fn(async (input) => ({ ...input, id: "request-1", createdAt: "2026-08-16T10:00:00.000Z" })),
    recordObservation: vi.fn(async (input) => ({ ...input, id: "observation-1", createdAt: "2026-08-16T10:00:00.000Z" })),
    commit: vi.fn(async (input) => ({ ...input, id: "evidence-1" })),
    assess: vi.fn(async () => ({ status: "sufficient" })),
    listProject: vi.fn(async () => []),
  } as unknown as EvidenceModule;
}

function capture(): PublicWebTextCapture {
  const content = "{\"@type\":\"Product\",\"sku\":\"BCD-500\"}";
  return {
    requestedUrl: "https://www.haier.com/cooling/sample.shtml",
    finalUrl: "https://www.haier.com/cooling/sample.shtml",
    observedAt: "2026-08-16T10:00:00.000Z",
    httpValidation: { status: 200 },
    content,
    locator: {
      kind: "web_text",
      structuralHint: "script[type='application/ld+json']",
      quote: { prefix: content.slice(0, 1), exact: content.slice(1) },
    },
  };
}

function project(): ProductProjectView {
  return {
    project: {
      id: "project-fridge", name: "冰箱", knowledgeTopic: "冰箱原始数据", market: "CN",
      status: "ready", revision: 1, createdAt: "2026-08-16T09:00:00.000Z", updatedAt: "2026-08-16T09:00:00.000Z",
    },
    categoryDefinition: {
      id: "definition-1", projectId: "project-fridge", categoryCode: "fridge", label: "冰箱", market: "CN",
      version: 1, status: "confirmed", contentHash: "a".repeat(64), createdAt: "2026-08-16T09:00:00.000Z",
      sourceAuthorityPolicy: ["brand_official_site"],
      attributes: [{ code: "model_number", label: "型号", description: "官方型号", knowledgeLayer: "identity", valueKind: "text", externalMappings: [], filterable: true, comparable: true }],
      decisionDimensions: [{ code: "model_compare", label: "型号比较", description: "比较型号", relatedAttributeCodes: ["model_number"] }],
      competencyQuestions: ["当前官方型号是什么？"], confirmedAt: "2026-08-16T09:00:00.000Z",
    },
    confirmedScope: {
      id: "scope-1", projectId: "project-fridge", categoryDefinitionVersionId: "definition-1", version: 1,
      status: "confirmed", contentHash: "b".repeat(64), createdAt: "2026-08-16T09:00:00.000Z", confirmedAt: "2026-08-16T09:00:00.000Z",
      market: "CN",
      populationLayers: ["official_current_catalog"],
      targets: [{ key: "category:fridge-cn", kind: "category", label: "中国大陆家用冰箱", evidenceReferenceIds: [], disposition: "included", reason: "首发范围" }],
    },
    collectionBoard: {
      id: "board-1", projectId: "project-fridge", confirmedScopeVersionId: "scope-1", version: 1,
      status: "confirmed", contentHash: "c".repeat(64), createdAt: "2026-08-16T09:00:00.000Z", confirmedAt: "2026-08-16T09:00:00.000Z",
      lanes: [
        { id: "lane-official", sourceAuthorityType: "brand_official_site", accessMode: "public_web", targetKeys: ["category:fridge-cn"], knowledgeLayers: ["identity", "specification"], refreshPolicy: "monthly", stopConditions: ["access_denied", "source_abnormal"] },
        { id: "lane-regulatory", sourceAuthorityType: "regulatory_source", accessMode: "public_web", targetKeys: ["category:fridge-cn"], knowledgeLayers: ["identity", "specification"], refreshPolicy: "monthly", stopConditions: ["access_denied", "source_abnormal"] },
        { id: "lane-manual", sourceAuthorityType: "official_manual", accessMode: "public_web", targetKeys: ["category:fridge-cn"], knowledgeLayers: ["specification"], refreshPolicy: "monthly", stopConditions: ["access_denied", "source_abnormal"] },
      ],
    },
  };
}
