import { captureTaskContentSchema } from "@domain-analysis/shared";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CaptureTaskContentView } from "../src/pages/CaptureTaskContentView";

describe("抓取任务内容投影", () => {
  it("旧任务纳入京东时明确提示当前正式规划已排除", () => {
    const content = captureTaskContentSchema.parse({
      originalRequest: "抓取电视资料",
      category: { code: "television", label: "电视" },
      marketScope: "中国大陆零售市场",
      generalTopics: ["品牌与型号"],
      categoryTopics: [],
      jd: { applicable: true, disposition: "included", scope: ["product_details"], rationale: "历史确认记录" },
      sourceCandidates: [{
        id: "historical-jd", name: "京东历史候选", publisher: "京东",
        entryUrl: "https://www.jd.com/chanpin/450049.html", sourceKind: "retailer",
        expectedContents: ["历史目录"], observedFormats: ["网页"], accessState: "public",
        observedAt: "2026-08-21T08:48:01.702Z",
      }],
      excludedContent: [],
      unresolvedItems: [],
      decisionIds: [],
    });

    const html = renderToString(<CaptureTaskContentView content={content} />);

    expect(html).toContain("历史确认时的京东意向");
    expect(html).toContain("当前 version 4 正式规划已排除京东");
    expect(html).toContain("不会把该意向转换成新计划来源");
    expect(html).toContain("历史线索（当前规划排除）");
  });
});
