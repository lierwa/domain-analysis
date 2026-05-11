import { describe, expect, it } from "vitest";
import { deriveBatchStatus } from "./analysisBatchService";

describe("analysis batch status aggregation", () => {
  it("marks mixed successful and failed runs as partial ready", () => {
    expect(
      deriveBatchStatus([
        { status: "content_ready", validCount: 120 },
        { status: "collection_failed", validCount: 0 }
      ])
    ).toBe("partial_ready");
  });

  it("marks duplicate-only or empty runs as no content when none are valid", () => {
    expect(
      deriveBatchStatus([
        { status: "no_content", validCount: 0 },
        { status: "no_content", validCount: 0 }
      ])
    ).toBe("no_content");
  });
});
