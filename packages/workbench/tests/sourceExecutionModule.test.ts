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
      beginExecution: vi.fn(), endExecution: vi.fn(),
      prepare: vi.fn(async () => expected), preflight: vi.fn(async () => undefined),
      collect: async function* () { return; },
    } satisfies SourceProvider;
    const execution = createSourceExecutionModule(planning, datasets,
      new Map([[provider.key, provider]]));

    await expect(execution.prepare({ taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 2, expectedPlanVersion: 3 })).resolves.toEqual(expected);
    expect(provider.prepare).toHaveBeenCalledOnce();
    expect(provider.beginExecution).toHaveBeenCalledWith({
      executionKey: "task-1:plan-1:v3", sources: [source],
    });
    expect(provider.endExecution).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

  it("一个 Provider 受限后停止其余同 Provider 来源，但继续其他 Provider", async () => {
    const sources = [executionSource("jd.one"), executionSource("jd.two"),
      executionSource("public.one", "public.web-resource")];
    const plan = { id: "plan-1", taskId: "task-1", taskRevision: 2, version: 3, status: "confirmed",
      content: { executionChecklistVersion: 2, sources } } as unknown as CrawlPlan;
    const planning = { get: vi.fn(async () => ({ taskId: "task-1", taskRevision: 2, runs: [], plans: [plan] }))
    } as unknown as CrawlPlanningModule;
    const runs = new Map<string, ReturnType<typeof runningRun>>();
    const startRun = vi.fn(async (input: Parameters<SourceDatasetModule["startRun"]>[0]) => {
      const run = runningRun(input.sourceKey, input.accessPolicy);
      runs.set(run.id, run);
      return run;
    });
    const finishTarget = vi.fn(async (input: Parameters<SourceDatasetModule["finishTarget"]>[0]) => ({
      id: `target-${input.runId}-${input.targetKey}`, runId: input.runId, targetKey: input.targetKey,
      status: input.status, snapshotCount: 0, accessibleCount: 0, failedCount: 0, assetCount: 0,
      finishedAt: "2026-08-21T00:00:01.000Z", terminationReason: input.terminationReason,
    }));
    const finishRun = vi.fn(async (input: Parameters<SourceDatasetModule["finishRun"]>[0]) => ({
      ...runs.get(input.runId)!, status: input.status, finishedAt: "2026-08-21T00:00:01.000Z",
      terminationReason: input.terminationReason,
    }));
    const datasets = { startRun, startTarget: vi.fn(), finishTarget, finishRun,
      commitSnapshot: vi.fn(async (input) => ({ run: { ...runs.get(input.runId)!, snapshotCount: 1,
        failedCount: 1 }, targets: [], records: [] })),
    } as unknown as SourceDatasetModule;
    const provider = { key: "jd.catalog-product", version: "1.0.0", validate: vi.fn(),
      beginExecution: vi.fn(), endExecution: vi.fn(), preflight: vi.fn(),
      collect: vi.fn(async function* (source: CrawlPlanSource) {
        yield { type: "capture" as const, targetKey: source.targets[0]!.key, assets: [], snapshot: {
          idempotencyKey: `${source.key}-limited`, object: { sourceIdentity: "jd", kind: "catalog",
            externalKey: source.key }, observation: { requestedUrl: source.entryUrls[0]!,
            observedAt: "2026-08-21T00:00:00.000Z", state: "rate_limited" as const,
            responseHeaders: {} },
        } };
      }),
    } satisfies SourceProvider;
    const publicProvider = { key: "public.web-resource", version: "1.0.0", validate: vi.fn(),
      beginExecution: vi.fn(), endExecution: vi.fn(), preflight: vi.fn(),
      collect: vi.fn(async function* () { return; }),
    } satisfies SourceProvider;
    const execution = createSourceExecutionModule(planning, datasets, new Map<string, SourceProvider>([
      [provider.key, provider], [publicProvider.key, publicProvider],
    ]));

    const events = [];
    for await (const event of execution.start({ taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 2, expectedPlanVersion: 3 })) events.push(event);

    expect(provider.beginExecution).toHaveBeenCalledWith({
      executionKey: "task-1:plan-1:v3", sources: sources.slice(0, 2),
    });
    expect(provider.collect).toHaveBeenCalledOnce();
    expect(provider.collect).toHaveBeenCalledWith(sources[0], expect.any(String), undefined);
    expect(publicProvider.collect).toHaveBeenCalledOnce();
    expect(startRun).toHaveBeenCalledTimes(3);
    expect(finishRun).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: "failed",
      terminationReason: "rate_limited" }));
    expect(finishRun).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: "stopped",
      terminationReason: "provider_access_surface_stopped:rate_limited" }));
    expect(events.map((event) => event.type)).toEqual([
      "run.started", "run.updated", "run.failed", "run.started", "run.stopped",
      "run.started", "run.failed",
    ]);
    expect(provider.endExecution).toHaveBeenCalledWith("task-1:plan-1:v3");
    expect(publicProvider.endExecution).toHaveBeenCalledWith("task-1:plan-1:v3");
  });
});

function executionSource(key: string, providerKey = "jd.catalog-product") {
  const isJd = providerKey === "jd.catalog-product";
  return { key, name: key, publisher: isJd ? "京东" : "NIST", sourceKind: isJd ? "retailer" : "standards_body",
    sourceCandidateIds: [], role: "目录",
    entryUrls: [isJd ? `https://www.jd.com/chanpin/${key === "jd.one" ? "1" : "2"}.html`
      : "https://www.nist.gov/"],
    provider: { key: providerKey, version: "1.0.0", configuration: [] },
    accessPolicy: { kind: "paced_http", version: "jd-low-frequency-v1", maxRequestsPerMinute: 2,
      minimumIntervalMs: 10_000, maximumRunMs: 180_000 },
    stopPolicy: { requestBudget: 2, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
    rawOutputPolicy: { formats: ["html"], retainAssets: false }, observationLevel: "search_discovered",
    accessState: "unknown", observedAt: "2026-08-21T00:00:00.000Z", executionBlockers: [],
    targets: [{ key: `${key}.catalog`, name: "目录", taskTopics: ["型号"],
      providerConfiguration: [{ key: "operation", value: "catalog" }], captureUnit: "HTML", rawFormats: ["html"],
      quantity: { mode: "target_count", targetCount: 1, unit: "页", denominator: "入口", rationale: "有界" },
      uniqueKey: "URL", traversal: "Provider", stopCondition: "1 页" }],
  } as CrawlPlanSource;
}

function runningRun(sourceKey: string, accessPolicy: Parameters<SourceDatasetModule["startRun"]>[0]["accessPolicy"]) {
  return { id: `run-${sourceKey}`, taskId: "task-1", sourceCollectionPlanId: "plan-1",
    sourceCollectionPlanSourceKey: sourceKey, sourceCollectionPlanVersion: 3,
    providerKey: "jd.catalog-product", providerVersion: "1.0.0", accessPolicy,
    status: "running" as const, snapshotCount: 0, accessibleCount: 0, failedCount: 0, assetCount: 0,
    startedAt: "2026-08-21T00:00:00.000Z" };
}
