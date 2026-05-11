import { describe, expect, it } from "vitest";
import { determineCollectionCompletion, determineTaskTargetCount } from "./analysisRunService";

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
});
