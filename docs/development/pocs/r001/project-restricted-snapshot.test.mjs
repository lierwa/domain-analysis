import assert from "node:assert/strict";
import test from "node:test";

import * as cheerio from "cheerio";

import { assertRestrictedValuesExcluded } from "./project-restricted-snapshot.mjs";

test("商品投影不包含受限容器内容时通过", () => {
  const doc = cheerio.load(`
    <div class="logistics-address">测试专属地区</div>
    <div class="sku-title-name">测试商品</div>
  `);

  assert.doesNotThrow(() =>
    assertRestrictedValuesExcluded(doc, JSON.stringify({ title: "测试商品" })),
  );
});

test("商品投影泄漏受限容器内容时失败关闭", () => {
  const doc = cheerio.load(`
    <div class="logistics-address">测试专属地区</div>
  `);

  assert.throws(
    () =>
      assertRestrictedValuesExcluded(doc, JSON.stringify({ title: "测试专属地区" })),
    /\.logistics-address/,
  );
});
