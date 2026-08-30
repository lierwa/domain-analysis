import { captureTaskSchema } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import { buildZolCategoryPlanContent } from "../src/zolCategoryPlanningRuntime";

const at = "2026-08-30T00:00:00.000Z";

describe("ZOL 通用门类计划组装", () => {
  it("用电视榜单筛出综合评分大于零的品牌，并投影 3/10/20 执行策略", () => {
    const content = buildZolCategoryPlanContent(task(), verifiedResearch(), at);

    expect(content.planningBlockers).toEqual([]);
    expect(content.sources).toHaveLength(1);
    expect(content.sources[0]).toMatchObject({
      key: "zol.digital_tv.ranked-brands",
      entryUrls: [
        "https://detail.zol.com.cn/digital_tv/hisense/",
        "https://detail.zol.com.cn/digital_tv/skyworth/",
      ],
      provider: { key: "zol.catalog-gallery", version: "1.2.0" },
      sourceCandidateIds: ["zol-tv-ranking", "zol-tv-pictures"],
    });
    expect(content.sources[0]!.provider.configuration).toEqual(expect.arrayContaining([
      { key: "category_slug", value: "digital_tv" },
      { key: "brand_batch_size", value: 3 },
      { key: "model_batch_size", value: 10 },
      { key: "target_models_per_brand", value: 20 },
    ]));
    expect(content.sources[0]!.targets[0]!.quantity).toMatchObject({ targetCount: 40 });
  });

  it("排行榜不可验证时形成空来源受阻草稿，停在计划确认门", () => {
    const research = { ...verifiedResearch(), ranking: {
      status: "unavailable" as const,
      evidenceUrls: ["https://detail.zol.com.cn/digital_tv/"],
      reason: "当前公开页面没有可验证的品牌综合评分列。",
    } };
    const content = buildZolCategoryPlanContent(task(), research, at);

    expect(content.sources).toEqual([]);
    expect(content.executionChecklistVersion).toBe(5);
    expect(content.planningBlockers[0]).toContain("品牌排行榜尚不可验证");
  });

  it("旧任务缺少品牌筛选与批次确认事实时拒绝静默套用新默认", () => {
    const legacy = captureTaskSchema.parse({ ...task(), content: {
      ...task().content,
      brandSelectionPolicy: { mode: "all_available_brands" },
      executionCadencePolicy: { mode: "unspecified" },
    } });

    expect(() => buildZolCategoryPlanContent(legacy, verifiedResearch(), at))
      .toThrow("必须显式确认品牌排行榜筛选");
  });

  it("榜单任一行缺少唯一品牌目录时拒绝形成排行榜事实", () => {
    const research = verifiedResearch();
    const invalidResearch = {
      ...research,
      ranking: {
        ...research.ranking,
        rows: [...research.ranking.rows.slice(0, 2), {
          rank: 3, name: "松下", comprehensiveScore: 0,
          key: null, catalogUrl: "",
        }],
      },
    };

    expect(() => buildZolCategoryPlanContent(task(), invalidResearch as never, at)).toThrow();
  });

  it("榜单超过品牌上限时只选择前二十个正分品牌", () => {
    const rows = Array.from({ length: 22 }, (_value, index) => ({
      rank: index + 1,
      comprehensiveScore: 100 - index,
      ...brand(`brand${index + 1}`, `品牌${index + 1}`),
    }));
    const content = buildZolCategoryPlanContent(task(), {
      ...verifiedResearch(), ranking: { status: "verified" as const,
        rankingUrl: "https://top.zol.com.cn/compositor/314/manu_attention.html", rows },
    }, at);

    expect(content.researchAudit).toMatchObject({ executionBrands: rows.slice(0, 20)
      .map(({ key, name, catalogUrl }) => ({ key, name, catalogUrl })) });
    expect(content.sources[0]!.entryUrls).toHaveLength(20);
  });

  it("入选榜单品牌无法映射目录时拒绝生成可执行来源", () => {
    const invalidResearch = {
      ...verifiedResearch(), ranking: { status: "verified" as const,
        rankingUrl: "https://top.zol.com.cn/compositor/314/manu_attention.html", rows: [
          { rank: 1, name: "海信", comprehensiveScore: 99.7 },
          ...verifiedResearch().ranking.rows.slice(1),
        ] },
    };

    expect(() => buildZolCategoryPlanContent(task(), invalidResearch as never, at)).toThrow();
  });
});

function task() {
  return captureTaskSchema.parse({
    id: "task-tv", name: "电视抓取任务", status: "ready", revision: 1,
    content: {
      originalRequest: "调查电视门类", category: { code: "television", label: "电视" },
      marketScope: "中国大陆公开市场",
      brandSelectionPolicy: { mode: "source_brand_ranking", scoreField: "comprehensive_score",
        minimumScoreExclusive: 0, maxBrands: 20 },
      executionCadencePolicy: { mode: "fixed", brandBatchSize: 3, modelsPerBrandPerRound: 10 },
      modelCoveragePolicy: { mode: "max_models_per_brand", maxModelsPerBrand: 20 },
      generalTopics: ["品牌、型号、参数和来源原图"], categoryTopics: ["屏幕规格"],
      sourceCandidates: [
        candidate("zol-tv-ranking", "https://top.zol.com.cn/compositor/314/manu_attention.html"),
        candidate("zol-tv-pictures", "https://detail.zol.com.cn/digital_tv/pic.html"),
        candidate("zol-vehicle-tv-exclusion", "https://top.zol.com.cn/compositor/trend_806.html"),
      ], excludedContent: [], unresolvedItems: [], decisionIds: [],
    },
    createdAt: at, updatedAt: at, confirmedAt: at,
  });
}

function verifiedResearch() {
  return {
    assistantText: "电视门类榜单计划草稿已形成，等待负责人确认。",
    categoryUrl: "https://detail.zol.com.cn/digital_tv/",
    categorySlug: "digital_tv",
    evidenceUrls: ["https://detail.zol.com.cn/digital_tv/",
      "https://top.zol.com.cn/compositor/314/manu_attention.html"],
    ranking: {
      status: "verified" as const,
      rankingUrl: "https://top.zol.com.cn/compositor/314/manu_attention.html",
      rows: [
        { rank: 1, comprehensiveScore: 99.7, ...brand("hisense", "海信") },
        { rank: 2, comprehensiveScore: 99.4, ...brand("skyworth", "创维") },
        { rank: 3, comprehensiveScore: 0, ...brand("panasonic", "松下") },
      ],
    },
    budgetRationale: "两个执行品牌各最多二十个型号，按三个品牌一批和每轮十个型号推进。",
  };
}

function brand(key: string, name: string) {
  return { key, name, catalogUrl: `https://detail.zol.com.cn/digital_tv/${key}/` };
}

function candidate(id: string, entryUrl: string) {
  return { id, name: id, publisher: "ZOL", entryUrl, sourceKind: "other" as const,
    expectedContents: ["ZOL 门类资料"], observedFormats: ["HTML"], accessState: "public" as const,
    observedAt: at };
}
