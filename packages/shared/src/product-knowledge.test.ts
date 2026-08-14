import { describe, expect, it } from "vitest";

import { confirmedProjectSnapshotSchema } from "./product-knowledge";

const hash = "a".repeat(64);
const timestamp = "2026-08-14T00:00:00.000Z";

describe("confirmedProjectSnapshotSchema", () => {
  it("accepts one product-neutral frozen project snapshot", () => {
    expect(confirmedProjectSnapshotSchema.parse(createSnapshot()).project.status).toBe("ready");
  });

  it("rejects a decision dimension that references an unknown attribute", () => {
    const snapshot = createSnapshot();
    snapshot.categoryDefinition.decisionDimensions[0]!.relatedAttributeCodes = ["refrigerator.hidden_branch"];
    expect(confirmedProjectSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects a collection lane that escapes the confirmed scope", () => {
    const snapshot = createSnapshot();
    snapshot.collectionBoard.lanes[0]!.targetKeys = ["model-outside-scope"];
    expect(confirmedProjectSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects a collection lane outside the category source policy", () => {
    const snapshot = createSnapshot();
    const lane = snapshot.collectionBoard.lanes[0] as { sourceAuthorityType: string };
    lane.sourceAuthorityType = "regulatory_source";
    expect(confirmedProjectSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});

function createSnapshot() {
  return {
    project: {
      id: "project-1",
      name: "中国电视知识项目",
      knowledgeTopic: "覆盖中国市场主流电视型号的专业导购知识",
      market: "CN",
      status: "ready" as const,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    categoryDefinition: {
      id: "category-1",
      projectId: "project-1",
      categoryCode: "television",
      label: "电视",
      market: "CN",
      version: 1,
      status: "confirmed" as const,
      sourceAuthorityPolicy: ["brand_official_site" as const],
      attributes: [{
        code: "television.refresh_rate_hz",
        label: "刷新率",
        description: "保留原生与营销口径差异",
        knowledgeLayer: "specification" as const,
        valueKind: "decimal" as const,
        canonicalUnitCode: "HTZ",
        externalMappings: [],
        filterable: true,
        comparable: true,
      }],
      decisionDimensions: [{
        code: "picture_use_case",
        label: "画质与场景",
        description: "根据观看需求组织规格与机制",
        relatedAttributeCodes: ["television.refresh_rate_hz"],
      }],
      competencyQuestions: ["哪些型号满足高刷需求，证据是什么？"],
      contentHash: hash,
      createdAt: timestamp,
      confirmedAt: timestamp,
    },
    confirmedScope: {
      id: "scope-1",
      projectId: "project-1",
      categoryDefinitionVersionId: "category-1",
      market: "CN",
      version: 1,
      status: "confirmed" as const,
      populationLayers: ["official_current_catalog" as const],
      targets: [{
        key: "tcl-65t7g",
        kind: "model" as const,
        label: "TCL 65T7G",
        evidenceReferenceIds: ["evidence-1"],
        disposition: "included" as const,
        reason: "官方在售样本",
      }],
      contentHash: hash,
      createdAt: timestamp,
      confirmedAt: timestamp,
    },
    collectionBoard: {
      id: "board-1",
      projectId: "project-1",
      confirmedScopeVersionId: "scope-1",
      version: 1,
      status: "confirmed" as const,
      lanes: [{
        id: "lane-1",
        sourceAuthorityType: "brand_official_site" as const,
        accessMode: "public_web" as const,
        targetKeys: ["tcl-65t7g"],
        knowledgeLayers: ["identity" as const, "specification" as const],
        refreshPolicy: "on_source_change" as const,
        stopConditions: ["source_abnormal" as const],
      }],
      contentHash: hash,
      createdAt: timestamp,
      confirmedAt: timestamp,
    },
  };
}
