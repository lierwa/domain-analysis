import {
  sourceCollectionRunSchema,
  sourceSnapshotRecordSchema,
  type CommitSourceSnapshot,
  type SourceCollectionProviderResult,
  type SourceCollectionRun,
  type SourceCollectionWorkItem,
} from "@domain-analysis/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openSourceCollectionPipeline,
  type OpenedSourceCollectionPipeline,
  type SourceCollectionProviderPort,
} from "../src/sourceCollectionPipelineModule";
import type { SourceDatasetModule } from "../src/sourceDatasetModule";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithDbos = databaseUrl ? describe.sequential : describe.skip;
const fakeDatasets = createFakeDatasets();
const provider = createProvider();
let opened: OpenedSourceCollectionPipeline;

describeWithDbos("SourceCollectionPipelineModule", () => {
  beforeAll(async () => {
    opened = await openSourceCollectionPipeline({
      systemDatabaseUrl: databaseUrl!,
      systemDatabaseSchemaName: `domain_analysis_source_pipeline_${process.pid}_${Date.now()}`,
      workflowName: `sourceCollectionPipelineTest${process.pid}${Date.now()}`,
      childWorkflowName: `sourceCollectionItemTest${process.pid}${Date.now()}`,
      queueName: `source-collection-test-${process.pid}-${Date.now()}`,
      sourceDatasets: fakeDatasets.module,
      source: provider.port,
      commandTimeoutSeconds: 15,
    });
  }, 30_000);

  afterAll(async () => opened?.close());

  it("逐对象持久执行并用工作项 id 幂等提交来源快照", async () => {
    const run = fakeDatasets.addRun("source-run-success");
    provider.reset();
    const started = await opened.module.start({
      sourceRunId: run.id,
      workItems: [workItem("A"), workItem("B"), workItem("C")],
    });
    const duplicate = await opened.module.start({
      sourceRunId: run.id,
      workItems: [workItem("A"), workItem("B"), workItem("C")],
    });
    expect(duplicate.id).toBe(started.id);

    const completed = await waitFor(started.id, "succeeded");
    expect(completed).toMatchObject({ totalItems: 3, completedItems: 3 });
    expect(provider.calls).toEqual(["item-A", "item-B", "item-C"]);
    expect(fakeDatasets.commits.map((input) => input.idempotencyKey))
      .toEqual(["item-A", "item-B", "item-C"]);
    expect(fakeDatasets.runs.get(run.id)?.status).toBe("completed");
  }, 30_000);

  it("typed 停止信号先提交失败观察，再终止全部未派发工作项", async () => {
    const run = fakeDatasets.addRun("source-run-limited");
    provider.reset({ stopAt: "item-B" });
    const started = await opened.module.start({
      sourceRunId: run.id,
      workItems: [workItem("A"), workItem("B"), workItem("C")],
    });
    const failed = await waitFor(started.id, "failed");

    expect(failed).toMatchObject({ completedItems: 2, errorCode: "source_stop_signal" });
    expect(provider.calls).toEqual(["item-A", "item-B"]);
    expect(fakeDatasets.commits.at(-1)?.observation.state).toBe("rate_limited");
    expect(fakeDatasets.runs.get(run.id)).toMatchObject({
      status: "failed",
      terminationReason: "source_stop_signal",
    });
  }, 30_000);

  it("取消会先通知来源端中止在途访问，并停止来源运行", async () => {
    const run = fakeDatasets.addRun("source-run-cancel");
    provider.reset({ hangAt: "item-A" });
    const started = await opened.module.start({
      sourceRunId: run.id,
      workItems: [workItem("A"), workItem("B")],
    });
    await provider.waitUntilStarted();
    const cancelled = await opened.module.cancel(started.id);

    expect(cancelled.lifecycleStatus).toBe("cancelled");
    expect(provider.cancelledRuns).toEqual([run.id]);
    expect(provider.calls).toEqual(["item-A"]);
    expect(fakeDatasets.runs.get(run.id)?.status).toBe("stopped");
  }, 30_000);
});

function createFakeDatasets() {
  const runs = new Map<string, SourceCollectionRun>();
  const commits: CommitSourceSnapshot[] = [];
  const module: SourceDatasetModule = {
    savePlan: async () => { throw new Error("测试不应保存来源计划"); },
    getPlan: async () => null,
    listPlans: async () => [],
    startRun: async () => { throw new Error("测试不应创建来源运行"); },
    commitSnapshot: async (input) => {
      const { object: objectInput, ...snapshotInput } = input;
      commits.push(input);
      const run = runs.get(input.runId)!;
      runs.set(input.runId, sourceCollectionRunSchema.parse({
        ...run,
        snapshotCount: run.snapshotCount + 1,
        accessibleCount: run.accessibleCount + Number(input.observation.state === "accessible"),
        failedCount: run.failedCount + Number(input.observation.state !== "accessible"),
      }));
      return sourceSnapshotRecordSchema.parse({
        object: { id: `object-${input.idempotencyKey}`, projectId: run.projectId, ...objectInput, createdAt: input.observation.observedAt },
        snapshot: { id: `snapshot-${input.idempotencyKey}`, ...snapshotInput, objectId: `object-${input.idempotencyKey}`, contentHash: "a".repeat(64), createdAt: input.observation.observedAt },
        assets: [],
      });
    },
    commitAsset: async () => { throw new Error("测试不应提交附件"); },
    finishRun: async (input) => {
      const run = runs.get(input.runId)!;
      const finished = sourceCollectionRunSchema.parse({
        ...run,
        status: input.status,
        terminationReason: input.terminationReason,
        finishedAt: "2026-08-17T08:10:00.000Z",
      });
      runs.set(input.runId, finished);
      return finished;
    },
    getRun: async (runId) => {
      const run = runs.get(runId);
      return run ? { run, records: [] } : null;
    },
    getSnapshot: async () => null,
    listProject: async () => [],
    exportRun: async function* () { yield ""; },
  };
  return {
    module,
    runs,
    commits,
    addRun(id: string) {
      const run = sourceCollectionRunSchema.parse({
        id,
        projectId: `project-${id}`,
        categoryDefinitionVersionId: `definition-${id}`,
        confirmedScopeVersionId: `scope-${id}`,
        collectionBoardVersionId: `board-${id}`,
        categoryCode: "television",
        collectionLaneId: `lane-${id}`,
        providerKey: "fixture-source",
        sourceAuthorityType: "brand_official_site",
        accessPolicy: {
          kind: "paced_http",
          version: "fixture-v1",
          maxRequestsPerMinute: 100,
          minimumIntervalMs: 1,
          jitterMs: { min: 0, max: 0 },
          batchSize: 100,
          batchCooldownMs: 1,
          maximumRunMs: 10_000,
        },
        status: "running",
        snapshotCount: 0,
        accessibleCount: 0,
        failedCount: 0,
        assetCount: 0,
        startedAt: "2026-08-17T08:00:00.000Z",
      });
      runs.set(id, run);
      commits.length = 0;
      return run;
    },
  };
}

function createProvider() {
  let stopAt: string | undefined;
  let hangAt: string | undefined;
  let startedCount = 0;
  let started: (() => void) | undefined;
  let cancel: ((error: Error) => void) | undefined;
  const calls: string[] = [];
  const cancelledRuns: string[] = [];
  const port: SourceCollectionProviderPort = {
    collect: async ({ item }) => {
      calls.push(item.id);
      startedCount += 1;
      started?.();
      started = undefined;
      if (item.id === hangAt) {
        await new Promise<never>((_resolve, reject) => { cancel = reject; });
      }
      return providerResult(item, item.id === stopAt);
    },
    cancel: (sourceRunId) => {
      cancelledRuns.push(sourceRunId);
      cancel?.(new Error("fixture_cancelled"));
      cancel = undefined;
    },
  };
  return {
    port,
    calls,
    cancelledRuns,
    reset(options: { stopAt?: string; hangAt?: string } = {}) {
      calls.length = 0;
      cancelledRuns.length = 0;
      stopAt = options.stopAt;
      hangAt = options.hangAt;
      cancel = undefined;
      startedCount = 0;
    },
    waitUntilStarted: () => startedCount > 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => { started = resolve; }),
  };
}

function providerResult(
  item: SourceCollectionWorkItem,
  stopRun: boolean,
): SourceCollectionProviderResult {
  const timestamp = "2026-08-17T08:00:01.000Z";
  if (stopRun) {
    return {
      accessStartedAt: timestamp,
      accessFinishedAt: timestamp,
      observation: {
        requestedUrl: item.requestedUrl,
        observedAt: timestamp,
        state: "rate_limited",
        failureCode: "rate_limited",
        httpValidation: { status: 429 },
      },
      relations: [],
      stopRun: true,
    };
  }
  return {
    accessStartedAt: timestamp,
    accessFinishedAt: timestamp,
    observation: {
      requestedUrl: item.requestedUrl,
      finalUrl: item.requestedUrl,
      observedAt: timestamp,
      state: "accessible",
    },
    content: {
      kind: "ordered_record",
      title: item.object.externalKey,
      fieldGroups: [{ label: "规格", fields: [{ name: "型号", value: item.object.externalKey }] }],
      blocks: [],
    },
    relations: [],
    stopRun: false,
  };
}

function workItem(externalKey: string): SourceCollectionWorkItem {
  return {
    id: `item-${externalKey}`,
    object: { sourceIdentity: "fixture-source", kind: "product", externalKey },
    requestedUrl: `https://example.com/products/${externalKey}`,
    targetKeys: ["category:television"],
    knowledgeNeedIds: ["need:model-fact"],
    parsing: { adapterId: "fixture", adapterVersion: "v1" },
    claimScopes: ["model_fact"],
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed",
      sourceRedistribution: "unknown",
      basis: "fixture policy",
    },
  };
}

async function waitFor(runId: string, lifecycleStatus: "succeeded" | "failed") {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const run = await opened.module.get(runId);
    if (run?.lifecycleStatus === lifecycleStatus) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待来源采集运行超时：${lifecycleStatus}`);
}
