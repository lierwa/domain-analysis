import { crawlPlanSchema } from "@domain-analysis/shared";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CrawlPlanCard, planningTimelineText } from "../src/pages/CrawlPlanningPanel";

describe("抓取计划投影", () => {
  it("直接展示 AI 深搜品牌账、官网、标准与技术资料清单", () => {
    const html = renderToString(
      <CrawlPlanCard
        plan={plan()}
        currentTaskRevision={2}
        isConfirming={false}
        onConfirm={vi.fn()}
        preparation={undefined}
        isPreparing={false}
        onPrepare={vi.fn()}
        isExecuting={false}
        onExecute={vi.fn()}
      />,
    );

    expect(html).toContain("AI 深度来源调查");
    expect(html).toContain("覆盖分母");
    expect(html).toContain("长尾与细分品牌");
    expect(html).toContain("未解决品牌");
    expect(html).toContain("海尔官网产品页");
    expect(html).toContain("国家标准原文");
    expect(html).toContain("制冷原理资料");
    expect(html.replaceAll("<!-- -->", "")).toContain("执行清单 4");
    expect(html).toContain("url=https://example.com/gb.pdf");
    expect(html).toContain("确认此计划");
    expect(html).toContain("不创建 Source Run，也不开始抓取");
    expect(html).not.toContain(">开始抓取<");
  });

  it("已确认计划必须先准备环境，ready 后才能开始新批次", () => {
    const html = renderToString(<CrawlPlanCard plan={plan("confirmed")} currentTaskRevision={2}
      isConfirming={false} onConfirm={vi.fn()} preparation={undefined} isPreparing={false}
      onPrepare={vi.fn()} isExecuting={false} onExecute={vi.fn()} />);
    expect(html).toContain("public.web-resource@2.0.0");
    expect(html).toContain("检查抓取条件");
    expect(html).not.toContain(">开始抓取<");
    expect(html).not.toContain("确认此计划");

    const readyHtml = renderToString(<CrawlPlanCard plan={plan("confirmed")} currentTaskRevision={2}
      isConfirming={false} onConfirm={vi.fn()} preparation={{ status: "ready", message: "已就绪" }}
      isPreparing={false} onPrepare={vi.fn()} isExecuting={false} onExecute={vi.fn()} />);
    expect(readyHtml).toContain("开始新批次抓取");
    expect(readyHtml).toContain("只完成抓取条件检查，尚未创建抓取批次，也没有访问任何来源");

    const submittedHtml = renderToString(<CrawlPlanCard plan={plan("confirmed")} currentTaskRevision={2}
      isConfirming={false} onConfirm={vi.fn()} preparation={undefined} isPreparing={false}
      onPrepare={vi.fn()} isExecuting={false} onExecute={vi.fn()}
      executionAccepted="后台抓取已提交。现在可以关闭或离开页面，批次不会中止。" />);
    expect(submittedHtml).toContain("现在可以关闭或离开页面，批次不会中止");
    expect(submittedHtml).not.toContain("正在抓取");
  });

  it("来源和内部抓取项默认全部折叠", () => {
    const html = renderToString(<CrawlPlanCard plan={plan("confirmed")} currentTaskRevision={2}
      isConfirming={false} onConfirm={vi.fn()} preparation={undefined} isPreparing={false}
      onPrepare={vi.fn()} isExecuting={false} onExecute={vi.fn()} />);
    const sourceDetails = html.match(/<details[^>]*data-crawl-plan-source="true"[^>]*>/g) ?? [];
    const targetDetails = html.match(/<details[^>]*data-crawl-plan-target="true"[^>]*>/g) ?? [];

    expect(sourceDetails).toHaveLength(4);
    expect(targetDetails).toHaveLength(4);
    expect([...sourceDetails, ...targetDetails].every((tag) => !/\sopen(?:=|\s|>)/.test(tag))).toBe(true);
  });

  it("存在执行阻塞时不把纸面候选显示为可确认计划", () => {
    const html = renderToString(<CrawlPlanCard plan={plan("draft", ["provider_missing"])} currentTaskRevision={2}
      isConfirming={false} onConfirm={vi.fn()} preparation={undefined} isPreparing={false}
      onPrepare={vi.fn()} isExecuting={false} onExecute={vi.fn()} />);
    expect(html).toContain("有执行阻塞");
    expect(html).toContain("不能确认；请按阻塞项重新规划");
    expect(html).not.toContain("确认此计划");
  });

  it("历史 Planning commentary 的结构化外壳只显示人读说明", () => {
    const envelope = JSON.stringify({ assistantText: "正在核实品牌官网与标准来源。",
      planCandidate: { summary: "处理中", sources: [] } });
    expect(planningTimelineText(envelope)).toBe("正在核实品牌官网与标准来源。");
    expect(planningTimelineText("普通规划说明")).toBe("普通规划说明");
  });
});

function plan(status: "draft" | "confirmed" = "draft", executionBlockers: string[] = []) {
  return crawlPlanSchema.parse({
    id: "plan-1", taskId: "task-1", taskRevision: 2, planningRunId: "run-1",
    version: 1, status, contentHash: "0".repeat(64),
    content: {
      executionChecklistVersion: 4,
      researchAudit: researchAudit(),
      taskId: "task-1", taskRevision: 2, summary: "冰箱完整多来源执行清单",
      sources: [{ ...publicSource("brand", "海尔官网产品页", "candidate-brand", "brand_official", "https://example.com/haier.html", "配置参数"), executionBlockers },
      publicSource("brand-secondary", "美的官网产品页", "candidate-brand-secondary", "brand_official", "https://second.example.com/midea.html", "配置参数"),
      publicSource("standard", "国家标准原文", "candidate-standard", "standards_body", "https://example.com/gb.pdf", "国家标准"),
      publicSource("technical", "制冷原理资料", "candidate-technical", "technical_publisher", "https://example.com/principles.html", "底层原理")],
      excludedContent: ["用户账户信息"],
    },
    createdAt: "2026-08-19T00:00:00.000Z",
    ...(status === "confirmed" ? { confirmedAt: "2026-08-19T00:01:00.000Z" } : {}),
  });
}

function publicSource(key: string, name: string, candidateId: string,
  sourceKind: "brand_official" | "standards_body" | "technical_publisher", url: string, topic: string) {
  return { key, name, publisher: name, sourceKind, sourceCandidateIds: [candidateId], role: `保留${topic}原文`,
    entryUrls: [url], provider: { key: "public.web-resource", version: "2.0.0", configuration: [
      { key: "mode", value: "planned_routes" }, { key: "maximum_bytes", value: 25_000_000 },
      { key: "maximum_pages_per_target", value: 40 },
    ] }, accessPolicy: { kind: "paced_http" as const, version: "public-low-frequency-v1",
      maxRequestsPerMinute: 6, minimumIntervalMs: 10_000, maximumRunMs: 180_000 },
    stopPolicy: { requestBudget: 2, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true as const },
    rawOutputPolicy: { formats: [url.endsWith(".pdf") ? "document" as const : "html" as const], retainAssets: url.endsWith(".pdf") },
    observationLevel: "search_discovered" as const, accessState: "unknown" as const, observedAt: "2026-08-19T00:00:00.000Z",
    targets: [{ key: `${key}_resource`, name, taskTopics: [topic], providerConfiguration: [
      { key: "route", value: "exact" }, { key: "url", value: url },
    ],
      captureUnit: "精确公开资源响应", rawFormats: [url.endsWith(".pdf") ? "PDF" : "HTML"],
      quantity: { mode: "target_count" as const, targetCount: 1, unit: "份", denominator: "计划冻结 URL", rationale: "一项一 URL 可对账" },
      uniqueKey: "URL + content hash", traversal: "只请求冻结 URL", stopCondition: "保存 1 份响应或遇访问限制" }], executionBlockers: [] };
}

function researchAudit() {
  return {
    strategyVersion: 3 as const, marketScope: "中国大陆家用冰箱",
    passes: [
      brandPass("authoritative_directory", "权威冰箱品牌目录", "https://industry.example.com/brands", ["海尔", "美的", "待核实品牌"], ["海尔", "美的", "待核实品牌"]),
      brandPass("broad_market_catalog", "广覆盖冰箱目录", "https://catalog.example.net/brands", ["海尔", "美的", "待核实品牌"]),
      brandPass("mainstream_brands", "主流冰箱品牌", "https://mainstream.example.org/brands", ["海尔", "美的", "待核实品牌"]),
      brandPass("long_tail_and_niche", "长尾冰箱品牌", "https://longtail.example.cn/brands", ["海尔", "美的", "待核实品牌"]),
      brandPass("regional_and_imported", "区域进口冰箱品牌", "https://regional.example.com/brands", ["海尔", "美的", "待核实品牌"]),
      brandPass("brand_families_and_subbrands", "冰箱集团与子品牌", "https://families.example.com/brands", ["海尔", "美的", "待核实品牌"]),
      brandPass("saturation_check", "遗漏冰箱品牌核查一", "https://check-one.example.com/brands", ["海尔", "美的", "待核实品牌"]),
      brandPass("saturation_check", "遗漏冰箱品牌核查二", "https://check-two.example.com/brands", ["海尔", "美的", "待核实品牌"]),
      pass("official_source_mapping", "海尔 官方网站", "https://example.com/haier.html"),
      pass("official_source_mapping", "美的 官方网站", "https://second.example.com/midea.html"),
      pass("official_source_mapping", "待核实品牌 中国官网", "https://unknown.example.com/search-cn"),
      pass("official_source_mapping", "待核实品牌 全球官网", "https://unknown.example.com/search-global"),
      pass("parameters_and_manuals", "海尔 参数说明书", "https://example.com/haier-support.html"),
      pass("parameters_and_manuals", "美的 参数说明书", "https://second.example.com/midea-support.html"),
      pass("standards_and_principles", "标准与制冷原理", "https://example.com/gb.pdf"),
    ],
    denominator: { method: "multi_source_union" as const, description: "六类搜索镜头的品牌并集",
      brandCount: 3, evidenceUrls: ["https://industry.example.com/brands", "https://catalog.example.net/brands"] },
    brands: [
      { name: "海尔", aliases: [], evidenceUrls: ["https://industry.example.com/brands"],
        officialSourceKeys: ["brand"], status: "planned" as const, note: "已找到官网" },
      { name: "美的", aliases: [], evidenceUrls: ["https://retail.example.com/brands"],
        officialSourceKeys: ["brand-secondary"], status: "planned" as const, note: "已找到官网" },
      { name: "待核实品牌", aliases: [], evidenceUrls: ["https://retail.example.com/brands"],
        officialSourceKeys: [], status: "unresolved" as const, note: "官网身份待核实" },
    ],
    topicCoverage: [
      { topic: "配置参数", sourceKeys: ["brand", "brand-secondary"], rationale: "官网参数" },
      { topic: "国家标准", sourceKeys: ["standard"], rationale: "标准原文" },
      { topic: "底层原理", sourceKeys: ["technical"], rationale: "权威技术来源" },
    ],
    completeness: "partial" as const, stopReason: "六类镜头形成 3 品牌分母，最后两轮不同查询连续无新增品牌",
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
