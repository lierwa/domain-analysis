import type { CaptureTaskContent } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import {
  applyProfessionalShoppingGuideDefaults,
  professionalShoppingGuideTopics,
} from "../src/captureTaskReadiness";

describe("专业导购抓取任务完成门", () => {
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
    sourceCandidates: [],
    excludedContent: [], unresolvedItems: [], decisionIds: [],
  };
}
