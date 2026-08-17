import { describe, expect, it } from "vitest";

import {
  createCrawleeDocumentExcerptSource,
  selectDocumentExcerpt,
} from "../src";

describe("DocumentExcerptSource", () => {
  it("只保留同时命中对象和章节线索的原始页文本", () => {
    const page = "型号 MR-457WUSPZE 年综合耗电量 311kW·h/a 外形尺寸 753×600×1910mm";
    const result = selectDocumentExcerpt(
      ["封面 MR-457WUSPZE", page, "其他页面"],
      {
        requiredText: "MR-457WUSPZE",
        requiredSectionTerms: ["年综合耗电量", "外形尺寸"],
        section: "产品参数",
        maximumExcerptBytes: 256 * 1024,
      },
      "d".repeat(64),
    );

    expect(result.content).toBe(page);
    expect(result.locator).toMatchObject({ page: 2, section: "产品参数" });
  });

  it("在网络请求前拒绝未授权的说明书 origin", async () => {
    const source = createCrawleeDocumentExcerptSource({
      allowedOrigins: ["https://www.haier.com"],
    });

    await expect(source.capture({
      requestedUrl: "https://manual.example/midea.pdf",
      requiredText: "MR-457WUSPZE",
      requiredSectionTerms: ["外形尺寸"],
      section: "产品参数",
      maximumSourceBytes: 4 * 1024 * 1024,
      maximumExcerptBytes: 256 * 1024,
    })).rejects.toMatchObject({ code: "origin_not_allowed" });
  });
});
