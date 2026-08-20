import type { CrawlPlan, CrawlPlanSource, SourcePreparation } from "@domain-analysis/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createSourceExecutionModule,
  type CrawlPlanningModule,
  type SourceDatasetModule,
  type SourceProvider,
} from "../src";

describe("来源执行准备", () => {
  it("只检查已确认计划的运行环境，不创建 Source Run", async () => {
    const source = {
      key: "jd.refrigerator",
      provider: { key: "jd.catalog-product", version: "1.0.0" },
      executionBlockers: [],
      targets: [{ providerConfiguration: [{ key: "operation", value: "catalog" }] }],
    } as unknown as CrawlPlanSource;
    const plan = {
      id: "plan-1", taskId: "task-1", taskRevision: 2, version: 3, status: "confirmed",
      content: { executionChecklistVersion: 2, sources: [source] },
    } as unknown as CrawlPlan;
    const planning = {
      get: vi.fn(async () => ({ taskId: "task-1", taskRevision: 2, runs: [], plans: [plan] })),
    } as unknown as CrawlPlanningModule;
    const startRun = vi.fn();
    const datasets = { startRun } as unknown as SourceDatasetModule;
    const expected: SourcePreparation = { status: "action_required", action: "login_required",
      sourceKey: source.key, message: "请扫码登录" };
    const provider = {
      key: "jd.catalog-product", version: "1.0.0", validate: vi.fn(),
      prepare: vi.fn(async () => expected), preflight: vi.fn(async () => undefined),
      collect: async function* () { return; },
    } satisfies SourceProvider;
    const execution = createSourceExecutionModule(planning, datasets,
      new Map([[provider.key, provider]]));

    await expect(execution.prepare({ taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 2, expectedPlanVersion: 3 })).resolves.toEqual(expected);
    expect(provider.prepare).toHaveBeenCalledOnce();
    expect(startRun).not.toHaveBeenCalled();
  });
});
