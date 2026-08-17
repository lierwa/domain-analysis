import type { OfficialCatalogSnapshot, ProductProjectDraftInput } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import { openProductKnowledgeWorkbench } from "../src/productKnowledgeWorkbench";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("MarketUniverseModule", () => {
  it("按品牌和厂商型号去重，但不把跨来源或 SKU 重复冒充型号变体", async () => {
    const workbench = await openProductKnowledgeWorkbench({ databaseUrl: databaseUrl! });
    const draft = await workbench.productProjects.saveDraft(createDraft());
    await workbench.productProjects.confirm(draft.project.id, draft.project.revision);

    const universe = await workbench.marketUniverses.refreshCandidate(
      draft.project.id,
      [snapshot()],
      [{
        key: "official-direct-pending",
        kind: "brand_discovery",
        scope: { type: "market" },
        blocking: true,
        description: "官方自营型号待枚举",
        requiredSourceAuthorityTypes: ["official_direct_retail"],
      }],
    );

    expect(universe.status).toBe("candidate");
    expect(universe.sources[0]).toMatchObject({ acceptedItemCount: 3, uniqueModelCount: 2 });
    expect(universe.models).toHaveLength(2);
    expect(universe.models.find((model) => model.manufacturerModel === "MR-457WUSPZE"))
      .toMatchObject({ identityStatus: "confirmed", sourceRefs: [{ sourceItemId: "1" }, { sourceItemId: "2" }] });
    expect(universe.models[0]).not.toHaveProperty("variantCount");
    expect((await workbench.marketUniverses.latest(draft.project.id))?.contentHash)
      .toBe(universe.contentHash);
    await workbench.close();
  });

  it("只确认内容未变化且不存在阻塞项的候选版本", async () => {
    const workbench = await openProductKnowledgeWorkbench({ databaseUrl: databaseUrl! });
    const draft = await workbench.productProjects.saveDraft(createDraft());
    await workbench.productProjects.confirm(draft.project.id, draft.project.revision);
    const candidate = await workbench.marketUniverses.refreshCandidate(draft.project.id, [snapshot()], []);

    const confirmed = await workbench.marketUniverses.confirmCandidate(
      draft.project.id,
      candidate.version,
      candidate.contentHash,
    );

    expect(confirmed).toMatchObject({ status: "confirmed", confirmedAt: expect.any(String) });
    await expect(workbench.marketUniverses.confirmCandidate(
      draft.project.id,
      candidate.version,
      candidate.contentHash,
    )).rejects.toMatchObject({ code: "candidate_changed" });
    await workbench.close();
  });

  it("以冻结候选为基线幂等合并监管结果并保留逐型号未知项", async () => {
    const workbench = await openProductKnowledgeWorkbench({ databaseUrl: databaseUrl! });
    const draft = await workbench.productProjects.saveDraft(createDraft());
    await workbench.productProjects.confirm(draft.project.id, draft.project.revision);
    const candidate = await workbench.marketUniverses.refreshCandidate(draft.project.id, [snapshot()], [{
      key: "regulatory-active-intersection",
      kind: "window_mismatch",
      scope: { type: "market" },
      blocking: true,
      description: "监管交叉待完成",
      requiredSourceAuthorityTypes: ["regulatory_source"],
    }]);
    const operationId = `regulatory-run-${draft.project.id}`;
    const input = {
      projectId: draft.project.id,
      expectedUniverse: { id: candidate.id, version: candidate.version, contentHash: candidate.contentHash },
      operationId,
      snapshot: regulatorySnapshot(),
      outcomes: [
        { brand: "美的", manufacturerModel: "MR-457WUSPZE", status: "matched" as const, registrationCount: 1, producerNames: ["美的集团"] },
        { brand: "美的", manufacturerModel: "BCD-501WSPM(Q)", status: "not_found" as const, registrationCount: 0, producerNames: [] },
      ],
    };

    const reconciled = await workbench.marketUniverses.applyRegulatoryReconciliation(input);
    const duplicate = await workbench.marketUniverses.applyRegulatoryReconciliation(input);

    expect(reconciled).toMatchObject({ id: operationId, version: candidate.version + 1, status: "candidate" });
    expect(duplicate).toEqual(reconciled);
    expect(reconciled.sources.some((source) => source.coverageKind === "regulatory_registry_lookup")).toBe(true);
    expect(reconciled.models.find((model) => model.manufacturerModel === "MR-457WUSPZE")?.regulatoryProducers)
      .toEqual([{ key: "producer:midea", label: "美的集团" }]);
    expect(reconciled.unknowns).not.toContainEqual(expect.objectContaining({ key: "regulatory-active-intersection" }));
    expect(reconciled.unknowns).toContainEqual(expect.objectContaining({
      kind: "model_identity",
      scope: expect.objectContaining({ type: "model" }),
    }));
    await workbench.close();
  });
});

function snapshot(): OfficialCatalogSnapshot {
  return {
    sourceId: "midea-cn-refrigerator-catalog",
    sourceIdentity: "midea-cn-official-mall",
    sourceAuthorityType: "brand_official_site",
    coverageKind: "multi_brand_official_catalog",
    catalogUrl: "https://www.midea.cn/s/search/search.html?category_id=10008",
    observedAt: "2026-08-16T12:00:00.000Z",
    declaredItemCount: 3,
    fetchedItemCount: 3,
    acceptedItemCount: 3,
    coverageStatus: "complete",
    entries: [
      entry("1", "美的", "MR-457WUSPZE", "cross_door"),
      entry("2", "美的", "MR-457WUSPZE", "cross_door"),
      entry("3", "美的", "BCD-501WSPM(Q)", "side_by_side"),
    ],
  };
}

function entry(sourceItemId: string, brand: string, manufacturerModel: string, doorLayout: string) {
  return {
    brand,
    manufacturerModel,
    sourceItemId,
    sourceUrl: `https://m.midea.cn/item/${sourceItemId}`,
    classifications: [
      { dimensionCode: "regulatory_product_class" as const, status: "classified" as const, valueCode: "combination_refrigerator", valueLabel: "组合式冷藏冷冻箱" },
      { dimensionCode: "installation_form" as const, status: "classified" as const, valueCode: "freestanding", valueLabel: "独立式" },
      { dimensionCode: "door_layout" as const, status: "classified" as const, valueCode: doorLayout, valueLabel: doorLayout },
    ],
  };
}

function regulatorySnapshot(): OfficialCatalogSnapshot {
  return {
    sourceId: "china-energy-label-refrigerator-registry",
    sourceIdentity: "china-energy-label-public-registration",
    sourceAuthorityType: "regulatory_source",
    coverageKind: "regulatory_registry_lookup",
    catalogUrl: "https://www.energylabel.com.cn/",
    observedAt: "2026-08-16T13:00:00.000Z",
    declaredItemCount: 1,
    fetchedItemCount: 1,
    acceptedItemCount: 1,
    coverageStatus: "partial",
    entries: [{
      brand: "美的",
      manufacturerModel: "MR-457WUSPZE",
      sourceItemId: "registration-1",
      sourceUrl: "https://www.energylabel.com.cn/",
      identityStatus: "confirmed",
      regulatoryProducer: { key: "producer:midea", label: "美的集团" },
    }],
  };
}

function createDraft(): ProductProjectDraftInput {
  return {
    name: "冰箱市场总体测试",
    knowledgeTopic: "中国市场冰箱专业知识",
    market: "CN",
    categoryDefinition: {
      categoryCode: "household_refrigerator",
      label: "冰箱",
      sourceAuthorityPolicy: ["brand_official_site", "official_direct_retail", "regulatory_source"],
      attributes: [{
        code: "identity.model",
        label: "厂商型号",
        description: "生产者声明的型号",
        knowledgeLayer: "identity",
        valueKind: "text",
        externalMappings: [],
        filterable: true,
        comparable: true,
      }],
      decisionDimensions: [{
        code: "identity.coverage",
        label: "型号覆盖",
        description: "确认型号是否进入总体",
        relatedAttributeCodes: ["identity.model"],
      }],
      competencyQuestions: ["当前官方在售型号有哪些？"],
    },
    confirmedScope: {
      populationLayers: ["official_current_catalog"],
      targets: [{
        key: "category:refrigerator-cn",
        kind: "category",
        label: "中国冰箱",
        evidenceReferenceIds: ["brief-1"],
        disposition: "included",
        reason: "已确认品类范围",
      }],
    },
    collectionBoard: {
      lanes: [{
        id: "lane-official",
        sourceAuthorityType: "brand_official_site",
        accessMode: "public_web",
        targetKeys: ["category:refrigerator-cn"],
        knowledgeLayers: ["identity"],
        refreshPolicy: "weekly",
        stopConditions: ["access_denied", "source_abnormal"],
      }],
    },
  };
}
