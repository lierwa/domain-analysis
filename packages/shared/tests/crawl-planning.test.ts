import { describe, expect, it } from "vitest";

import { crawlPlanCandidateSchema, crawlPlanningRunRequestSchema } from "../src";

describe("抓取计划 contract", () => {
  it("version 4 必须携带四类调查账、site route 与内容验收边界", () => {
    const parsed = crawlPlanCandidateSchema.parse(planCandidate());

    expect(parsed).toMatchObject({
      executionChecklistVersion: 4,
      researchAudit: { completeness: "partial", brands: [{ name: "品牌一" }, { name: "品牌二" }] },
      sources: [{ sourceCandidateIds: ["candidate-brand"] }],
    });
    expect(parsed.sources[0]?.targets[0]?.providerConfiguration).toEqual([
      { key: "route", value: "site" },
      { key: "url", value: "https://brand.example.com/televisions" },
      { key: "required_terms", value: ["电视", "品牌一"] },
      { key: "maximum_depth", value: 2 },
      { key: "minimum_accepted_pages", value: 2 },
    ]);
  });

  it("缺少调查方向、未解决品牌却声明 complete 或旧执行版本时拒绝", () => {
    const candidate = planCandidate();
    expect(crawlPlanCandidateSchema.safeParse({ ...candidate, executionChecklistVersion: 2 }).success).toBe(false);
    expect(crawlPlanCandidateSchema.safeParse({ ...candidate, researchAudit: {
      ...candidate.researchAudit,
      passes: candidate.researchAudit.passes.filter((pass) => pass.area !== "standards_and_principles"),
    } }).success).toBe(false);
    expect(crawlPlanCandidateSchema.safeParse({ ...candidate, researchAudit: {
      ...candidate.researchAudit, completeness: "complete",
    } }).success).toBe(false);
  });

  it("version 4 不接受 JD 或 Provider 占位符", () => {
    const candidate = planCandidate();
    expect(crawlPlanCandidateSchema.safeParse({
      ...candidate,
      sources: [{ ...candidate.sources[0], provider: {
        key: "jd.catalog-market", version: "1.0.0", configuration: [],
      } }],
    }).success).toBe(false);
    expect(crawlPlanCandidateSchema.safeParse({
      ...candidate,
      sources: [{ ...candidate.sources[0], provider: {
        key: "provider.missing", version: "1.0.0", configuration: [{ key: "provider_missing", value: true }],
      } }],
    }).success).toBe(false);
  });

  it("官网来源必须反向归属到至少一个已规划品牌", () => {
    const candidate = planCandidate();
    const orphan = { ...candidate.sources[0]!, key: "orphan-brand",
      name: "遗留但未对账的官网", sourceCandidateIds: [], targets: [{
        ...candidate.sources[0]!.targets[0]!, key: "orphan-catalog",
      }] };

    const parsed = crawlPlanCandidateSchema.safeParse({ ...candidate, sources: [...candidate.sources, orphan] });

    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "官网来源 orphan-brand 必须归属至少一个已规划品牌" }),
    ]));
  });

  it("已规划品牌不能引用同一计划中不存在的官网来源", () => {
    const candidate = planCandidate();
    const invalidCandidate = { ...candidate, researchAudit: { ...candidate.researchAudit,
      brands: [{ ...candidate.researchAudit.brands[0]!,
        officialSourceKeys: ["brand", "missing-brand-source"] }, ...candidate.researchAudit.brands.slice(1)] } };

    const parsed = crawlPlanCandidateSchema.safeParse(invalidCandidate);

    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "品牌 品牌一 引用了不存在或非官网的来源：missing-brand-source" }),
    ]));
  });

  it("site route 为 robots、sitemap、页面和 redirect 预留预算，并拒绝旧链接文字协议", () => {
    const candidate = planCandidate();
    const source = candidate.sources[0]!;
    expect(crawlPlanCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(crawlPlanCandidateSchema.safeParse({ ...candidate, sources: [{
      ...source, stopPolicy: { ...source.stopPolicy, requestBudget: 1 },
    }] }).success).toBe(false);

    const withManual = { ...candidate, sources: [{ ...source,
      targets: [...source.targets, { ...source.targets[0]!, key: "manual", name: "说明书附件",
        providerConfiguration: [
          { key: "from_target", value: "official-catalog" },
          { key: "link_text", value: "查看说明书" },
        ] }],
    }] };
    expect(crawlPlanCandidateSchema.safeParse(withManual).success).toBe(false);
  });

  it("拒绝重复来源/target key 和非法数量", () => {
    const candidate = planCandidate();
    const source = candidate.sources[0]!;
    expect(crawlPlanCandidateSchema.safeParse({ ...candidate, sources: [source, source] }).success).toBe(false);
    expect(crawlPlanCandidateSchema.safeParse({ ...candidate, sources: [{
      ...source, targets: [source.targets[0]!, source.targets[0]!],
    }] }).success).toBe(false);
    const invalidSignals = structuredClone(candidate);
    invalidSignals.sources[0]!.targets[0]!.providerConfiguration
      .find((item) => item.key === "required_terms")!.value = ["电视"];
    expect(crawlPlanCandidateSchema.safeParse(invalidSignals).success).toBe(false);
  });

  it("空白补充要求不会成为有效运行请求", () => {
    expect(crawlPlanningRunRequestSchema.safeParse({ expectedTaskRevision: 1, instruction: "   " }).success).toBe(false);
  });
});

function planCandidate() {
  const url = "https://brand.example.com/televisions";
  return {
    executionChecklistVersion: 4 as const,
    summary: "电视品牌官网计划",
    researchAudit: researchAudit(),
    sources: [{
      key: "brand", name: "品牌电视目录", publisher: "品牌官网", sourceKind: "brand_official" as const,
      sourceCandidateIds: ["candidate-brand"], role: "覆盖官方型号与参数", entryUrls: [url],
      provider: { key: "public.web-resource" as const, version: "2.0.0" as const, configuration: [
        { key: "mode" as const, value: "planned_routes" as const },
        { key: "maximum_bytes" as const, value: 5_000_000 },
        { key: "maximum_pages_per_target" as const, value: 40 },
      ] },
      accessPolicy: { kind: "paced_http" as const, version: "public-exact-v1",
        maxRequestsPerMinute: 2, minimumIntervalMs: 30_000, maximumRunMs: 180_000 },
      stopPolicy: { requestBudget: 92, noNewUniqueKeysLimit: 20, stopOnAccessRestriction: true as const },
      rawOutputPolicy: { formats: ["html" as const, "text" as const, "source_json" as const], retainAssets: false },
      observationLevel: "search_discovered" as const, accessState: "unknown" as const,
      observedAt: "2026-08-19T00:00:00.000Z", executionBlockers: [],
      targets: [{
        key: "official-catalog", name: "官方电视目录", taskTopics: ["品牌与型号"],
        providerConfiguration: [{ key: "route" as const, value: "site" as const },
          { key: "url" as const, value: url },
          { key: "required_terms" as const, value: ["电视", "品牌一"] },
          { key: "maximum_depth" as const, value: 2 },
          { key: "minimum_accepted_pages" as const, value: 2 }], captureUnit: "官方目录页",
        rawFormats: ["html"], quantity: { mode: "all_available" as const,
          unit: "页", denominator: "计划同源边界内最多 40 页", rationale: "内容验收后计数" },
        uniqueKey: "规范化 URL", traversal: "sitemap 与同源链接", stopCondition: "队列耗尽或达到计划上限",
      }],
    }],
    excludedContent: ["用户账户数据"],
  };
}

function researchAudit() {
  return {
    strategyVersion: 3 as const, marketScope: "中国大陆电视市场",
    passes: [
      brandPass("authoritative_directory", "权威电视品牌目录", "https://industry.example.com/tv-brands", ["品牌一", "品牌二"], ["品牌一", "品牌二"]),
      brandPass("broad_market_catalog", "广覆盖电视目录", "https://catalog.example.net/tv-brands", ["品牌一", "品牌二"]),
      brandPass("mainstream_brands", "主流电视品牌", "https://mainstream.example.org/tv-brands", ["品牌一", "品牌二"]),
      brandPass("long_tail_and_niche", "长尾电视品牌", "https://longtail.example.cn/tv-brands", ["品牌一", "品牌二"]),
      brandPass("regional_and_imported", "区域进口电视品牌", "https://regional.example.com/tv-brands", ["品牌一", "品牌二"]),
      brandPass("brand_families_and_subbrands", "电视集团与子品牌", "https://families.example.com/tv-brands", ["品牌一", "品牌二"]),
      brandPass("saturation_check", "遗漏电视品牌核查一", "https://check-one.example.com/tv-brands", ["品牌一", "品牌二"]),
      brandPass("saturation_check", "遗漏电视品牌核查二", "https://check-two.example.com/tv-brands", ["品牌一", "品牌二"]),
      pass("official_source_mapping", "品牌一 电视官方网站", "https://brand.example.com/"),
      pass("official_source_mapping", "品牌二 中国官网", "https://second.example.com/search-cn"),
      pass("official_source_mapping", "品牌二 全球官网", "https://second.example.com/search-global"),
      pass("parameters_and_manuals", "品牌一 电视参数说明书", "https://brand.example.com/support"),
      pass("standards_and_principles", "电视标准和显示原理", "https://standard.example.com/tv"),
    ],
    denominator: { method: "multi_source_union" as const, description: "六类搜索镜头的品牌并集",
      brandCount: 2, evidenceUrls: ["https://industry.example.com/tv-brands", "https://catalog.example.net/tv-brands"] },
    brands: [
      { name: "品牌一", aliases: [], evidenceUrls: ["https://industry.example.com/tv-brands"],
        officialSourceKeys: ["brand"], status: "planned" as const, note: "已找到官网" },
      { name: "品牌二", aliases: [], evidenceUrls: ["https://retail.example.com/tv-brands"],
        officialSourceKeys: [], status: "unresolved" as const, note: "官网入口待核实" },
    ],
    topicCoverage: [{ topic: "品牌与型号", sourceKeys: ["brand"], rationale: "官网目录提供型号" }],
    completeness: "partial" as const, stopReason: "六类镜头形成 2 品牌分母，最后两轮不同查询连续无新增品牌",
  };
}

function pass(area: "official_source_mapping" | "parameters_and_manuals" | "standards_and_principles", query: string, url: string) {
  return { area, query, evidenceUrls: [url], finding: "已核实公开来源" };
}

function brandPass(
  lens: "authoritative_directory" | "broad_market_catalog" | "mainstream_brands" | "long_tail_and_niche" | "regional_and_imported" | "brand_families_and_subbrands" | "saturation_check",
  query: string,
  url: string,
  discoveredBrands: string[],
  newlyAddedBrands: string[] = [],
) {
  return { area: "brand_landscape" as const, lens, query, evidenceUrls: [url], discoveredBrands,
    newlyAddedBrands, finding: "已核实公开来源" };
}
