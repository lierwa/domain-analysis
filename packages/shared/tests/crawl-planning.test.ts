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
      { key: "operation", value: "catalog" },
      { key: "operation", value: "first_matching_product" },
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
      provider: { key: "jd.catalog-product", version: "1.0.0", configuration: [
        { key: "mode", value: "cdp" }, { key: "include_text", value: "冰箱" },
        { key: "exclude_text", value: "二手|冷柜|酒柜" },
      ] },
      accessPolicy: { kind: "paced_http" as const, version: "jd-low-frequency-v1",
        maxRequestsPerMinute: 2, minimumIntervalMs: 10_000, maximumRunMs: 180_000 },
      stopPolicy: { requestBudget: 2, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true as const },
      rawOutputPolicy: { formats: ["html" as const], retainAssets: false },
      observationLevel: "search_discovered" as const,
      accessState: "unknown" as const,
      observedAt: "2026-08-19T00:00:00.000Z",
      targets: [{
        key: "products",
        name: "商品详情",
        taskTopics: ["品牌与型号"],
        providerConfiguration: [{ key: "operation", value: "catalog" }],
        captureUnit: "商品详情响应",
        rawFormats: ["html"],
        quantity: {
          mode: "target_count" as const,
          targetCount: 1,
          unit: "个商品",
          denominator: "京东冰箱分类当前可见商品",
          rationale: "形成一个有界原始响应",
        },
        uniqueKey: "商品 SKU",
        traversal: "按分类列表顺序",
        stopCondition: "保存目录响应或遇访问限制",
      }, {
        key: "first-product",
        name: "首个商品详情",
        taskTopics: ["品牌与型号"],
        providerConfiguration: [{ key: "operation", value: "first_matching_product" }],
        captureUnit: "首个匹配商品详情响应",
        rawFormats: ["html"],
        quantity: {
          mode: "target_count" as const,
          targetCount: 1,
          unit: "份响应",
          denominator: "目录首次发现的合格商品",
          rationale: "形成目录到详情的有界闭环",
        },
        uniqueKey: "商品 SKU",
        traversal: "按目录链接顺序选择首个合格商品",
        stopCondition: "保存一份详情响应或遇访问限制",
      }],
      executionBlockers: [],
    }],
    excludedContent: ["用户账户数据"],
  };
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
    targets: [{ ...source.targets[0]!, key: "standard", providerConfiguration: [
      { key: "url" as const, value: url },
    ] }],
  }] };
}
