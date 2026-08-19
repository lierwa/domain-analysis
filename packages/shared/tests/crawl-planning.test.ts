import { describe, expect, it } from "vitest";

import {
  crawlPlanCandidateSchema,
  crawlPlanningRunRequestSchema,
} from "../src";

describe("抓取计划 contract", () => {
  it("拒绝重复来源 key 和重复 target key", () => {
    const source = planCandidate().sources[0]!;
    const duplicateSource = crawlPlanCandidateSchema.safeParse({
      ...planCandidate(), sources: [source, source],
    });
    const duplicateTarget = crawlPlanCandidateSchema.safeParse({
      ...planCandidate(),
      sources: [{ ...source, targets: [source.targets[0], source.targets[0]] }],
    });

    expect(duplicateSource.success).toBe(false);
    expect(duplicateTarget.success).toBe(false);
  });

  it("数量目标必须为正整数，all_available 也必须提供覆盖分母", () => {
    const candidate = planCandidate();
    const target = candidate.sources[0]!.targets[0]!;
    const invalidCount = crawlPlanCandidateSchema.safeParse({
      ...candidate,
      sources: [{ ...candidate.sources[0], targets: [{
        ...target,
        quantity: { ...target.quantity, mode: "sample", targetCount: 0 },
      }] }],
    });
    const missingDenominator = crawlPlanCandidateSchema.safeParse({
      ...candidate,
      sources: [{ ...candidate.sources[0], targets: [{
        ...target,
        quantity: { mode: "all_available", unit: "个", denominator: "", rationale: "覆盖总体" },
      }] }],
    });

    expect(invalidCount.success).toBe(false);
    expect(missingDenominator.success).toBe(false);
  });

  it("空白补充要求不会成为有效运行请求", () => {
    expect(crawlPlanningRunRequestSchema.safeParse({
      expectedTaskRevision: 1,
      instruction: "   ",
    }).success).toBe(false);
  });
});

function planCandidate() {
  return {
    summary: "冰箱来源计划",
    sources: [{
      key: "jd.category",
      name: "京东冰箱分类",
      publisher: "京东",
      sourceKind: "retailer" as const,
      role: "覆盖平台商品与参数组织",
      entryUrls: ["https://www.jd.com/"],
      observationLevel: "search_discovered" as const,
      accessState: "unknown" as const,
      observedAt: "2026-08-19T00:00:00.000Z",
      targets: [{
        key: "products",
        name: "商品详情",
        taskTopics: ["品牌与型号"],
        captureUnit: "商品详情响应",
        rawFormats: ["HTML"],
        quantity: {
          mode: "target_count" as const,
          targetCount: 100,
          unit: "个商品",
          denominator: "京东冰箱分类当前可见商品",
          rationale: "形成首批原始数据",
        },
        uniqueKey: "商品 SKU",
        traversal: "按分类列表顺序",
        stopCondition: "达到 100 个唯一 SKU 或列表结束",
      }],
      executionBlockers: ["Provider 与频控尚未验证"],
    }],
    excludedContent: ["用户账户数据"],
  };
}
