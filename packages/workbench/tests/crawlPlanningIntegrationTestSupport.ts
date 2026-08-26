import {
  crawlPlanningRuntimeOutputSchema,
  type CaptureTaskContent,
  type CrawlPlanningRuntimeOutput,
} from "@domain-analysis/shared";

export function validOutput(variant: number): CrawlPlanningRuntimeOutput {
  return crawlPlanningRuntimeOutputSchema.parse({
    assistantText: "计划覆盖平台、品牌官网、国家标准和底层原理原始数据。",
    planCandidate: {
      executionChecklistVersion: 4,
      summary: `冰箱多来源抓取计划 ${variant}`,
      researchAudit: researchAudit(),
      sources: [source("brand", "candidate-brand", "品牌官网", "https://example.com/products", [
        target("official_parameters", "配置参数", "品牌与型号"),
      ]), source("brand-secondary", "candidate-brand-secondary", "第二品牌官网", "https://second-brand.example.com/products", [
        target("official_parameters_secondary", "配置参数"),
      ]), source("standard", "candidate-standard", "国家标准全文公开系统", "https://example.com/standard.pdf", [
        target("standard_document", "国家标准"),
      ]), source("technical", "candidate-technical", "权威技术资料", "https://example.com/principles", [
        target("principles", "底层原理"),
      ])],
      excludedContent: ["用户账户信息"],
    },
  });
}

export function taskContent(): CaptureTaskContent {
  return {
    originalRequest: "抓冰箱", category: { code: "refrigerator", label: "冰箱" },
    marketScope: "中国大陆家用冰箱", generalTopics: ["品牌与型号", "底层原理"],
    categoryTopics: ["配置参数", "国家标准"],
    jd: { applicable: true, disposition: "included", scope: ["catalog_product_cards"], rationale: "家电核心平台来源" },
    sourceCandidates: [
      candidate("candidate-jd", "京东", "https://www.jd.com/", "retailer"),
      candidate("candidate-brand", "品牌官网", "https://example.com/products", "brand_official"),
      candidate("candidate-brand-secondary", "第二品牌官网", "https://second-brand.example.com/products", "brand_official"),
      candidate("candidate-standard", "国家标准全文公开系统", "https://example.com/standard.pdf", "standards_body"),
      candidate("candidate-technical", "权威技术资料", "https://example.com/principles", "technical_publisher"),
    ], excludedContent: [], unresolvedItems: [], decisionIds: [],
  };
}

function source(key: string, candidateId: string, name: string, entryUrl: string,
  targets: Array<ReturnType<typeof target>>) {
  const brand = key.startsWith("brand");
  return {
    key, name, publisher: name, sourceKind: brand ? "brand_official" as const
      : key === "standard" ? "standards_body" as const : "technical_publisher" as const,
    sourceCandidateIds: [candidateId],
    role: "提供任务所需原始数据", entryUrls: [entryUrl], observationLevel: "search_discovered" as const,
    provider: { key: "public.web-resource", version: "2.0.0", configuration:
      [{ key: "mode", value: "planned_routes" }, { key: "maximum_bytes", value: 5_000_000 },
        { key: "maximum_pages_per_target", value: 40 }] },
    accessPolicy: { kind: "paced_http" as const, version: "public-low-frequency-v1",
      maxRequestsPerMinute: 2, minimumIntervalMs: 10_000, maximumRunMs: 180_000 },
    stopPolicy: { requestBudget: 4, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true as const },
    rawOutputPolicy: { formats: [entryUrl.endsWith(".pdf") ? "document" as const : "html" as const],
      retainAssets: entryUrl.endsWith(".pdf") },
    accessState: "unknown" as const, observedAt: "2026-08-19T00:00:00.000Z",
    targets: targets.map((item) => ({ ...item,
      rawFormats: entryUrl.endsWith(".pdf") ? ["document" as const] : item.rawFormats,
      providerConfiguration: [{ key: "route", value: "exact" }, { key: "url", value: entryUrl }] })),
    executionBlockers: [],
  };
}

export function target(key: string, topic: string, additionalTopic?: string) {
  return {
    key, name: topic, taskTopics: [topic, ...(additionalTopic ? [additionalTopic] : [])], captureUnit: "来源记录", rawFormats: ["html"],
    providerConfiguration: [{ key: "route", value: "exact" },
      { key: "url", value: "https://placeholder.example.com/" }],
    quantity: { mode: "target_count" as const, targetCount: 1, unit: "份",
      denominator: "计划冻结抓取项", rationale: "每项一份原始响应" },
    uniqueKey: "来源 URL", traversal: "按 Provider 配置执行", stopCondition: "保存 1 份响应或遇访问限制",
  };
}

function researchAudit() {
  return {
    strategyVersion: 3 as const, marketScope: "中国大陆家用冰箱",
    passes: [
      brandPass("authoritative_directory", "权威冰箱品牌目录", "https://industry.example.com/refrigerator-brands", ["品牌官网", "第二品牌官网"], ["品牌官网", "第二品牌官网"]),
      brandPass("broad_market_catalog", "广覆盖冰箱目录", "https://catalog.example.net/refrigerator-brands", ["品牌官网", "第二品牌官网"]),
      brandPass("mainstream_brands", "主流冰箱品牌", "https://mainstream.example.org/refrigerator-brands", ["品牌官网", "第二品牌官网"]),
      brandPass("long_tail_and_niche", "长尾冰箱品牌", "https://longtail.example.cn/refrigerator-brands", ["品牌官网", "第二品牌官网"]),
      brandPass("regional_and_imported", "区域进口冰箱品牌", "https://regional.example.com/refrigerator-brands", ["品牌官网", "第二品牌官网"]),
      brandPass("brand_families_and_subbrands", "冰箱集团与子品牌", "https://families.example.com/refrigerator-brands", ["品牌官网", "第二品牌官网"]),
      brandPass("saturation_check", "遗漏冰箱品牌核查一", "https://check-one.example.com/refrigerator-brands", ["品牌官网", "第二品牌官网"]),
      brandPass("saturation_check", "遗漏冰箱品牌核查二", "https://check-two.example.com/refrigerator-brands", ["品牌官网", "第二品牌官网"]),
      researchPass("official_source_mapping", "品牌官网 官方网站", "https://example.com/products"),
      researchPass("official_source_mapping", "第二品牌官网 官方网站", "https://second-brand.example.com/products"),
      researchPass("parameters_and_manuals", "品牌官网 参数说明书", "https://example.com/support"),
      researchPass("parameters_and_manuals", "第二品牌官网 参数说明书", "https://second-brand.example.com/support"),
      researchPass("standards_and_principles", "冰箱标准和制冷原理", "https://example.com/standard.pdf"),
    ],
    denominator: { method: "multi_source_union" as const, description: "六类搜索镜头的品牌并集",
      brandCount: 2, evidenceUrls: ["https://industry.example.com/refrigerator-brands", "https://catalog.example.net/refrigerator-brands"] },
    brands: [
      { name: "品牌官网", aliases: [], evidenceUrls: ["https://industry.example.com/refrigerator-brands"],
        officialSourceKeys: ["brand"], status: "planned" as const, note: "已找到官网" },
      { name: "第二品牌官网", aliases: [], evidenceUrls: ["https://retail.example.com/refrigerator-brands"],
        officialSourceKeys: ["brand-secondary"], status: "planned" as const, note: "已找到官网" },
    ],
    topicCoverage: [
      { topic: "品牌与型号", sourceKeys: ["brand"], rationale: "官网目录" },
      { topic: "底层原理", sourceKeys: ["technical"], rationale: "权威技术资料" },
      { topic: "配置参数", sourceKeys: ["brand", "brand-secondary"], rationale: "品牌官网参数" },
      { topic: "国家标准", sourceKeys: ["standard"], rationale: "标准原文" },
    ],
    completeness: "complete" as const, stopReason: "六类镜头形成 2 品牌分母，最后两轮不同查询连续无新增品牌",
  };
}

function researchPass(area: "official_source_mapping" | "parameters_and_manuals" | "standards_and_principles", query: string, url: string) {
  return { area, query, evidenceUrls: [url], finding: "已核实公开来源" };
}

function brandPass(
  lens: "authoritative_directory" | "broad_market_catalog" | "mainstream_brands" | "long_tail_and_niche" | "regional_and_imported" | "brand_families_and_subbrands" | "saturation_check",
  query: string, url: string, discoveredBrands: string[], newlyAddedBrands: string[] = [],
) {
  return { area: "brand_landscape" as const, lens, query, evidenceUrls: [url], discoveredBrands,
    newlyAddedBrands, finding: "已核实公开来源" };
}

function candidate(id: string, name: string, entryUrl: string,
  sourceKind: CaptureTaskContent["sourceCandidates"][number]["sourceKind"]) {
  return { id, name, publisher: name, entryUrl, sourceKind, expectedContents: ["原始资料"],
    observedFormats: [entryUrl.endsWith(".pdf") ? "PDF" : "HTML"], accessState: "unknown" as const,
    observedAt: "2026-08-19T00:00:00.000Z" };
}
