import { describe, expect, it } from "vitest";

import { quoteFromTextSelection } from "../src/pages/SourceDatasetPanel";

describe("SourceDatasetPanel minimal evidence quote", () => {
  it("为正文中的最小片段补齐可复核上下文", () => {
    expect(quoteFromTextSelection(
      "液晶电视通过背光源照亮液晶层，再由彩色滤光片形成图像。",
      "背光源照亮液晶层",
    )).toEqual({
      exact: "背光源照亮液晶层",
      prefix: "液晶电视通过",
      suffix: "，再由彩色滤光片形成图像。",
    });
  });

  it("拒绝不存在的文本和整块文本，避免把整页冒充最小证据", () => {
    expect(quoteFromTextSelection("原始正文", "模型编造内容")).toBeUndefined();
    expect(quoteFromTextSelection("原始正文", "原始正文")).toBeUndefined();
  });
});
