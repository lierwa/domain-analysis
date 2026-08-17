import type { SourceCollectionWorkItem, SourceCollectionRun } from "@domain-analysis/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createSocrataOpenDataSource,
  createSocrataSourceCollectionProvider,
  SourceAccessError,
} from "../src";

describe("Socrata open-data source collection provider", () => {
  it("把任意品类的单条官方开放记录保序投影为通用 ordered_record", async () => {
    const capture = vi.fn(async () => ({
      requestedUrl: "https://data.energystar.gov/resource/8wj2-sec8.json?pd_id=2399940&%24limit=1",
      finalUrl: "https://data.energystar.gov/resource/8wj2-sec8.json?pd_id=2399940&%24limit=1",
      observedAt: "2026-08-17T12:00:00.000Z",
      httpValidation: { status: 200 },
      record: { pd_id: "2399940", product_category: "Televisions", model_number: "LE-32T1", upc: null },
    }));
    const provider = createSocrataSourceCollectionProvider({
      source: { capture },
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });
    const result = await provider.collect({ sourceRun: run(), item: workItem() });
    expect(result.content).toMatchObject({
      kind: "ordered_record",
      fieldGroups: [{ fields: [
        { name: "pd_id", value: "2399940" },
        { name: "product_category", value: "Televisions" },
        { name: "model_number", value: "LE-32T1" },
        { name: "upc", value: "null" },
      ] }],
    });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      lookup: { fieldCode: "pd_id", value: "2399940" },
      maximumBytes: 20_000,
    }), expect.any(AbortSignal));
  });

  it("在发起网络前拒绝非白名单数据集和任意查询参数", async () => {
    const source = createSocrataOpenDataSource({
      allowedOrigins: ["https://data.energystar.gov"],
      allowedDatasetIds: ["8wj2-sec8"],
    });
    await expect(source.capture({
      requestedUrl: "https://data.energystar.gov/resource/xxxx-yyyy.json?pd_id=2399940&$limit=1",
      lookup: { fieldCode: "pd_id", value: "2399940" },
      maximumBytes: 20_000,
    })).rejects.toBeInstanceOf(SourceAccessError);
    await expect(source.capture({
      requestedUrl: "https://data.energystar.gov/resource/8wj2-sec8.json?pd_id=2399940&$limit=1&$where=true",
      lookup: { fieldCode: "pd_id", value: "2399940" },
      maximumBytes: 20_000,
    })).rejects.toMatchObject({ code: "source_abnormal" });
  });
});

function run(): SourceCollectionRun {
  return {
    id: "run-tv", projectId: "project-tv", categoryDefinitionVersionId: "definition-tv",
    confirmedScopeVersionId: "scope-tv", collectionBoardVersionId: "board-tv",
    categoryCode: "television", collectionLaneId: "lane-tv", providerKey: "socrata-open-data",
    sourceAuthorityType: "regulatory_source", accessPolicy: { kind: "manual", version: "v1" },
    status: "running", snapshotCount: 0, accessibleCount: 0, failedCount: 0, assetCount: 0,
    startedAt: "2026-08-17T12:00:00.000Z",
  };
}

function workItem(): SourceCollectionWorkItem {
  return {
    id: "item-tv", object: { sourceIdentity: "epa-energy-star-model-index", kind: "regulatory_record", externalKey: "2399940" },
    requestedUrl: "https://data.energystar.gov/resource/8wj2-sec8.json?pd_id=2399940&%24limit=1",
    request: { kind: "structured_record_lookup", fields: [{ code: "pd_id", value: "2399940" }], maximumBytes: 20_000 },
    targetKeys: ["model:le-32t1"], knowledgeNeedIds: ["need:model-identity"],
    parsing: { adapterId: "socrata-open-data", adapterVersion: "2.1" },
    claimScopes: ["standard_or_regulatory", "model_fact"],
    usagePermission: {
      localRead: "allowed", modelInput: "allowed", evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed", sourceRedistribution: "allowed", basis: "EPA public-domain data",
    },
  };
}
