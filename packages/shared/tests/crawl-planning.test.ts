import { describe, expect, it } from "vitest";

import { brandRankingPlanningAuditSchema, crawlPlanContentSchema } from "../src";

const at = "2026-08-30T00:00:00.000Z";

describe("品牌排行榜规划契约", () => {
  it("按评分阈值与品牌上限确定性校验执行品牌集合", () => {
    const audit = brandRankingPlanningAuditSchema.parse({
      kind: "brand_ranking_selection",
      rankingStatus: "verified",
      categoryUrl: "https://detail.zol.com.cn/digital_tv/",
      categorySlug: "digital_tv",
      evidenceUrls: ["https://detail.zol.com.cn/digital_tv/",
        "https://top.zol.com.cn/compositor/314/manu_attention.html"],
      observedAt: at,
      selectionPolicy: { scoreField: "comprehensive_score", minimumScoreExclusive: 0, maxBrands: 2 },
      rankingUrl: "https://top.zol.com.cn/compositor/314/manu_attention.html",
      rankingRows: [
        { rank: 1, comprehensiveScore: 99.7, ...brand("hisense", "海信") },
        { rank: 2, comprehensiveScore: 99.4, ...brand("skyworth", "创维") },
        { rank: 3, comprehensiveScore: 0, ...brand("tcl", "TCL") },
      ],
      executionBrands: [brand("hisense", "海信"), brand("skyworth", "创维")],
      blockedSelectedBrands: [],
      brandBatchSize: 3,
      modelsPerBrandPerRound: 10,
      maxModelsPerBrand: 20,
      estimatedModelCapacity: 40,
      requestBudget: 5_000,
      maximumRunMs: 43_200_000,
      budgetRationale: "两个执行品牌各最多二十个型号。",
    });

    expect(audit.rankingStatus).toBe("verified");
    if (audit.rankingStatus !== "verified") throw new Error("测试 fixture 必须是已验证榜单");
    expect(brandRankingPlanningAuditSchema.safeParse({ ...audit,
      executionBrands: [brand("tcl", "TCL")] }).success).toBe(false);
    expect(brandRankingPlanningAuditSchema.safeParse({ ...audit,
      rankingRows: [audit.rankingRows[1], audit.rankingRows[0], audit.rankingRows[2]],
    }).success).toBe(false);
  });

  it("没有可验证排行榜时只接受带计划级阻塞的空来源草稿", () => {
    expect(crawlPlanContentSchema.safeParse({ taskId: "task-tv", taskRevision: 1,
      summary: "排行榜待核实", excludedContent: [], sources: [] }).success).toBe(false);
    expect(crawlPlanContentSchema.parse({ taskId: "task-tv", taskRevision: 1,
      summary: "排行榜待核实", excludedContent: [], sources: [],
      planningBlockers: ["ZOL 电视品牌排行榜尚不可验证"] }).planningBlockers).toHaveLength(1);
  });
});

function brand(key: string, name: string) {
  return { key, name, catalogUrl: `https://detail.zol.com.cn/digital_tv/${key}/` };
}
