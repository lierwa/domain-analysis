import type { CaptureTaskContent } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import {
  applyProfessionalShoppingGuideDefaults,
  findCaptureTaskReadinessGaps,
  professionalShoppingGuideTopics,
} from "../src/captureTaskReadiness";

describe("专业导购抓取任务完成门", () => {
  it("只有两个品牌官网时明确指出平台、标准和技术原理缺口", () => {
    const content = completeContent();
    content.jd = { applicable: false, disposition: "excluded", scope: [], rationale: "旧草案未确认适用性" };
    content.sourceCandidates = [
      candidate("tcl", "https://www.tcl.com/cn/zh/tvs", "brand_official"),
      candidate("hisense", "https://www.hisense.com/productcat/45.html", "brand_official"),
    ];

    expect(findCaptureTaskReadinessGaps(content)).toEqual([
      "核心零售/市场平台",
      "国家标准或监管来源",
      "权威技术原理来源",
    ]);
  });

  it("平台、品牌、标准监管和技术原理四类来源齐备时通过", () => {
    expect(findCaptureTaskReadinessGaps(completeContent())).toEqual([]);
  });

  it("只有一个品牌官网时仍不足以支持多品牌横向比较", () => {
    const content = completeContent();
    content.sourceCandidates = content.sourceCandidates
      .filter((item) => item.id !== "brand-secondary");

    expect(findCaptureTaskReadinessGaps(content)).toContain("至少两个独立品牌官网");
  });

  it("京东被纳入时必须有实际京东入口，不能用其他零售站冒充", () => {
    const content = completeContent();
    content.sourceCandidates[0] = candidate("retailer", "https://retailer.example.com/tv", "retailer");

    expect(findCaptureTaskReadinessGaps(content)).toEqual(["京东具体类目或品牌入口"]);
  });

  it("确认时确定性加入专业导购固定内容方向且不重复", () => {
    const content = completeContent();
    content.generalTopics = [professionalShoppingGuideTopics[0], "电视画质参数"];

    const completed = applyProfessionalShoppingGuideDefaults(content);

    expect(completed.generalTopics).toEqual([...professionalShoppingGuideTopics, "电视画质参数"]);
  });
});

function completeContent(): CaptureTaskContent {
  return {
    originalRequest: "抓电视数据",
    category: { code: "television", label: "电视" },
    marketScope: "中国大陆主流消费品牌当前在售型号",
    generalTopics: ["在售商品"],
    categoryTopics: ["画质配置"],
    jd: { applicable: true, disposition: "included", scope: ["product_details"], rationale: "适用京东" },
    sourceCandidates: [
      candidate("jd", "https://www.jd.com/televisions", "retailer"),
      candidate("brand", "https://brand.example.com/televisions", "brand_official"),
      candidate("brand-secondary", "https://second-brand.example.com/televisions", "brand_official"),
      candidate("standard", "https://standard.example.com/televisions", "standards_body"),
      candidate("technical", "https://technical.example.com/displays", "technical_publisher"),
    ],
    excludedContent: [], unresolvedItems: [], decisionIds: [],
  };
}

function candidate(
  id: string,
  entryUrl: string,
  sourceKind: CaptureTaskContent["sourceCandidates"][number]["sourceKind"],
) {
  return {
    id, name: id, publisher: id, entryUrl, sourceKind,
    expectedContents: ["任务所需原始资料"], observedFormats: ["HTML"],
    accessState: "public" as const, observedAt: "2026-08-20T00:00:00.000Z",
  };
}
