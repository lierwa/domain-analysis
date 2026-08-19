import { crawlPlanSchema } from "@domain-analysis/shared";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CrawlPlanCard } from "../src/pages/CrawlPlanningPanel";

describe("抓取计划投影", () => {
  it("直接展示来源、内容和数量，并明确确认不会开始抓取", () => {
    const html = renderToString(
      <CrawlPlanCard
        plan={plan()}
        currentTaskRevision={2}
        isConfirming={false}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain("京东冰箱分类");
    expect(html).toContain("商品详情响应 / HTML、JSON");
    expect(html).toContain("样本 20 条评价");
    expect(html).toContain("确认此计划");
    expect(html).toContain("不创建 Source Run，也不开始抓取");
    expect(html).not.toContain(">开始抓取<");
  });
});

function plan() {
  return crawlPlanSchema.parse({
    id: "plan-1", taskId: "task-1", taskRevision: 2, planningRunId: "run-1",
    version: 1, status: "draft", contentHash: "0".repeat(64),
    content: {
      taskId: "task-1", taskRevision: 2, summary: "冰箱平台来源计划",
      sources: [{
        key: "jd", name: "京东冰箱分类", publisher: "京东", sourceKind: "retailer",
        role: "覆盖平台商品详情与参数", entryUrls: ["https://www.jd.com/"],
        observationLevel: "search_discovered", accessState: "unknown",
        observedAt: "2026-08-19T00:00:00.000Z",
        targets: [{
          key: "reviews", name: "评价样本", taskTopics: ["评价样本"],
          captureUnit: "商品详情响应", rawFormats: ["HTML", "JSON"],
          quantity: { mode: "sample", targetCount: 20, unit: "条评价",
            denominator: "每个纳入商品的可见评价", rationale: "保留可审核首批样本" },
          uniqueKey: "SKU + 评价 ID", traversal: "按商品依次读取",
          stopCondition: "每个商品达到 20 条或评价结束",
        }],
        executionBlockers: ["Provider 与频控尚未验证"],
      }],
      excludedContent: ["用户账户信息"],
    },
    createdAt: "2026-08-19T00:00:00.000Z",
  });
}
