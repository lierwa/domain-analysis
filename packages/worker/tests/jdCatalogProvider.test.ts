import type { CrawlPlanSource } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import { createJdCatalogProvider } from "../src";

describe("JD catalog Provider contract", () => {
  it("只接受显式 CDP 与品类 include_text，拒绝把自然语言 traversal 当执行配置", () => {
    const provider = createJdCatalogProvider({ endpointUrl: "http://127.0.0.1:9222" });
    const source = jdSource();
    expect(() => provider.validate(source)).not.toThrow();
    expect(() => provider.validate({ ...source, provider: { ...source.provider,
      configuration: source.provider.configuration.filter((item) => item.key !== "include_text") } }))
      .toThrow("include_text");
  });
});

function jdSource(): CrawlPlanSource {
  return {
    key: "jd.refrigerator", name: "京东冰箱", publisher: "京东", sourceKind: "retailer",
    role: "有界目录与详情", entryUrls: ["https://www.jd.com/chanpin/450039.html"],
    provider: { key: "jd.catalog-product", version: "1.0.0", configuration: [
      { key: "mode", value: "cdp" }, { key: "include_text", value: "冰箱" }, { key: "exclude_text", value: "二手|冷柜|冰吧" },
    ] },
    accessPolicy: { kind: "paced_http", version: "jd-low-frequency-v1", maxRequestsPerMinute: 2, minimumIntervalMs: 10_000, maximumRunMs: 180_000 },
    stopPolicy: { requestBudget: 2, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
    rawOutputPolicy: { formats: ["html"], retainAssets: false },
    observationLevel: "search_discovered", accessState: "unknown", observedAt: "2026-08-20T00:00:00.000Z",
    targets: [{ key: "catalog", name: "目录", taskTopics: ["型号"], captureUnit: "HTML", rawFormats: ["html"],
      quantity: { mode: "target_count", targetCount: 1, unit: "页", denominator: "入口", rationale: "有界" },
      uniqueKey: "URL", traversal: "Provider 配置驱动", stopCondition: "1 页" }], executionBlockers: [],
  };
}
