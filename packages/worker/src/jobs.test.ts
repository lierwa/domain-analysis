import { describe, expect, it } from "vitest";
import { createExternalCollectorError } from "./collectors/externalCollector";
import { createAdapterForPlatform, mapCollectionErrorToTaskStatus } from "./jobs";

describe("createAdapterForPlatform", () => {
  it("creates the YouTube adapter for youtube crawl jobs", () => {
    const adapter = createAdapterForPlatform("youtube");

    expect(adapter).toHaveProperty("collect");
  });
});

describe("mapCollectionErrorToTaskStatus", () => {
  it("preserves external collector error codes that match task statuses", () => {
    expect(mapCollectionErrorToTaskStatus(createExternalCollectorError("login_required", "expired"))).toBe(
      "login_required"
    );
    expect(mapCollectionErrorToTaskStatus(createExternalCollectorError("rate_limited", "slow down"))).toBe(
      "rate_limited"
    );
    expect(mapCollectionErrorToTaskStatus(createExternalCollectorError("parse_failed", "bad json"))).toBe(
      "parse_failed"
    );
    expect(mapCollectionErrorToTaskStatus(createExternalCollectorError("no_content", "empty"))).toBe("no_content");
  });

  it("falls back to failed for unknown errors", () => {
    expect(mapCollectionErrorToTaskStatus(new Error("boom"))).toBe("failed");
  });
});
