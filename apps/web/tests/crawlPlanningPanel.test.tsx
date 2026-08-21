import { crawlPlanSchema } from "@domain-analysis/shared";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CrawlPlanCard, planningTimelineText } from "../src/pages/CrawlPlanningPanel";

describe("抓取计划投影", () => {
  it("直接展示平台、品牌、标准与技术资料的逐项执行清单", () => {
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

    expect(html).toContain("京东冰箱分类");
    expect(html).toContain("海尔官网产品页");
    expect(html).toContain("国家标准原文");
    expect(html).toContain("制冷原理资料");
    expect(html.replaceAll("<!-- -->", "")).toContain("执行清单 2");
    expect(html).toContain("operation=catalog_pages");
    expect(html).toContain("url=https://example.com/gb.pdf");
    expect(html).toContain("确认此计划");
    expect(html).toContain("不创建 Source Run，也不开始抓取");
    expect(html).not.toContain(">开始抓取<");
  });

  it("已确认计划先准备环境，单一 Provider 受限时仍可启动其余来源", () => {
    const html = renderToString(<CrawlPlanCard plan={plan("confirmed")} currentTaskRevision={2}
      isConfirming={false} onConfirm={vi.fn()} preparation={undefined} isPreparing={false}
      onPrepare={vi.fn()} isExecuting={false} onExecute={vi.fn()} />);
    expect(html).toContain("jd.catalog-product@2.0.0");
    expect(html).toContain("检查抓取条件");
    expect(html).not.toContain(">开始抓取<");
    expect(html).not.toContain("确认此计划");

    const loginHtml = renderToString(<CrawlPlanCard plan={plan("confirmed")} currentTaskRevision={2}
      isConfirming={false} onConfirm={vi.fn()} preparation={{ status: "action_required",
        action: "login_required", sourceKey: "jd", message: "请扫码登录" }} isPreparing={false}
      onPrepare={vi.fn()} isExecuting={false} onExecute={vi.fn()} />);
    expect(loginHtml).toContain("已完成，重新检查");
    expect(loginHtml).toContain("请扫码登录");
    expect(loginHtml).toContain("开始其余来源");

    const jdOnlyPlan = plan("confirmed");
    jdOnlyPlan.content.sources = jdOnlyPlan.content.sources.slice(0, 1);
    const jdOnlyHtml = renderToString(<CrawlPlanCard plan={jdOnlyPlan} currentTaskRevision={2}
      isConfirming={false} onConfirm={vi.fn()} preparation={{ status: "action_required",
        action: "login_required", sourceKey: "jd", message: "请扫码登录" }} isPreparing={false}
      onPrepare={vi.fn()} isExecuting={false} onExecute={vi.fn()} />);
    expect(jdOnlyHtml).not.toContain("开始其余来源");

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
    expect(targetDetails).toHaveLength(8);
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
      executionChecklistVersion: 2,
      taskId: "task-1", taskRevision: 2, summary: "冰箱完整多来源执行清单",
      sources: [{
        key: "jd", name: "京东冰箱分类", publisher: "京东", sourceKind: "retailer",
        sourceCandidateIds: ["candidate-jd"],
        role: "覆盖平台商品详情与参数", entryUrls: ["https://www.jd.com/"],
        provider: { key: "jd.catalog-product", version: "2.0.0", configuration: [
          { key: "mode", value: "explicit_http" }, { key: "include_text", value: "冰箱" }, { key: "exclude_text", value: "二手|冷柜" },
        ] },
        accessPolicy: { kind: "paced_http", version: "jd-explicit-http-v2", maxRequestsPerMinute: 1, minimumIntervalMs: 60_000, maximumRunMs: 3_600_000 },
        stopPolicy: { requestBudget: 12, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
        rawOutputPolicy: { formats: ["html", "source_json"], retainAssets: false },
        observationLevel: "search_discovered", accessState: "unknown",
        observedAt: "2026-08-19T00:00:00.000Z",
        targets: [jdTarget("catalog-pages", "目录页", "catalog_pages"),
          jdTarget("store-catalogs", "店铺目录", "store_catalogs"),
          jdTarget("product-details", "商品详情", "product_details"),
          jdTarget("review-summaries", "评价汇总", "review_summaries"),
          jdTarget("review-samples", "评价样本", "review_samples")],
        executionBlockers,
      }, publicSource("brand", "海尔官网产品页", "candidate-brand", "brand_official", "https://example.com/haier.html", "配置参数"),
      publicSource("standard", "国家标准原文", "candidate-standard", "standards_body", "https://example.com/gb.pdf", "国家标准"),
      publicSource("technical", "制冷原理资料", "candidate-technical", "technical_publisher", "https://example.com/principles.html", "底层原理")],
      excludedContent: ["用户账户信息"],
    },
    createdAt: "2026-08-19T00:00:00.000Z",
    ...(status === "confirmed" ? { confirmedAt: "2026-08-19T00:01:00.000Z" } : {}),
  });
}

function jdTarget(key: string, name: string, operation: "catalog_pages" | "store_catalogs"
  | "product_details" | "review_summaries" | "review_samples") {
  const review = operation === "review_summaries" || operation === "review_samples";
  return { key, name, taskTopics: ["品牌与型号"], providerConfiguration: operation === "review_samples"
    ? [{ key: "operation", value: operation }, { key: "samples_per_product", value: 100 }]
    : [{ key: "operation", value: operation }],
    captureUnit: "源站响应", rawFormats: [review ? "source_json" : "html"],
    quantity: { mode: "all_available" as const, unit: "份", denominator: "动态工作项", rationale: "逐项对账" },
    uniqueKey: "规范化 GET URL", traversal: "只从前序响应发现", stopCondition: "全部完成或遇访问限制" };
}

function publicSource(key: string, name: string, candidateId: string,
  sourceKind: "brand_official" | "standards_body" | "technical_publisher", url: string, topic: string) {
  return { key, name, publisher: name, sourceKind, sourceCandidateIds: [candidateId], role: `保留${topic}原文`,
    entryUrls: [url], provider: { key: "public.web-resource", version: "1.0.0", configuration: [
      { key: "mode", value: "exact_https" }, { key: "maximum_bytes", value: 5_000_000 },
    ] }, accessPolicy: { kind: "paced_http" as const, version: "public-low-frequency-v1",
      maxRequestsPerMinute: 6, minimumIntervalMs: 10_000, maximumRunMs: 180_000 },
    stopPolicy: { requestBudget: 2, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true as const },
    rawOutputPolicy: { formats: [url.endsWith(".pdf") ? "document" as const : "html" as const], retainAssets: url.endsWith(".pdf") },
    observationLevel: "search_discovered" as const, accessState: "unknown" as const, observedAt: "2026-08-19T00:00:00.000Z",
    targets: [{ key: `${key}_resource`, name, taskTopics: [topic], providerConfiguration: [{ key: "url", value: url }],
      captureUnit: "精确公开资源响应", rawFormats: [url.endsWith(".pdf") ? "PDF" : "HTML"],
      quantity: { mode: "target_count" as const, targetCount: 1, unit: "份", denominator: "计划冻结 URL", rationale: "一项一 URL 可对账" },
      uniqueKey: "URL + content hash", traversal: "只请求冻结 URL", stopCondition: "保存 1 份响应或遇访问限制" }], executionBlockers: [] };
}
