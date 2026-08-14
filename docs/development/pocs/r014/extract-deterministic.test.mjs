import assert from "node:assert/strict";
import test from "node:test";

import { compareVariantFields } from "./extract-deterministic.mjs";

test("同型号变体保留共同、差异和缺失字段", () => {
  const first = {
    evidence: [
      { property: "产品型号", rawValue: "MR-457WUSPZE" },
      { property: "颜色", rawValue: "流苏白" },
      { property: "冷冻室容积（L）", rawValue: "154" },
    ],
  };
  const second = {
    evidence: [
      { property: "产品型号", rawValue: "MR-457WUSPZE" },
      { property: "颜色", rawValue: "苍穹灰" },
    ],
  };
  assert.deepEqual(compareVariantFields(first, second), {
    equalProperties: ["产品型号"],
    differentProperties: ["颜色"],
    onlyInFirst: ["冷冻室容积（L）"],
    onlyInSecond: [],
  });
});
