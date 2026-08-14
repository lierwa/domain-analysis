import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ProductProjectDraftInput } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import { openProductKnowledgeWorkbench } from "./productKnowledgeWorkbench";

describe("openProductKnowledgeWorkbench", () => {
  it("migrates a new database and preserves projects across restart", async () => {
    const databaseUrl = await temporaryDatabaseUrl();
    const first = await openProductKnowledgeWorkbench({
      databaseUrl,
      productProjectModule: deterministicOptions(),
    });
    const saved = await first.productProjects.saveDraft(createDraft());
    first.close();

    const restarted = await openProductKnowledgeWorkbench({ databaseUrl });
    expect((await restarted.productProjects.get(saved.project.id))?.project.name)
      .toBe("电视知识项目");
    restarted.close();
  });
});

function createDraft(): ProductProjectDraftInput {
  return {
    name: "电视知识项目",
    knowledgeTopic: "中国市场电视专业导购知识",
    market: "CN",
    categoryDefinition: {
      categoryCode: "television",
      label: "电视",
      sourceAuthorityPolicy: ["brand_official_site"],
      attributes: [{
        code: "display.refresh_rate",
        label: "刷新率",
        description: "屏幕标称刷新率",
        knowledgeLayer: "specification",
        valueKind: "decimal",
        canonicalUnitCode: "Hz",
        externalMappings: [],
        filterable: true,
        comparable: true,
      }],
      decisionDimensions: [{
        code: "gaming.motion",
        label: "游戏动态表现",
        description: "判断游戏画面流畅度",
        relatedAttributeCodes: ["display.refresh_rate"],
      }],
      competencyQuestions: ["高刷新率对游戏有什么价值？"],
    },
    confirmedScope: {
      populationLayers: ["official_current_catalog"],
      targets: [{
        key: "brand:tcl",
        kind: "brand",
        label: "TCL",
        evidenceReferenceIds: ["evidence-tcl"],
        disposition: "included",
        reason: "官方在售主流品牌",
      }],
    },
    collectionBoard: {
      lanes: [{
        id: "lane-tcl-official",
        sourceAuthorityType: "brand_official_site",
        accessMode: "public_web",
        targetKeys: ["brand:tcl"],
        knowledgeLayers: ["identity", "specification"],
        refreshPolicy: "weekly",
        stopConditions: ["access_denied", "source_abnormal"],
      }],
    },
  };
}

function deterministicOptions() {
  const counters = { project: 0, definition: 0, scope: 0, board: 0 };
  return {
    now: () => new Date("2026-08-14T04:00:00.000Z"),
    createId: (kind: keyof typeof counters) => `${kind}-${++counters[kind]}`,
  };
}

async function temporaryDatabaseUrl() {
  const directory = await mkdtemp(path.join(tmpdir(), "product-workbench-startup-"));
  return `file:${path.join(directory, "database.sqlite")}`;
}
