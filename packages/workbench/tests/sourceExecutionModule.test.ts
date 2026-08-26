import type {
  CrawlPlan,
  CrawlPlanSource,
  SourceCollectionRun,
  SourcePreparation,
} from "@domain-analysis/shared";
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
      key: "brand.official",
      provider: { key: "public.web-resource", version: "1.0.0" },
      executionBlockers: [],
      targets: [{ providerConfiguration: [{ key: "operation", value: "catalog" }] }],
    } as unknown as CrawlPlanSource;
    const plan = {
      id: "plan-1", taskId: "task-1", taskRevision: 2, version: 3, status: "confirmed",
      content: { executionChecklistVersion: 3, sources: [source] },
    } as unknown as CrawlPlan;
    const planning = {
      get: vi.fn(async () => ({ taskId: "task-1", taskRevision: 2, runs: [], plans: [plan] })),
      requireExecutablePlan: vi.fn(async () => plan),
    } as unknown as CrawlPlanningModule;
    const startRun = vi.fn();
    const datasets = { startRun } as unknown as SourceDatasetModule;
    const expected: SourcePreparation = { status: "action_required", action: "login_required",
      sourceKey: source.key, message: "请扫码登录" };
    const provider = {
      key: "public.web-resource", version: "1.0.0", validate: vi.fn(),
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

  it("一个 Provider 预检受限时记录失败并继续执行其他 Provider", async () => {
    const restrictedSource = executableSource("restricted", "restricted.public-source");
    const publicSource = executableSource("public", "public.web-resource");
    const plan = {
      id: "plan-1", taskId: "task-1", taskRevision: 2, version: 3, status: "confirmed",
      content: { executionChecklistVersion: 3, sources: [restrictedSource, publicSource] },
    } as unknown as CrawlPlan;
    const planning = {
      get: vi.fn(async () => ({ taskId: "task-1", taskRevision: 2, runs: [], plans: [plan] })),
      requireExecutablePlan: vi.fn(async () => plan),
    } as unknown as CrawlPlanningModule;
    const runs = new Map<string, SourceCollectionRun>();
    const startRun = vi.fn(async (input: Parameters<SourceDatasetModule["startRun"]>[0]) => {
      const run = {
        id: `run-${input.sourceKey}`, taskId: input.taskId, sourceCollectionPlanId: input.planId,
        sourceCollectionPlanSourceKey: input.sourceKey, sourceCollectionPlanVersion: input.planVersion,
        providerKey: input.providerKey, providerVersion: input.providerVersion, accessPolicy: input.accessPolicy,
        status: "running", snapshotCount: 0, accessibleCount: 0, failedCount: 0, assetCount: 0,
        startedAt: "2026-08-21T00:00:00.000Z",
      } satisfies SourceCollectionRun;
      runs.set(run.id, run);
      return run;
    });
    const finishRun = vi.fn(async (input: Parameters<SourceDatasetModule["finishRun"]>[0]) => {
      const run = runs.get(input.runId)!;
      const finished = { ...run, status: input.status, terminationReason: input.terminationReason,
        finishedAt: "2026-08-21T00:00:01.000Z" } satisfies SourceCollectionRun;
      runs.set(run.id, finished);
      return finished;
    });
    const startBatch = vi.fn(async () => ({ id: "batch-1", taskId: "task-1",
      sourceCollectionPlanId: "plan-1", sourceCollectionPlanVersion: 3, taskRevision: 2,
      status: "running" as const, plannedSourceCount: 2, startedAt: "2026-08-21T00:00:00.000Z" }));
    const finishBatch = vi.fn(async (input: { status: "completed" | "partial" | "failed" | "stopped" }) => ({
      id: "batch-1", taskId: "task-1", sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanVersion: 3, taskRevision: 2, status: input.status,
      plannedSourceCount: 2, startedAt: "2026-08-21T00:00:00.000Z",
      finishedAt: "2026-08-21T00:00:02.000Z",
    }));
    const datasets = {
      startBatch,
      finishBatch,
      startRun,
      startTarget: vi.fn(),
      commitSnapshot: vi.fn(),
      finishTarget: vi.fn(async () => ({})),
      finishRun,
      getRun: vi.fn(),
      acquireBatchLease: vi.fn(async () => ({ release: async () => undefined })),
      acquireRunLease: vi.fn(async () => ({ release: async () => undefined })),
    } as unknown as SourceDatasetModule;
    const restrictedCollect = vi.fn();
    const publicCollect = vi.fn();
    const restrictedProvider = provider("restricted.public-source",
      async () => { throw new Error("access_denied"); }, restrictedCollect);
    const publicProvider = { ...provider("public.web-resource", async () => undefined, publicCollect),
      collect: async function* () {
        publicCollect();
        yield { type: "target.completed" as const, targetKey: "public-target" };
      } } satisfies SourceProvider;
    const execution = createSourceExecutionModule(planning, datasets,
      new Map([[restrictedProvider.key, restrictedProvider], [publicProvider.key, publicProvider]]));

    const events = [];
    for await (const event of execution.start({ taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 2, expectedPlanVersion: 3 })) events.push(event);

    expect(startBatch).toHaveBeenCalledOnce();
    expect(startBatch).toHaveBeenCalledWith({ taskId: "task-1", planId: "plan-1", planVersion: 3,
      taskRevision: 2, plannedSourceCount: 2 });
    expect(startRun.mock.calls.map(([input]) => input.sourceKey)).toEqual(["restricted", "public"]);
    expect(startRun.mock.calls.every(([input]) => input.batchId === "batch-1")).toBe(true);
    expect(finishBatch).toHaveBeenCalledWith({ batchId: "batch-1", status: "partial",
      terminationReason: "1/2 个来源完成，1 个来源失败" });
    expect(events[0]).toMatchObject({ type: "batch.started", batch: { id: "batch-1" } });
    expect(events.at(-1)).toMatchObject({ type: "batch.partial", batch: { id: "batch-1" } });
    expect(startRun.mock.calls.map(([input]) => input.accessPolicy)).toEqual([
      expect.objectContaining({ batchSize: 1, batchCooldownMs: 60_000 }),
      expect.objectContaining({ batchSize: 1, batchCooldownMs: 60_000 }),
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: "run.failed",
      run: expect.objectContaining({ sourceCollectionPlanSourceKey: "restricted",
        terminationReason: expect.stringContaining("access_denied") }) }));
    expect(restrictedCollect).not.toHaveBeenCalled();
    expect(publicCollect).toHaveBeenCalledOnce();
  });

  it("规划模块判定旧计划不可执行时不创建批次、不预检也不访问 Provider", async () => {
    const oldPlan = { id: "plan-old", taskId: "task-1", taskRevision: 2, version: 1,
      status: "confirmed", content: { executionChecklistVersion: 2,
        sources: [executableSource("brand", "public.web-resource")] } } as unknown as CrawlPlan;
    const planning = {
      get: vi.fn(async () => ({ taskId: "task-1", taskRevision: 2, runs: [], plans: [oldPlan] })),
      requireExecutablePlan: vi.fn(async () => { throw new Error("历史计划缺少 version 3 Research Audit"); }),
    } as unknown as CrawlPlanningModule;
    const datasets = { startBatch: vi.fn(), startRun: vi.fn() } as unknown as SourceDatasetModule;
    const provider = { key: "public.web-resource", version: "1.0.0", validate: vi.fn(),
      preflight: vi.fn(), collect: vi.fn() } as unknown as SourceProvider;
    const execution = createSourceExecutionModule(planning, datasets, new Map([[provider.key, provider]]));

    const consume = async () => {
      for await (const _event of execution.start({ taskId: "task-1", planId: "plan-old",
        expectedTaskRevision: 2, expectedPlanVersion: 1 })) { /* consume */ }
    };

    await expect(consume()).rejects.toThrow("缺少 version 3 Research Audit");
    expect(datasets.startBatch).not.toHaveBeenCalled();
    expect(provider.preflight).not.toHaveBeenCalled();
  });

  it("只从负责人指定的已停止运行继续，并把前序队列根传给 Provider", async () => {
    const source = executableSource("brand", "public.web-resource");
    const plan = { id: "plan-1", taskId: "task-1", taskRevision: 2, version: 3,
      status: "confirmed", content: { executionChecklistVersion: 3, sources: [source] } } as unknown as CrawlPlan;
    const planning = { get: vi.fn(async () => ({ taskId: "task-1", taskRevision: 2,
      runs: [], plans: [plan] })), requireExecutablePlan: vi.fn(async () => plan) } as unknown as CrawlPlanningModule;
    const previous = { id: "run-old", taskId: "task-1", executionBatchId: "batch-1",
      sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanSourceKey: "brand", sourceCollectionPlanVersion: 3,
      providerKey: "public.web-resource", providerVersion: "1.0.0", requestBudget: 1,
      accessPolicy: { kind: "paced_http", version: "test", maxRequestsPerMinute: 1,
        minimumIntervalMs: 1, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 1_000 }, status: "stopped",
      snapshotCount: 1, accessibleCount: 1, failedCount: 0, assetCount: 0,
      startedAt: "2026-08-21T00:00:00.000Z", finishedAt: "2026-08-21T00:00:01.000Z",
      terminationReason: "operator_cancelled" } satisfies SourceCollectionRun;
    const startRun = vi.fn(async (input: Parameters<SourceDatasetModule["startRun"]>[0]) => ({
      ...previous, id: "run-resumed", resumedFromRunId: input.resumedFromRunId,
      status: "running" as const, snapshotCount: 0, accessibleCount: 0, finishedAt: undefined,
      terminationReason: undefined,
    }));
    const finishRun = vi.fn(async () => ({ ...previous, id: "run-resumed",
      resumedFromRunId: previous.id, status: "completed" as const,
      finishedAt: "2026-08-21T00:00:02.000Z", terminationReason: "plan_scope_completed" }));
    const datasets = { getRun: vi.fn(async (runId: string) => runId === previous.id
      ? { run: previous, targets: [], workItems: [], requestAttempts: [], accessGates: [], records: [] } : null),
      startRun, startTarget: vi.fn(async () => ({})), finishTarget: vi.fn(async () => ({})),
      finishRun, prepareRunForResume: vi.fn(async () => previous),
      acquireRunLease: vi.fn(async () => ({ release: async () => undefined })) } as unknown as SourceDatasetModule;
    const contexts: unknown[] = [];
    const provider = { key: "public.web-resource", version: "1.0.0", validate: vi.fn(),
      preflight: vi.fn(async () => undefined),
      collect: async function* (...args: Parameters<SourceProvider["collect"]>) {
        contexts.push(args[4]);
        yield { type: "target.completed" as const, targetKey: "brand-target" };
      } } satisfies SourceProvider;
    const execution = createSourceExecutionModule(planning, datasets, new Map([[provider.key, provider]]));

    const events = [];
    for await (const event of execution.resume({ taskId: "task-1", runId: previous.id,
      expectedTaskRevision: 2, expectedPlanVersion: 3 })) events.push(event);

    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ resumedFromRunId: previous.id,
      batchId: previous.executionBatchId }));
    expect(contexts).toEqual([{ resumedFromRunId: previous.id, queueRunId: previous.id,
      accessPolicy: expect.objectContaining({ kind: "paced_http", version: "test",
        batchSize: 1, batchCooldownMs: 60_000 }) }]);
    expect(events.at(-1)).toMatchObject({ type: "run.completed",
      run: { id: "run-resumed", resumedFromRunId: previous.id } });
  });
});

function executableSource(key: string, providerKey: string) {
  return {
    key, name: key, provider: { key: providerKey,
      version: "1.0.0" }, executionBlockers: [],
    targets: [{ key: `${key}-target`, quantity: { mode: "all_available" },
      providerConfiguration: [{ key: "operation", value: "exact" }] }],
    accessPolicy: { kind: "paced_http", version: "test", maxRequestsPerMinute: 1,
      minimumIntervalMs: 1, maximumRunMs: 1_000 },
    stopPolicy: { requestBudget: 1, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
  } as unknown as CrawlPlanSource;
}

function provider(key: string, preflight: () => Promise<void>, collectCalled: ReturnType<typeof vi.fn>) {
  return {
    key, version: "1.0.0", validate: vi.fn(), preflight,
    collect: async function* () { collectCalled(); },
  } satisfies SourceProvider;
}
