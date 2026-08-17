import type {
  SourceCollectionRun,
  SourceCollectionWorkItem,
} from "@domain-analysis/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createDocumentExcerptSourceCollectionProvider,
  createEnergyLabelSourceCollectionProvider,
} from "../src";

const now = "2026-08-17T10:00:00.000Z";

describe("Source Collection evidence providers", () => {
  it("把 PDF 单页摘录保存为通用 document，不暴露品类字段", async () => {
    const capture = vi.fn(async () => ({
      requestedUrl: "https://manual.example/product.pdf",
      finalUrl: "https://manual.example/product.pdf",
      observedAt: now,
      httpValidation: { status: 200 },
      content: "MODEL-1 安装距离 外形尺寸 500×600×700mm",
      locator: {
        kind: "document_excerpt" as const,
        sourceDocumentSha256: "a".repeat(64),
        page: 8,
        section: "安装条件",
        quote: {
          exact: "安装距离 外形尺寸 500×600×700mm",
          prefix: "MODEL-1 ",
        },
      },
    }));
    const provider = createDocumentExcerptSourceCollectionProvider({
      source: { capture },
      now: () => new Date(now),
    });

    const result = await provider.collect({
      sourceRun: run("official-manual"),
      item: item({
        kind: "document_excerpt",
        requiredIdentityText: "MODEL-1",
        requiredSectionTerms: ["安装距离", "外形尺寸"],
        section: "安装条件",
        maximumSourceBytes: 2_000_000,
        maximumExcerptBytes: 100_000,
      }, "document"),
    });

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      requiredText: "MODEL-1",
      requiredSectionTerms: ["安装距离", "外形尺寸"],
    }), expect.any(AbortSignal));
    expect(result.content).toMatchObject({
      kind: "document",
      documentIdentifier: "a".repeat(64),
      sections: [{ heading: "安装条件 · 第 8 页" }],
    });
  });

  it("把监管详情原文保存为 ordered_record，并收窄通用查询字段码", async () => {
    const captureByModel = vi.fn(async () => ({
      requestedUrl: "https://registry.example/api/detail",
      finalUrl: "https://registry.example/api/detail",
      observedAt: now,
      httpValidation: { status: 200 },
      content: '{"model":"MODEL-1","level":1}',
      locator: {
        kind: "web_text" as const,
        quote: { exact: '"model":"MODEL-1"', prefix: "{", suffix: ',"level":1}' },
      },
    }));
    const provider = createEnergyLabelSourceCollectionProvider({
      source: {
        requestedUrl: "https://registry.example/api/detail",
        findRegistrationsByModel: vi.fn(),
        captureByModel,
      },
      now: () => new Date(now),
    });

    const result = await provider.collect({
      sourceRun: run("regulatory"),
      item: item({
        kind: "structured_record_lookup",
        fields: [{ code: "manufacturer_model", value: "MODEL-1" }],
        maximumBytes: 40_000,
      }, "regulatory_record"),
    });

    expect(captureByModel).toHaveBeenCalledWith({ productModel: "MODEL-1", maximumBytes: 40_000 }, expect.any(AbortSignal));
    expect(result.content).toMatchObject({
      kind: "ordered_record",
      blocks: [{ text: '{"model":"MODEL-1","level":1}' }],
    });
  });

  it("不把未知结构化字段猜成监管型号", async () => {
    const captureByModel = vi.fn();
    const provider = createEnergyLabelSourceCollectionProvider({
      source: {
        requestedUrl: "https://registry.example/api/detail",
        findRegistrationsByModel: vi.fn(),
        captureByModel,
      },
    });
    const result = await provider.collect({
      sourceRun: run("regulatory"),
      item: item({
        kind: "structured_record_lookup",
        fields: [{ code: "sku", value: "SKU-1" }],
        maximumBytes: 40_000,
      }, "regulatory_record"),
    });

    expect(result).toMatchObject({ observation: { state: "source_abnormal" }, stopRun: true });
    expect(captureByModel).not.toHaveBeenCalled();
  });
});

function item(
  request: NonNullable<SourceCollectionWorkItem["request"]>,
  kind: SourceCollectionWorkItem["object"]["kind"],
): SourceCollectionWorkItem {
  return {
    id: "item-1",
    object: { sourceIdentity: "fixture", kind, externalKey: "source:fixture" },
    requestedUrl: "https://registry.example/source",
    request,
    targetKeys: ["category:fixture"],
    knowledgeNeedIds: ["need:fixture"],
    parsing: { adapterId: "fixture", adapterVersion: "1" },
    claimScopes: [kind === "regulatory_record" ? "standard_or_regulatory" : "model_fact"],
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: "unknown",
      sourceRedistribution: "denied",
      basis: "fixture",
    },
  };
}

function run(providerKey: string): SourceCollectionRun {
  return {
    id: `run-${providerKey}`,
    projectId: "project-fixture",
    categoryDefinitionVersionId: "definition-fixture",
    confirmedScopeVersionId: "scope-fixture",
    collectionBoardVersionId: "board-fixture",
    categoryCode: "fixture",
    collectionLaneId: "lane-fixture",
    providerKey,
    sourceAuthorityType: providerKey === "regulatory" ? "regulatory_source" : "official_manual",
    accessPolicy: { kind: "manual", version: "fixture-v1" },
    status: "running",
    snapshotCount: 0,
    accessibleCount: 0,
    failedCount: 0,
    assetCount: 0,
    startedAt: now,
  };
}
