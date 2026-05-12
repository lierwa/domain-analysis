import { describe, expect, it } from "vitest";
import {
  deriveBatchStatus,
  determineCollectionCompletion,
  determineCollectionFailureCompletion,
  determineTaskTargetCount
} from "./analysisRunService";

describe("analysis run collection policy", () => {
  it("keeps the user requested limit as the task target", () => {
    expect(determineTaskTargetCount({ runLimit: 200, sourceDefaultLimit: 100 })).toBe(200);
  });

  it("marks duplicate-only collection as no content instead of success", () => {
    const completion = determineCollectionCompletion({
      collectedCount: 12,
      validCount: 0,
      duplicateCount: 12
    });

    expect(completion.taskStatus).toBe("no_content");
    expect(completion.runStatus).toBe("no_content");
    expect(completion.errorMessage).toContain("duplicate");
  });

  it("keeps login-required collection resumable instead of failed", () => {
    const completion = determineCollectionFailureCompletion({
      taskStatus: "login_required",
      message: "X login is required"
    });

    expect(completion.taskStatus).toBe("login_required");
    expect(completion.runStatus).toBe("login_required");
    expect(completion.finishedAt).toBeNull();
    expect(completion.errorMessage).toContain("Complete login");
  });

  it("aggregates all login-required child runs as login required", () => {
    expect(deriveBatchStatus([{ status: "login_required", validCount: 0 }])).toBe("login_required");
  });

  it("keeps a batch partial ready when some content exists and another run needs login", () => {
    expect(deriveBatchStatus([
      { status: "content_ready", validCount: 3 },
      { status: "login_required", validCount: 0 }
    ])).toBe("partial_ready");
  });
});
