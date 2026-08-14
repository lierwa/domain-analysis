import assert from "node:assert/strict";
import test from "node:test";

import { compareVariantFields, summarizeMarketplaceProjection } from "./extract-deterministic.mjs";

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

test("脱敏京东投影按强型号键隔离并保留下架缺失状态", () => {
  const input = {
    id: "I06",
    sourceObjectId: "jd:100044587428",
    modelKey: "HAIER:BCD-505WGHTD14S8U1",
    brand: "海尔",
    model: "BCD-505WGHTD14S8U1",
  };
  const projection = {
    state: "discontinued",
    sourceSnapshot: { htmlSha256: "a".repeat(64) },
    attributes: [
      { name: "品牌", value: "海尔（Haier）" },
      { name: "能效网规格型号", value: "BCD-505WGHTD14S8U1" },
    ],
  };
  assert.deepEqual(summarizeMarketplaceProjection(input, projection), {
    sourceObjectId: "jd:100044587428",
    modelKey: "HAIER:BCD-505WGHTD14S8U1",
    state: "discontinued",
    sourceSnapshotSha256: "a".repeat(64),
    attributeCount: 2,
    missingFields: ["description"],
    relationToPrimary: "separate_subject",
  });
});
