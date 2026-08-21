import { describe, expect, it } from "vitest";

import {
  crawlPlanCandidateSchema,
  crawlPlanningRunRequestSchema,
} from "../src";

describe("抓取计划 contract", () => {
  it("当前计划必须声明完整执行清单版本和 Provider 可读 target 配置", () => {
    const candidate = planCandidate();
    const parsed = crawlPlanCandidateSchema.parse(candidate);
    expect(parsed).toMatchObject({
      executionChecklistVersion: 2,
      sources: [{ sourceCandidateIds: ["candidate-jd"] }],
    });
    expect(parsed.sources[0]?.targets.map((target) => target.providerConfiguration[0])).toEqual([
      { key: "operation", value: "catalog_pages" },
      { key: "operation", value: "store_catalogs" },
      { key: "operation", value: "product_details" },
      { key: "operation", value: "review_summaries" },
      { key: "operation", value: "review_samples" },
    ]);
    expect(crawlPlanCandidateSchema.safeParse({
      ...candidate,
      executionChecklistVersion: undefined,
    }).success).toBe(false);
  });

  it("拒绝把 Provider 占位符保存为新的完整执行清单", () => {
    const candidate = planCandidate();
    candidate.sources[0]!.provider = {
      key: "provider.missing",
      version: "1.0.0",
      configuration: [{ key: "provider_missing", value: true }],
    } as never;

    expect(crawlPlanCandidateSchema.safeParse(candidate).success).toBe(false);
  });

  it("公共来源必须使用精确 URL 配置并为 robots 请求预留预算", () => {
    const candidate = publicPlanCandidate();
    expect(crawlPlanCandidateSchema.safeParse(candidate).success).toBe(true);

    candidate.sources[0]!.provider.configuration = [
      { key: "exact_https", value: true },
      { key: "maximum_bytes", value: 5_000_000 },
    ] as never;
    candidate.sources[0]!.stopPolicy.requestBudget = 1;

    expect(crawlPlanCandidateSchema.safeParse(candidate).success).toBe(false);
  });

  it("公共来源可计划从前序 HTML 唯一跟进一次同源附件", () => {
    const candidate = publicPlanCandidate();
    const source = candidate.sources[0]!;
    source.stopPolicy.requestBudget = 3;
    source.rawOutputPolicy = { formats: ["html", "document"], retainAssets: true } as never;
    source.targets.push({
      ...source.targets[0]!, key: "manual", name: "说明书附件",
      providerConfiguration: [
        { key: "from_target", value: "standard" },
        { key: "link_text", value: "查看说明书" },
      ] as never,
    });

    expect(crawlPlanCandidateSchema.safeParse(candidate).success).toBe(true);
    source.targets[1]!.providerConfiguration = [
      { key: "from_target", value: "missing" },
      { key: "link_text", value: "查看说明书" },
    ] as never;
    expect(crawlPlanCandidateSchema.safeParse(candidate).success).toBe(false);

    source.targets[1]!.providerConfiguration = [
      { key: "link_text", value: "查看说明书" },
      { key: "link_text", value: "查看说明书" },
    ] as never;
    expect(crawlPlanCandidateSchema.safeParse(candidate).success).toBe(false);
  });

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
    executionChecklistVersion: 2 as const,
    summary: "冰箱来源计划",
    sources: [{
      key: "jd.category",
      name: "京东冰箱分类",
      publisher: "京东",
      sourceKind: "retailer" as const,
      sourceCandidateIds: ["candidate-jd"],
      role: "覆盖平台商品与参数组织",
      entryUrls: ["https://www.jd.com/"],
      provider: { key: "jd.catalog-product", version: "2.0.0", configuration: [
        { key: "mode", value: "explicit_http" }, { key: "include_text", value: "冰箱" },
        { key: "exclude_text", value: "二手|冷柜|酒柜" },
      ] },
      accessPolicy: { kind: "paced_http" as const, version: "jd-explicit-http-v2",
        maxRequestsPerMinute: 1, minimumIntervalMs: 60_000, maximumRunMs: 3_600_000 },
      stopPolicy: { requestBudget: 12, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true as const },
      rawOutputPolicy: { formats: ["html" as const, "source_json" as const], retainAssets: false },
      observationLevel: "search_discovered" as const,
      accessState: "unknown" as const,
      observedAt: "2026-08-19T00:00:00.000Z",
      targets: [{
        key: "catalog-pages",
        name: "目录页",
        taskTopics: ["品牌与型号"],
        providerConfiguration: [{ key: "operation", value: "catalog_pages" }],
        captureUnit: "目录响应",
        rawFormats: ["html"],
        quantity: {
          mode: "all_available" as const, unit: "页", denominator: "计划内目录入口",
          rationale: "覆盖计划冻结的目录页",
        },
        uniqueKey: "规范化 GET URL", traversal: "逐入口显式请求", stopCondition: "入口耗尽或首次受限",
      }, ...jdDynamicTargets()],
      executionBlockers: [],
    }],
    excludedContent: ["用户账户数据"],
  };
}

function jdDynamicTargets() {
  return [
    jdTarget("store-catalogs", "店铺目录", "store_catalogs", ["html"]),
    jdTarget("product-details", "商品详情", "product_details", ["html", "source_json"]),
    jdTarget("review-summaries", "评价汇总", "review_summaries", ["source_json"]),
    { ...jdTarget("review-samples", "评价样本", "review_samples", ["source_json"]),
      providerConfiguration: [{ key: "operation", value: "review_samples" },
        { key: "samples_per_product", value: 50 }] },
  ];
}

function jdTarget(key: string, name: string, operation: string, rawFormats: string[]) {
  return { key, name, taskTopics: ["品牌与型号"], providerConfiguration: [{ key: "operation", value: operation }],
    captureUnit: name, rawFormats, quantity: { mode: "all_available" as const, unit: "个",
      denominator: "前序捕获发现且接纳的对象", rationale: "逐对象严格对账" }, uniqueKey: "稳定对象键",
    traversal: "由前序原始响应发现", stopCondition: "全部已发现对象完成或首次受限" };
}

function publicPlanCandidate() {
  const candidate = planCandidate();
  const source = candidate.sources[0]!;
  const url = "https://example.com/standard";
  return { ...candidate, sources: [{ ...source,
    key: "public-standard",
    sourceKind: "standards_body" as const,
    entryUrls: [url],
    provider: { key: "public.web-resource" as const, version: "1.0.0" as const, configuration: [
      { key: "mode" as const, value: "exact_https" as const },
      { key: "maximum_bytes" as const, value: 5_000_000 },
    ] },
    accessPolicy: { ...source.accessPolicy, version: "public-exact-v1", maxRequestsPerMinute: 1,
      minimumIntervalMs: 60_000 },
    stopPolicy: { ...source.stopPolicy, requestBudget: 2 },
    targets: [{ ...source.targets[0]!, key: "standard", quantity: { mode: "target_count" as const,
      targetCount: 1, unit: "份", denominator: "精确 URL", rationale: "单次精确捕获" }, providerConfiguration: [
      { key: "url" as const, value: url },
    ] }],
  }] };
}
