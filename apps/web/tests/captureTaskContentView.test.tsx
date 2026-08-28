import { captureTaskContentSchema } from "@domain-analysis/shared";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CaptureTaskContentView } from "../src/pages/CaptureTaskContentView";

describe("抓取任务内容投影", () => {
  it("只展示当前任务范围、内容方向和通用来源候选", () => {
    const content = captureTaskContentSchema.parse({
      originalRequest: "抓取电视资料",
      category: { code: "television", label: "电视" },
      marketScope: "中国大陆零售市场",
      generalTopics: ["品牌与型号"],
      categoryTopics: [],
      sourceCandidates: [{
        id: "market-catalog", name: "公开电视市场目录", publisher: "市场目录出版方",
        entryUrl: "https://catalog.example.com/television", sourceKind: "retailer",
        expectedContents: ["品牌、型号和公开商品目录"], observedFormats: ["网页"], accessState: "public",
        observedAt: "2026-08-21T08:48:01.702Z",
      }],
      excludedContent: [],
      unresolvedItems: [],
      decisionIds: [],
    });

    const html = renderToString(<CaptureTaskContentView content={content} />);

    expect(html).toContain("中国大陆零售市场");
    expect(html).toContain("品牌与型号");
    expect(html).toContain("公开电视市场目录");
    expect(html).toContain("候选来源（1）");
  });
});
