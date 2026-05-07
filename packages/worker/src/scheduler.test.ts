import { describe, expect, it, vi } from "vitest";
import { runSchedulerTick } from "./scheduler";

describe("runSchedulerTick", () => {
  it("creates and starts one scheduled run per due plan", async () => {
    const createScheduledRun = vi.fn(async (planId: string) => ({ id: `run_${planId}` }));
    const startRun = vi.fn(async () => undefined);
    const listDuePlans = vi.fn(async () => [{ id: "plan_1" }, { id: "plan_2" }]);

    const result = await runSchedulerTick({
      listDuePlans,
      createScheduledRun,
      startRun,
      nowIso: "2026-05-07T00:00:00.000Z",
      limit: 10
    });

    expect(result.createdRuns).toBe(2);
    expect(startRun).toHaveBeenCalledWith("run_plan_1");
    expect(startRun).toHaveBeenCalledWith("run_plan_2");
  });
});
