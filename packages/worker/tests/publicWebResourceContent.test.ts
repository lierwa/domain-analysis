import type { CrawlPlanSource, SourceSnapshotLineage } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import { captureEvent, inaccessible } from "../src/publicWebResourceContent";
import type { RawPublicResponse } from "../src/publicResourceTransport";

describe("公共资源快照幂等身份", () => {
  it("不同网页即使返回相同正文也使用不同幂等键", () => {
    const body = new TextEncoder().encode("同一份站点模板正文");
    const first = captureEvent(source(), "official.catalog", new URL("https://example.com/a"),
      response(body), observedAt, undefined, lineage("page:a"));
    const second = captureEvent(source(), "official.catalog", new URL("https://example.com/b"),
      response(body), observedAt, undefined, lineage("page:b"));

    expect(first.snapshot.idempotencyKey).not.toBe(second.snapshot.idempotencyKey);
  });

  it("同一网页重放时保持幂等键稳定，让内容变化交给 Source Dataset 校验", () => {
    const url = new URL("https://example.com/a");
    const first = captureEvent(source(), "official.catalog", url,
      response(new TextEncoder().encode("第一版正文")), observedAt, undefined, lineage("page:a"));
    const second = captureEvent(source(), "official.catalog", url,
      response(new TextEncoder().encode("第二版正文")), observedAt, undefined, lineage("page:a"));

    expect(first.snapshot.idempotencyKey).toBe(second.snapshot.idempotencyKey);
  });

  it("不同网页的失败观察不会共享幂等键", () => {
    const first = inaccessible("official.catalog", new URL("https://example.com/a"), observedAt,
      "access_denied", "HTTP 403", undefined, lineage("page:a"));
    const second = inaccessible("official.catalog", new URL("https://example.com/b"), observedAt,
      "access_denied", "HTTP 403", undefined, lineage("page:b"));

    expect(first.snapshot.idempotencyKey).not.toBe(second.snapshot.idempotencyKey);
  });
});

const observedAt = new Date("2026-08-27T00:00:00.000Z");

function lineage(workKey: string): SourceSnapshotLineage {
  return { workKey, discoveryKind: "html_link", depth: 1 };
}

function response(body: Uint8Array<ArrayBuffer>): RawPublicResponse {
  return { statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" }, body };
}

function source(): CrawlPlanSource {
  return {
    key: "brand.example", name: "示例品牌官网", publisher: "示例品牌", sourceKind: "brand_official",
    sourceCandidateIds: ["candidate-example"], role: "保存官网原始页面",
    entryUrls: ["https://example.com"],
    provider: { key: "public.web-resource", version: "2.0.0", configuration: [
      { key: "mode", value: "planned_routes" }, { key: "maximum_bytes", value: 100_000 },
      { key: "maximum_pages_per_target", value: 40 },
    ] },
    accessPolicy: { kind: "paced_http", version: "public-v1", maxRequestsPerMinute: 10,
      minimumIntervalMs: 1, maximumRunMs: 10_000 },
    stopPolicy: { requestBudget: 40, noNewUniqueKeysLimit: 40, stopOnAccessRestriction: true },
    rawOutputPolicy: { formats: ["html"], retainAssets: false },
    observationLevel: "search_discovered", accessState: "unknown",
    observedAt: "2026-08-27T00:00:00.000Z",
    targets: [], executionBlockers: [],
  };
}
