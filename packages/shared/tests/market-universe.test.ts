import { describe, expect, it } from "vitest";

import {
  marketUniverseContentSchema,
  officialCatalogSnapshotSchema,
} from "../src/market-universe";

describe("MarketUniverse contracts", () => {
  it("区分读取行、接收行和按品牌型号去重后的真实分母", () => {
    expect(officialCatalogSnapshotSchema.parse({
      sourceId: "midea-official-catalog",
      sourceIdentity: "midea-cn-official-mall",
      sourceAuthorityType: "brand_official_site",
      coverageKind: "multi_brand_official_catalog",
      catalogUrl: "https://www.midea.cn/s/search/search.html?category_id=10008",
      observedAt: "2026-08-16T12:00:00.000Z",
      declaredItemCount: 384,
      fetchedItemCount: 384,
      acceptedItemCount: 284,
      coverageStatus: "complete",
      entries: Array.from({ length: 284 }, (_, index) => ({
        brand: "美的",
        manufacturerModel: index < 2 ? "MR-457WUSPZE" : `MODEL-${index}`,
        sourceItemId: String(index),
        sourceUrl: `https://m.midea.cn/item/${index}`,
      })),
    }).acceptedItemCount).toBe(284);
  });

  it("拒绝把不存在的来源引用塞进型号总体", () => {
    expect(() => marketUniverseContentSchema.parse({
      basis: "official_active_assortment",
      deduplicationRule: "brand_and_manufacturer_model",
      observationStartedAt: "2026-08-16T12:00:00.000Z",
      observationEndedAt: "2026-08-16T12:01:00.000Z",
      coverageDimensions: [{
        code: "regulatory_product_class",
        label: "国家标准产品类别",
        taxonomyVersion: "GB/T 8059-2025",
        requiredForConfirmation: true,
      }],
      sources: [{
        sourceId: "haier",
        sourceIdentity: "haier-cn",
        sourceAuthorityType: "brand_official_site",
        coverageKind: "independent_brand_catalog",
        catalogUrl: "https://www.haier.com/cooling/",
        observedAt: "2026-08-16T12:00:00.000Z",
        declaredItemCount: 271,
        fetchedItemCount: 271,
        acceptedItemCount: 271,
        uniqueModelCount: 271,
        coverageStatus: "complete",
        observedBrandKeys: ["haier"],
      }],
      models: [{
        key: "model:haier:bcd-500",
        brand: { key: "haier", label: "海尔" },
        manufacturerModel: "BCD-500",
        identityStatus: "confirmed",
        regulatoryProducers: [],
        classifications: [{
          dimensionCode: "regulatory_product_class",
          status: "classified",
          valueCode: "combination_refrigerator",
          valueLabel: "组合式冷藏冷冻箱",
        }],
        sourceRefs: [{ sourceId: "missing", sourceItemId: "1", sourceUrl: "https://example.com/1" }],
      }],
      unknowns: [],
    })).toThrow("型号引用了未知目录来源");
  });

  it("把覆盖维度、未知项作用域和版本状态拆成独立事实", () => {
    const content = marketUniverseContentSchema.parse({
      basis: "official_active_assortment",
      deduplicationRule: "brand_and_manufacturer_model",
      observationStartedAt: "2026-08-16T12:00:00.000Z",
      observationEndedAt: "2026-08-16T12:01:00.000Z",
      coverageDimensions: [{
        code: "regulatory_product_class",
        label: "国家标准产品类别",
        taxonomyVersion: "GB/T 8059-2025",
        requiredForConfirmation: true,
      }],
      sources: [{
        sourceId: "jd",
        sourceIdentity: "jd-self-operated",
        sourceAuthorityType: "official_direct_retail",
        coverageKind: "official_channel_discovery",
        catalogUrl: "https://www.jd.com/brand/737a81dda3769f80aa8.html",
        observedAt: "2026-08-16T12:00:00.000Z",
        declaredItemCount: 2,
        fetchedItemCount: 1,
        acceptedItemCount: 1,
        uniqueModelCount: 1,
        coverageStatus: "partial",
        observedBrandKeys: ["midea"],
      }],
      models: [{
        key: "model:midea:mr-231t",
        brand: { key: "midea", label: "美的" },
        manufacturerModel: "MR-231T",
        identityStatus: "unconfirmed",
        regulatoryProducers: [],
        classifications: [{ dimensionCode: "regulatory_product_class", status: "unknown" }],
        sourceRefs: [{ sourceId: "jd", sourceItemId: "1", sourceUrl: "https://item.jd.com/1.html" }],
      }],
      unknowns: [{
        key: "jd-item-spec-blocked",
        kind: "source_access",
        scope: { type: "source", sourceId: "jd" },
        blocking: true,
        description: "商品规格页触发访问限制，厂商型号尚未核验。",
        requiredSourceAuthorityTypes: ["official_direct_retail"],
      }],
    });

    expect(content.models[0]).not.toHaveProperty("variantCount");
    expect(content.unknowns[0]?.scope).toEqual({ type: "source", sourceId: "jd" });
  });
});
