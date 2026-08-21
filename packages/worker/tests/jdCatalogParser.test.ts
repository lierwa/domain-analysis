import { describe, expect, it } from "vitest";

import {
  parseJdCatalogHtml,
  parseJdCatalogImageReferences,
} from "../src/jdCatalogParser";

describe("JD v2 纯解析", () => {
  it("目录按 SKU 去重并保留首次观察到的详情 URL", () => {
    const html = `<main>
      <a href="https://item.jd.com/1001.html">一号</a>
      <a href="//item.jd.com/1002.html?utm=x">二号</a>
      <a href="https://item.jd.com/1001.html#repeat">重复一号</a>
      <a href="https://example.com/not-product">无关</a>
    </main>`;

    expect(parseJdCatalogHtml(html, "https://www.jd.com/category")).toEqual([
      { externalKey: "1001", detailUrl: "https://item.jd.com/1001.html" },
      { externalKey: "1002", detailUrl: "https://item.jd.com/1002.html?utm=x" },
    ]);
  });

  it("从真实目录商品卡保留主图和缩略图 URL，不下载图片", () => {
    const html = `<div id="J_goodsList"><ul>
      <li class="gl-item" data-sku="1001">
        <div class="p-img"><a href="//item.jd.com/1001.html">
          <img src="//img14.360buyimg.com/n7/jfs/main.jpg">
        </a></div>
        <div class="p-scroll"><span><img data-lazy-img="//img14.360buyimg.com/n9/jfs/thumb.jpg"></span></div>
      </li>
      <li class="gl-item"><div class="p-img"><img src="//img.invalid/no-sku.jpg"></div></li>
    </ul></div>`;

    expect(parseJdCatalogImageReferences(html, "https://www.jd.com/catalog")).toEqual([
      { kind: "image", role: "primary", section: "product:1001", ordinal: 0,
        sourceUrl: "https://img14.360buyimg.com/n7/jfs/main.jpg",
        observedValue: "//img14.360buyimg.com/n7/jfs/main.jpg",
        locator: '#J_goodsList li[data-sku="1001"] .p-img img:nth-of-type(1)@src' },
      { kind: "image", role: "primary", section: "product:1001", ordinal: 1,
        sourceUrl: "https://img14.360buyimg.com/n9/jfs/thumb.jpg",
        observedValue: "//img14.360buyimg.com/n9/jfs/thumb.jpg",
        locator: '#J_goodsList li[data-sku="1001"] .p-scroll img:nth-of-type(1)@data-lazy-img' },
    ]);
  });
});
