import type {
  CrawlPlan,
  CrawlPlanSource,
  SourceCollectionRun,
  SourcePreparation,
} from "@domain-analysis/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createSourceExecutionModule,
  type CrawlPlanExecutionReader,
  type SourceDatasetModule,
  type SourceProvider,
} from "../src";

describe("来源执行准备", () => {
  it("Graphile 重放同一 Start command 时不创建第二个批次或重复来源访问", async () => {
    const planning = { requireExecutablePlan: vi.fn() } as unknown as CrawlPlanExecutionReader;
    const datasets = { getBatchByCommandId: vi.fn(async () => ({ id: "batch-existing" }))
      } as unknown as SourceDatasetModule;
    const collect = vi.fn();
    const existingProvider = provider("public.web-resource", async () => undefined, collect);
    const execution = createSourceExecutionModule(planning, datasets,
      new Map([[existingProvider.key, existingProvider]]));

    const events = [];
    for await (const event of execution.start({ taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 1, expectedPlanVersion: 1, commandId: "source-command-1" })) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(planning.requireExecutablePlan).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
  });

  it("Graphile 重放同一 Resume command 时不创建第二个来源运行", async () => {
    const existingRun = { id: "run-existing", status: "completed" as const } as SourceCollectionRun;
    const getRunByExecutionCommandId = vi.fn(async () => existingRun);
    const planning = { requireExecutablePlan: vi.fn() } as unknown as CrawlPlanExecutionReader;
    const datasets = { getRunByExecutionCommandId } as unknown as SourceDatasetModule;
    const execution = createSourceExecutionModule(planning, datasets, new Map());

    const events = [];
    for await (const event of execution.resume({ taskId: "task-1", runId: "run-old",
      expectedTaskRevision: 1, expectedPlanVersion: 1, commandId: "source-command-resume-1" })) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(planning.requireExecutablePlan).not.toHaveBeenCalled();
  });

  it("批次环境预检失败时 Start 前返回错误且不创建 Batch 或 Run", async () => {
    const source = executableSource("brand", "public.web-resource");
    const plan = { id: "plan-1", taskId: "task-1", taskRevision: 2, version: 3,
      status: "confirmed", content: { executionChecklistVersion: 3, sources: [source] } } as unknown as CrawlPlan;
    const planning = { requireExecutablePlan: vi.fn(async () => plan) } as unknown as CrawlPlanExecutionReader;
    const startBatch = vi.fn(async () => { throw new Error("不应创建批次"); });
    const startRun = vi.fn();
    const datasets = { startBatch, startRun } as unknown as SourceDatasetModule;
    const environmentPreflight = vi.fn(async () => {
      throw new Error("检测到 Fake-IP DNS，但没有配置受信任 HTTPS 代理");
    });
    const publicProvider = {
      ...provider("public.web-resource", async () => undefined, vi.fn()),
      preflightEnvironment: environmentPreflight,
    } as unknown as SourceProvider;
    const execution = createSourceExecutionModule(planning, datasets,
      new Map([[publicProvider.key, publicProvider]]));
    const input = { taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 2, expectedPlanVersion: 3 };

    await expect(execution.prepare(input)).rejects.toThrow("没有配置受信任 HTTPS 代理");
    const consumeStart = async () => {
      for await (const _event of execution.start(input)) { /* consume */ }
    };
    await expect(consumeStart()).rejects.toThrow("没有配置受信任 HTTPS 代理");

    expect(environmentPreflight).toHaveBeenCalledTimes(2);
    expect(startBatch).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

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
    } as unknown as CrawlPlanExecutionReader;
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
    } as unknown as CrawlPlanExecutionReader;
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
        failureCategory: input.failureCategory,
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
        terminationReason: expect.stringContaining("access_denied"),
        failureCategory: "source_restricted" }) }));
    expect(finishRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-restricted", status: "failed", failureCategory: "source_restricted",
    }));
    expect(restrictedCollect).not.toHaveBeenCalled();
    expect(publicCollect).toHaveBeenCalledOnce();
  });

  it("单个资源不存在且实际覆盖低于最大目标时仍完成来源运行", async () => {
    const source = executableSource("brand", "public.web-resource");
    source.targets[0]!.quantity = { mode: "target_count", targetCount: 1, unit: "份",
      denominator: "计划内最多一份", rationale: "来源不足时保留实际结果" };
    const plan = { id: "plan-1", taskId: "task-1", taskRevision: 2, version: 3,
      status: "confirmed", content: { executionChecklistVersion: 3, sources: [source] } } as unknown as CrawlPlan;
    const planning = { requireExecutablePlan: vi.fn(async () => plan) } as unknown as CrawlPlanExecutionReader;
    const startedRun = { id: "run-1", taskId: "task-1", sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanSourceKey: "brand", sourceCollectionPlanVersion: 3,
      providerKey: "public.web-resource", providerVersion: "1.0.0", requestBudget: 1,
      accessPolicy: { kind: "paced_http" as const, version: "test", maxRequestsPerMinute: 1,
        minimumIntervalMs: 1, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 1_000 }, status: "running" as const,
      snapshotCount: 0, accessibleCount: 0, failedCount: 0, assetCount: 0,
      startedAt: "2026-08-21T00:00:00.000Z" };
    const batch = { id: "batch-1", taskId: "task-1", sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanVersion: 3, taskRevision: 2, status: "running" as const,
      plannedSourceCount: 1, startedAt: "2026-08-21T00:00:00.000Z" };
    const finishTarget = vi.fn(async () => ({}));
    const finishRun = vi.fn(async (input: Parameters<SourceDatasetModule["finishRun"]>[0]) => ({
      ...startedRun, status: input.status, terminationReason: input.terminationReason,
      failureCategory: input.failureCategory, finishedAt: "2026-08-21T00:00:01.000Z",
    }));
    const datasets = { getBatchByCommandId: vi.fn(async () => null),
      startBatch: vi.fn(async () => batch), finishBatch: vi.fn(async (input) => ({ ...batch,
        status: input.status, terminationReason: input.terminationReason,
        finishedAt: "2026-08-21T00:00:02.000Z" })), startRun: vi.fn(async () => startedRun),
      startTarget: vi.fn(async () => ({})), finishTarget, finishRun,
      commitSnapshot: vi.fn(async () => ({ ...startedRun, snapshotCount: 1, failedCount: 1 })),
      getRun: vi.fn(async () => null),
      acquireBatchLease: vi.fn(async () => ({ release: async () => undefined })),
      acquireRunLease: vi.fn(async () => ({ release: async () => undefined })),
    } as unknown as SourceDatasetModule;
    const sourceProvider = { key: "public.web-resource", version: "1.0.0", validate: vi.fn(),
      preflight: vi.fn(async () => undefined), collect: async function* () {
        yield { type: "capture" as const, targetKey: "brand-target", snapshot: {
          idempotencyKey: "missing-resource", object: { sourceIdentity: "fixture",
            kind: "web_resource", externalKey: "https://example.com/missing" },
          observation: { requestedUrl: "https://example.com/missing",
            observedAt: "2026-08-21T00:00:00.000Z", state: "not_found" as const,
            responseHeaders: {}, error: "资源不存在" },
        } };
        yield { type: "target.completed" as const, targetKey: "brand-target", observedUnitCount: 0 };
      } } satisfies SourceProvider;
    const execution = createSourceExecutionModule(planning, datasets,
      new Map([[sourceProvider.key, sourceProvider]]));

    const events = [];
    for await (const event of execution.start({ taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 2, expectedPlanVersion: 3 })) events.push(event);

    expect(finishTarget).toHaveBeenCalledWith(expect.objectContaining({ status: "completed",
      observedUnitCount: 0 }));
    expect(finishRun).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(events.some((event) => event.type === "run.failed")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "batch.completed" });
  });

  it("规划模块判定旧计划不可执行时不创建批次、不预检也不访问 Provider", async () => {
    const oldPlan = { id: "plan-old", taskId: "task-1", taskRevision: 2, version: 1,
      status: "confirmed", content: { executionChecklistVersion: 2,
        sources: [executableSource("brand", "public.web-resource")] } } as unknown as CrawlPlan;
    const planning = {
      get: vi.fn(async () => ({ taskId: "task-1", taskRevision: 2, runs: [], plans: [oldPlan] })),
      requireExecutablePlan: vi.fn(async () => { throw new Error("历史计划缺少 version 3 Research Audit"); }),
    } as unknown as CrawlPlanExecutionReader;
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
      runs: [], plans: [plan] })), requireExecutablePlan: vi.fn(async () => plan) } as unknown as CrawlPlanExecutionReader;
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
    const batch = { id: "batch-1", taskId: "task-1", sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanVersion: 3, taskRevision: 2, status: "running" as const,
      recoveryState: "running" as const, plannedSourceCount: 1,
      startedAt: "2026-08-21T00:00:00.000Z" };
    const reopenBatch = vi.fn(async () => batch);
    const finishBatch = vi.fn(async () => ({ ...batch, status: "completed" as const,
      finishedAt: "2026-08-21T00:00:03.000Z", terminationReason: "1/1 个来源完成" }));
    const datasets = { getRunByExecutionCommandId: vi.fn(async () => null),
      getRun: vi.fn(async (runId: string) => runId === previous.id
      ? { run: previous, targets: [], workItems: [], requestAttempts: [], accessGates: [], records: [] } : null),
      startRun, startTarget: vi.fn(async () => ({})), finishTarget: vi.fn(async () => ({})),
      finishRun, prepareRunForResume: vi.fn(async () => previous),
      listCompletedCaptureWorkKeys: vi.fn(async () => ["model:haier:done"]),
      reopenBatch, getBatch: vi.fn(async () => batch), finishBatch,
      setBatchRecoveryState: vi.fn(async () => ({ ...batch, recoveryState: "completed" as const })),
      listBatchRuns: vi.fn(async () => [{ ...previous, id: "run-resumed", status: "completed" as const,
        resumedFromRunId: previous.id }]),
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
      expectedTaskRevision: 2, expectedPlanVersion: 3,
      commandId: "source-command-resume" })) events.push(event);

    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ resumedFromRunId: previous.id,
      batchId: previous.executionBatchId, executionCommandId: "source-command-resume" }));
    expect(contexts).toEqual([{ resumedFromRunId: previous.id, queueRunId: previous.id,
      completedWorkKeys: ["model:haier:done"],
      accessPolicy: expect.objectContaining({ kind: "paced_http", version: "test",
        batchSize: 1, batchCooldownMs: 60_000 }) }]);
    expect(events.at(-1)).toMatchObject({ type: "run.completed",
      run: { id: "run-resumed", resumedFromRunId: previous.id } });
    expect(reopenBatch).toHaveBeenCalledWith("batch-1");
    expect(finishBatch).toHaveBeenCalledWith({ batchId: "batch-1", status: "completed",
      terminationReason: "1/1 个来源完成" });
  });

  it("瞬时传输失败会生成有界自动 Resume 请求并标记批次待恢复", async () => {
    const failedRun = {
      id: "run-failed", taskId: "task-1", executionBatchId: "batch-1",
      sourceCollectionPlanId: "plan-1", sourceCollectionPlanSourceKey: "brand",
      sourceCollectionPlanVersion: 3, providerKey: "public.web-resource", providerVersion: "1.0.0",
      requestBudget: 10, accessPolicy: {} as never, status: "failed" as const,
      snapshotCount: 2, accessibleCount: 2, failedCount: 1, assetCount: 0,
      startedAt: "2026-08-21T00:00:00.000Z", finishedAt: "2026-08-21T00:00:01.000Z",
      terminationReason: "可信 DoH 查询失败：DNS status 2",
      failureCategory: "transient_transport" as const,
    } satisfies SourceCollectionRun;
    const batch = { id: "batch-1", taskId: "task-1", sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanVersion: 3, taskRevision: 2, status: "partial" as const,
      recoveryState: "completed" as const, plannedSourceCount: 1,
      startedAt: "2026-08-21T00:00:00.000Z", finishedAt: "2026-08-21T00:00:01.000Z" };
    const setBatchRecoveryState = vi.fn(async () => ({ ...batch, recoveryState: "pending" as const }));
    const datasets = {
      getBatch: vi.fn(async () => batch),
      listBatchRuns: vi.fn(async () => [failedRun]),
      setBatchRecoveryState,
    } as unknown as SourceDatasetModule;
    const planning = { requireExecutablePlan: vi.fn(async () => ({})) } as unknown as CrawlPlanExecutionReader;
    const execution = createSourceExecutionModule(planning, datasets, new Map());

    const [request] = await execution.automaticResumeRequests({ batchId: "batch-1" });

    expect(request).toMatchObject({ batchId: "batch-1", taskId: "task-1", runId: "run-failed",
      expectedTaskRevision: 2, expectedPlanVersion: 3 });
    expect(request?.runAt).toBeInstanceOf(Date);
    expect(setBatchRecoveryState).toHaveBeenCalledWith("batch-1", "pending");
  });

  it("历史计划不可执行时不生成自动 Resume", async () => {
    const batch = { id: "batch-old", taskId: "task-1", sourceCollectionPlanId: "plan-old",
      sourceCollectionPlanVersion: 1, taskRevision: 2, status: "partial" as const,
      recoveryState: "completed" as const, plannedSourceCount: 1,
      startedAt: "2026-08-21T00:00:00.000Z", finishedAt: "2026-08-21T00:00:01.000Z" };
    const failedRun = { id: "run-old", taskId: "task-1", executionBatchId: batch.id,
      sourceCollectionPlanId: batch.sourceCollectionPlanId, sourceCollectionPlanVersion: 1,
      sourceCollectionPlanSourceKey: "brand", providerKey: "public.web-resource",
      providerVersion: "1.0.0", requestBudget: 10, accessPolicy: {} as never,
      status: "failed" as const, snapshotCount: 1, accessibleCount: 1, failedCount: 1,
      assetCount: 0, startedAt: batch.startedAt, finishedAt: batch.finishedAt,
      terminationReason: "可信 DoH 查询失败：DNS status 2",
      failureCategory: "transient_transport" as const } satisfies SourceCollectionRun;
    const requireExecutablePlan = vi.fn(async () => {
      throw new Error("已确认计划使用旧规划协议，请重新运行 Planning Run");
    });
    const setBatchRecoveryState = vi.fn();
    const datasets = { getBatch: vi.fn(async () => batch),
      listBatchRuns: vi.fn(async () => [failedRun]), setBatchRecoveryState } as unknown as SourceDatasetModule;
    const execution = createSourceExecutionModule({ requireExecutablePlan }, datasets, new Map());

    await expect(execution.automaticResumeRequests({ batchId: batch.id })).resolves.toEqual([]);
    expect(requireExecutablePlan).toHaveBeenCalledOnce();
    expect(setBatchRecoveryState).not.toHaveBeenCalled();
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
