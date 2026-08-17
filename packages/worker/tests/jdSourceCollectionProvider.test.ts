import type {
  SourceCollectionRun,
  SourceCollectionWorkItem,
} from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import {
  createJdSourceCollectionProvider,
  type JdPageReader,
} from "../src/jdSourceCollectionProvider";

describe("JD category-neutral Source Collection provider", () => {
  it("同一 adapter 原样保存电视和冰箱商品页，不在 Provider 内判断品类", async () => {
    const reader: JdPageReader = async (url, kind) => {
      expect(kind).toBe("product");
      const sku = new URL(url).pathname.split("/").at(-1)?.replace(".html", "") ?? "";
      return sku === "tv-1"
        ? product("tv-1", "Fixture TV", "TV-144", "电视", "https://img.jd.com/tv-1.jpg")
        : product("fridge-1", "Fixture Fridge", "F-500", "冰箱", "https://img.jd.com/fridge-1.jpg");
    };
    const provider = createJdSourceCollectionProvider({
      allowedOrigins: ["https://item.jd.com", "https://img.jd.com"],
      pageReader: reader,
    });

    const television = await provider.collect({
      sourceRun: run("television"),
      item: item("tv-1"),
    });
    const refrigerator = await provider.collect({
      sourceRun: run("household_refrigerator"),
      item: item("fridge-1"),
    });

    expect(television.content).toMatchObject({
      kind: "ordered_record",
      fieldGroups: [
        { fields: [{ name: "品类", value: "电视" }, { name: "品牌", value: "Fixture TV" }, { name: "型号", value: "TV-144" }] },
        { fields: [{ name: "尺寸", value: "144", unit: "cm" }] },
        { fields: [{ name: "尺寸", value: "1280×720" }] },
      ],
      blocks: [
        { kind: "text", role: "feature" },
        { kind: "table", columns: ["名称", "值"] },
        { kind: "asset_ref", sourceUrl: "https://img.jd.com/tv-1.jpg" },
      ],
    });
    expect(refrigerator.content).toMatchObject({
      kind: "ordered_record",
      fieldGroups: [
        { fields: [{ name: "品类", value: "冰箱" }, { name: "品牌", value: "Fixture Fridge" }, { name: "型号", value: "F-500" }] },
        { fields: [{ name: "尺寸", value: "144", unit: "cm" }] },
        { fields: [{ name: "尺寸", value: "1280×720" }] },
      ],
    });
  });

  it("分类、店铺和评价分别保存为严格 SourceDataset 内容", async () => {
    const seenKinds: string[] = [];
    const reader: JdPageReader = async (_url, kind) => {
      seenKinds.push(kind);
      if (kind === "taxonomy") return taxonomy();
      if (kind === "store") return store();
      if (kind === "reviews") return reviews("tv-1");
      throw new Error(`unexpected kind ${kind}`);
    };
    const provider = createJdSourceCollectionProvider({
      allowedOrigins: ["https://channel.jd.com", "https://mall.jd.com", "https://club.jd.com", "https://item.jd.com"],
      pageReader: reader,
    });

    const taxonomyResult = await provider.collect({
      sourceRun: run("television"),
      item: workItem("taxonomy", "tv-taxonomy", "https://channel.jd.com/television.html"),
    });
    const storeResult = await provider.collect({
      sourceRun: run("television"),
      item: workItem("organization", "store-1", "https://mall.jd.com/store-1.html"),
    });
    const reviewResult = await provider.collect({
      sourceRun: run("television"),
      item: workItem("experience", "tv-1-reviews", "https://club.jd.com/tv-1.html"),
    });

    expect(seenKinds).toEqual(["taxonomy", "store", "reviews"]);
    expect(taxonomyResult.content).toMatchObject({
      kind: "catalog",
      taxonomyPath: ["家用电器", "电视"],
      facets: [{ name: "屏幕类型" }],
    });
    expect(storeResult.content).toMatchObject({
      kind: "ordered_record",
      fieldGroups: [{
        label: "店铺身份",
        fields: [
          { name: "店铺名称", value: "Fixture 京东自营旗舰店" },
          { name: "经营主体", value: "Fixture Retail" },
        ],
      }],
    });
    expect(reviewResult.content).toMatchObject({
      kind: "experience_collection",
      summaryMetrics: [{ name: "总评价数", value: "1200" }],
      samplingPlan: { sampleSize: 2 },
      ratingBands: [
        { label: "好评", count: 1100 },
        { label: "中评", count: 70 },
        { label: "差评", count: 30 },
      ],
      samples: [{ externalKey: "review-1", position: 1 }, { externalKey: "review-2", position: 2 }],
    });
  });

  it("目录保留卡片顺序、自营标记和所有对象引用", async () => {
    const provider = createJdSourceCollectionProvider({
      allowedOrigins: ["https://www.jd.com", "https://item.jd.com"],
      pageReader: async () => ({
        kind: "catalog",
        state: "accessible",
        pageNumber: 1,
        pageCount: 2,
        cards: [
          { sku: "1001", title: "第一件", sourceUrl: "https://item.jd.com/1001.html", selfOperated: true },
          { sku: "1002", title: "第二件", sourceUrl: "https://item.jd.com/1002.html", selfOperated: false },
        ],
      }),
    });

    const result = await provider.collect({
      sourceRun: run("television"),
      item: {
        ...item("catalog-1"),
        object: { sourceIdentity: "jd-fixture", kind: "catalog_entry", externalKey: "catalog-1" },
        requestedUrl: "https://www.jd.com/catalog?page=1",
      },
    });

    expect(result.content).toMatchObject({
      kind: "catalog",
      entries: [
        { position: 1, label: "第一件", fields: [{ name: "selfOperated", value: "true" }] },
        { position: 2, label: "第二件", fields: [{ name: "selfOperated", value: "false" }] },
      ],
    });
  });

  it("没有已验证 reader 时返回 typed stop，不发起任何访问", async () => {
    const provider = createJdSourceCollectionProvider({ allowedOrigins: ["https://item.jd.com"] });
    const result = await provider.collect({ sourceRun: run("television"), item: item("tv-1") });

    expect(result).toMatchObject({
      observation: { state: "source_abnormal", failureCode: "source_abnormal" },
      stopRun: true,
    });
    expect(result.content).toBeUndefined();
  });

  it("嵌套资源 URL 不在 allowlist 时失败关闭", async () => {
    const provider = createJdSourceCollectionProvider({
      allowedOrigins: ["https://item.jd.com"],
      pageReader: async () => product("tv-1", "Fixture TV", "TV-144", "电视", "https://evil.example/tv.jpg"),
    });

    const result = await provider.collect({ sourceRun: run("television"), item: item("tv-1") });

    expect(result).toMatchObject({
      observation: { state: "source_abnormal", failureCode: "source_abnormal" },
      stopRun: true,
    });
    expect(result.content).toBeUndefined();
  });
});

function product(sku: string, brand: string, model: string, category: string, assetUrl: string) {
  return {
    kind: "product" as const,
    state: "accessible" as const,
    sku,
    content: {
      kind: "ordered_record" as const,
      title: `${brand} ${model}`,
      fieldGroups: [
        { label: "商品身份", fields: [{ name: "品类", value: category }, { name: "品牌", value: brand }, { name: "型号", value: model }] },
        { label: "商品规格", fields: [{ name: "尺寸", value: "144", unit: "cm" }] },
        { label: "包装规格", fields: [{ name: "尺寸", value: "1280×720" }] },
      ],
      blocks: [
        { kind: "text" as const, role: "feature" as const, text: "Fixture 商品特性原文。" },
        { kind: "table" as const, title: "规格表", columns: ["名称", "值"], rows: [["能效", "一级"]] },
        { kind: "asset_ref" as const, assetKey: `${sku}-hero`, role: "主图", sourceUrl: assetUrl },
      ],
    },
  };
}

function taxonomy() {
  return {
    kind: "taxonomy" as const,
    state: "accessible" as const,
    content: {
      kind: "catalog" as const,
      title: "电视分类",
      taxonomyPath: ["家用电器", "电视"],
      facets: [{ name: "屏幕类型", options: [{ label: "Mini LED", value: "mini-led", count: 42 }] }],
      entries: [{
        position: 1,
        label: "电视",
        target: { sourceIdentity: "jd-fixture", objectKind: "taxonomy" as const, externalKey: "television" },
        sourceUrl: "https://channel.jd.com/television.html",
      }],
    },
  };
}

function store() {
  return {
    kind: "store" as const,
    state: "accessible" as const,
    content: {
      kind: "ordered_record" as const,
      title: "Fixture 京东自营旗舰店",
      fieldGroups: [{
        label: "店铺身份",
        fields: [{ name: "店铺名称", value: "Fixture 京东自营旗舰店" }, { name: "经营主体", value: "Fixture Retail" }],
      }],
      blocks: [{ kind: "text" as const, role: "notice" as const, text: "Fixture 店铺资质观察。" }],
    },
  };
}

function reviews(sku: string) {
  return {
    kind: "reviews" as const,
    state: "accessible" as const,
    sku,
    content: {
      kind: "experience_collection" as const,
      title: `${sku} 评价样本`,
      summaryMetrics: [{ name: "总评价数", value: "1200" }],
      samplingPlan: { method: "固定排序、固定页码的可复核 fixture", sampleSize: 2, ordering: "default", pageRange: "1" },
      ratingBands: [{ label: "好评", count: 1100 }, { label: "中评", count: 70 }, { label: "差评", count: 30 }],
      samples: [
        { externalKey: "review-1", position: 1, text: "画面清楚，安装顺利。", rating: 5, observedAt: "2026-08-17T08:00:00.000Z" },
        { externalKey: "review-2", position: 2, text: "接口数量符合预期。", rating: 4, observedAt: "2026-08-17T08:00:00.000Z" },
      ],
    },
  };
}

function item(externalKey: string): SourceCollectionWorkItem {
  return workItem("product", externalKey, `https://item.jd.com/${externalKey}.html`);
}

function workItem(
  kind: SourceCollectionWorkItem["object"]["kind"],
  externalKey: string,
  requestedUrl: string,
): SourceCollectionWorkItem {
  return {
    id: `item-${externalKey}`,
    object: { sourceIdentity: "jd-fixture", kind, externalKey },
    requestedUrl,
    targetKeys: ["category:fixture"],
    knowledgeNeedIds: ["need:model-fact"],
    parsing: { adapterId: "jd-source-collection", adapterVersion: "v1" },
    claimScopes: ["model_fact"],
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed",
      sourceRedistribution: "unknown",
      basis: "fixture policy",
    },
  };
}

function run(categoryCode: string): SourceCollectionRun {
  return {
    id: `run-${categoryCode}`,
    projectId: `project-${categoryCode}`,
    categoryDefinitionVersionId: `definition-${categoryCode}`,
    confirmedScopeVersionId: `scope-${categoryCode}`,
    collectionBoardVersionId: `board-${categoryCode}`,
    categoryCode,
    collectionLaneId: `lane-${categoryCode}`,
    providerKey: "jd-source-collection",
    sourceAuthorityType: "official_direct_retail",
    accessPolicy: { kind: "manual", version: "fixture-v1" },
    status: "running",
    snapshotCount: 0,
    accessibleCount: 0,
    failedCount: 0,
    assetCount: 0,
    startedAt: "2026-08-17T08:00:00.000Z",
  };
}
