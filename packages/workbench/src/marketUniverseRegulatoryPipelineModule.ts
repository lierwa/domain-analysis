import { createHash } from "node:crypto";

import { DBOS, type WorkflowStatus } from "@dbos-inc/dbos-sdk";
import {
  officialCatalogSnapshotSchema,
  regulatoryCatalogOutcomeSchema,
  regulatoryReconciliationRunSchema,
  type MarketUniverseVersion,
  type OfficialCatalogSnapshot,
  type RegulatoryCatalogOutcome,
  type RegulatoryReconciliationRun,
} from "@domain-analysis/shared";
import { z } from "zod";

import { MarketUniverseError, type MarketUniverseModule } from "./marketUniverseModule";

const viewEventKey = "market-universe-regulatory-view";
const activeChildEventKey = "market-universe-regulatory-active-child";
const defaultQueueName = "market-universe-regulatory-lookup-v1";
const terminalStatuses = new Set(["succeeded", "failed", "cancelled"]);
const modelInputSchema = z.object({
  brand: z.string().min(1).max(120),
  manufacturerModel: z.string().min(1).max(200),
}).strict();
const frozenInputSchema = z.object({
  projectId: z.string().min(1),
  requestedBy: z.string().min(1),
  sourceUniverse: z.object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  models: z.array(modelInputSchema).min(1),
}).strict();
const childResultSchema = z.object({
  snapshot: officialCatalogSnapshotSchema,
  outcomes: z.array(regulatoryCatalogOutcomeSchema).length(1),
}).strict();

type FrozenInput = z.infer<typeof frozenInputSchema>;
type ModelInput = z.infer<typeof modelInputSchema>;
type ChildResult = z.infer<typeof childResultSchema>;
type ParentWorkflow = (runId: string, input: FrozenInput) => Promise<RegulatoryReconciliationRun>;
type ChildWorkflow = (model: ModelInput) => Promise<ChildResult>;

export interface RegulatoryCatalogReconcilerPort {
  reconcile(models: ModelInput[]): Promise<{
    snapshot: OfficialCatalogSnapshot;
    outcomes: RegulatoryCatalogOutcome[];
  }>;
}

export interface MarketUniverseRegulatoryPipelineModule {
  start(projectId: string, requestedBy: string): Promise<RegulatoryReconciliationRun>;
  latest(projectId: string): Promise<RegulatoryReconciliationRun | null>;
  get(runId: string): Promise<RegulatoryReconciliationRun | null>;
  cancel(runId: string): Promise<RegulatoryReconciliationRun>;
}

export interface OpenMarketUniverseRegulatoryPipelineOptions {
  systemDatabaseUrl: string;
  marketUniverses: MarketUniverseModule;
  source: RegulatoryCatalogReconcilerPort;
  applicationName?: string;
  systemDatabaseSchemaName?: string;
  workflowName?: string;
  childWorkflowName?: string;
  queueName?: string;
  commandTimeoutSeconds?: number;
}

export interface OpenedMarketUniverseRegulatoryPipeline {
  module: MarketUniverseRegulatoryPipelineModule;
  close(): Promise<void>;
}

export interface RegisteredMarketUniverseRegulatoryPipeline {
  module: MarketUniverseRegulatoryPipelineModule;
  queueName: string;
}

export class MarketUniverseRegulatoryPipelineError extends Error {
  constructor(readonly code: "not_found" | "invalid_state" | "timeout", message: string) {
    super(message);
    this.name = "MarketUniverseRegulatoryPipelineError";
  }
}

export async function openMarketUniverseRegulatoryPipeline(
  options: OpenMarketUniverseRegulatoryPipelineOptions,
): Promise<OpenedMarketUniverseRegulatoryPipeline> {
  if (DBOS.isInitialized()) {
    throw new MarketUniverseRegulatoryPipelineError("invalid_state", "DBOS 已在当前进程启动");
  }
  const registered = registerMarketUniverseRegulatoryPipeline(options);
  DBOS.setConfig({
    name: options.applicationName ?? "domain-analysis",
    systemDatabaseUrl: options.systemDatabaseUrl,
    systemDatabaseSchemaName: options.systemDatabaseSchemaName ?? "domain_analysis_pipeline",
    runAdminServer: false,
    logLevel: "warn",
  });
  await DBOS.launch();
  await DBOS.registerQueue(registered.queueName, { concurrency: 1 });

  return {
    module: registered.module,
    close: () => DBOS.shutdown(),
  };
}

export function registerMarketUniverseRegulatoryPipeline(
  options: OpenMarketUniverseRegulatoryPipelineOptions,
): RegisteredMarketUniverseRegulatoryPipeline {
  const queueName = options.queueName ?? defaultQueueName;
  const child = DBOS.registerWorkflow(
    (model: ModelInput) => runChild(model, options.source),
    { name: options.childWorkflowName ?? "marketUniverseRegulatoryLookupV1", inputSchema: z.tuple([modelInputSchema]) },
  );
  const parent = DBOS.registerWorkflow(
    (runId: string, input: FrozenInput) => executeParent(runId, input, child, queueName, options),
    {
      name: options.workflowName ?? "marketUniverseRegulatoryReconciliationV1",
      inputSchema: z.tuple([z.string().min(1), frozenInputSchema]),
    },
  );
  return {
    module: createModule(parent, options),
    queueName,
  };
}

function createModule(
  parent: ParentWorkflow,
  options: OpenMarketUniverseRegulatoryPipelineOptions,
): MarketUniverseRegulatoryPipelineModule {
  return {
    start: async (projectId, requestedBy) => {
      const universe = await options.marketUniverses.latest(projectId);
      if (!universe || universe.status !== "candidate") {
        throw new MarketUniverseError("candidate_changed", "必须先建立 Market Universe candidate 才能启动监管对账");
      }
      const input = freezeInput(universe, requestedBy);
      const runId = runIdentityForUniverse(universe);
      await DBOS.startWorkflow(parent, {
        workflowID: runId,
        workflowAttributes: { projectId, marketUniverseVersion: universe.version },
      })(runId, input);
      return waitForView(runId, (view) => view.lifecycleStatus !== "queued", options.commandTimeoutSeconds);
    },
    latest: async (projectId) => {
      const universe = await options.marketUniverses.latest(projectId);
      if (!universe) return null;
      const current = await getRun(runIdentityForUniverse(universe));
      if (current) return current;
      // WHY：成功运行以自身 ID 生成下一版候选；刷新页面后据此反查产生该版本的运行，不依赖浏览器本地状态。
      if (universe.id.startsWith("market-universe-regulatory:")) {
        const producingRun = await getRun(universe.id);
        if (producingRun?.projectId === projectId) return producingRun;
      }
      return null;
    },
    get: getRun,
    cancel: async (runId) => {
      const current = await getRun(runId);
      if (!current) throw new MarketUniverseRegulatoryPipelineError("not_found", `监管对账运行不存在：${runId}`);
      if (terminalStatuses.has(current.lifecycleStatus)) return current;
      await DBOS.cancelWorkflow(runId);
      const activeChildId = await getActiveChild(runId);
      if (activeChildId) {
        const childStatus = await DBOS.getWorkflowStatus(activeChildId);
        if (childStatus && !["SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"].includes(childStatus.status)) {
          await DBOS.cancelWorkflow(activeChildId);
        }
      }
      return waitForView(runId, (view) => view.lifecycleStatus === "cancelled", options.commandTimeoutSeconds);
    },
  };
}

async function executeParent(
  runId: string,
  input: FrozenInput,
  child: ChildWorkflow,
  queueName: string,
  options: OpenMarketUniverseRegulatoryPipelineOptions,
) {
  let view = await initialView(runId, input);
  await publishView(view);
  try {
    const results: ChildResult[] = [];
    for (const [index, model] of input.models.entries()) {
      const childRunId = childIdentity(runId, model);
      // WHY：只暴露一个在途子任务，父任务取消时才能精确停止它；尚未开始的型号不会提前堆入持久队列。
      await DBOS.setEvent(activeChildEventKey, childRunId);
      const handle = await DBOS.startWorkflow(child, {
        queueName,
        workflowID: childRunId,
      })(model);
      const result = childResultSchema.parse(await handle.getResult());
      results.push(result);
      await DBOS.setEvent(activeChildEventKey, "");
      view = withOutcome(view, result.outcomes[0]!, await workflowTimestamp(`progress:${index + 1}`));
      await publishView(view);
    }
    const snapshot = aggregateSnapshots(results);
    const outcomes = results.flatMap((result) => result.outcomes);
    const output = await DBOS.runStep(() => options.marketUniverses.applyRegulatoryReconciliation({
      projectId: input.projectId,
      expectedUniverse: input.sourceUniverse,
      operationId: runId,
      snapshot,
      outcomes,
    }), { name: "apply-regulatory-market-universe", retriesAllowed: true, maxAttempts: 3 });
    view = regulatoryReconciliationRunSchema.parse({
      ...view,
      lifecycleStatus: "succeeded",
      outputUniverseVersion: output.version,
      updatedAt: await workflowTimestamp("completed"),
    });
    await publishView(view);
    return view;
  } catch (error) {
    view = regulatoryReconciliationRunSchema.parse({
      ...view,
      lifecycleStatus: "failed",
      errorCode: error instanceof Error ? error.name : "unknown_error",
      updatedAt: await workflowTimestamp("failed"),
    });
    await publishView(view);
    throw error;
  }
}

async function runChild(model: ModelInput, source: RegulatoryCatalogReconcilerPort) {
  return DBOS.runStep(async () => {
    const result = await source.reconcile([model]);
    return childResultSchema.parse(result);
  }, {
    name: "lookup-energy-label-registration",
    retriesAllowed: true,
    maxAttempts: 3,
    intervalSeconds: 1,
  });
}

function freezeInput(universe: MarketUniverseVersion, requestedBy: string): FrozenInput {
  return frozenInputSchema.parse({
    projectId: universe.projectId,
    requestedBy,
    sourceUniverse: { id: universe.id, version: universe.version, contentHash: universe.contentHash },
    models: universe.models.map((model) => ({
      brand: model.brand.label,
      manufacturerModel: model.manufacturerModel,
    })),
  });
}

async function initialView(runId: string, input: FrozenInput) {
  const timestamp = await workflowTimestamp("started");
  return regulatoryReconciliationRunSchema.parse({
    id: runId,
    projectId: input.projectId,
    sourceUniverse: input.sourceUniverse,
    lifecycleStatus: "running",
    totalModels: input.models.length,
    completedModels: 0,
    matchedModels: 0,
    notFoundModels: 0,
    failedModels: 0,
    producerConflictModels: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function withOutcome(
  view: RegulatoryReconciliationRun,
  outcome: RegulatoryCatalogOutcome,
  updatedAt: string,
) {
  return regulatoryReconciliationRunSchema.parse({
    ...view,
    completedModels: view.completedModels + 1,
    matchedModels: view.matchedModels + Number(outcome.status === "matched"),
    notFoundModels: view.notFoundModels + Number(outcome.status === "not_found"),
    failedModels: view.failedModels + Number(outcome.status === "failed"),
    producerConflictModels: view.producerConflictModels + Number(outcome.status === "producer_conflict"),
    updatedAt,
  });
}

function aggregateSnapshots(results: ChildResult[]): OfficialCatalogSnapshot {
  const snapshots = results.map((result) => result.snapshot);
  const first = snapshots[0]!;
  if (snapshots.some((snapshot) => snapshot.sourceId !== first.sourceId
    || snapshot.sourceIdentity !== first.sourceIdentity
    || snapshot.catalogUrl !== first.catalogUrl)) {
    throw new Error("监管子任务返回了不一致的来源 identity");
  }
  const entries = snapshots.flatMap((snapshot) => snapshot.entries);
  return officialCatalogSnapshotSchema.parse({
    sourceId: first.sourceId,
    sourceIdentity: first.sourceIdentity,
    sourceAuthorityType: "regulatory_source",
    coverageKind: "regulatory_registry_lookup",
    catalogUrl: first.catalogUrl,
    observedAt: snapshots.map((snapshot) => snapshot.observedAt).sort().at(-1),
    declaredItemCount: entries.length,
    fetchedItemCount: entries.length,
    acceptedItemCount: entries.length,
    coverageStatus: results.every((result) => result.outcomes[0]?.status === "matched") ? "complete" : "partial",
    entries,
  });
}

async function getRun(runId: string) {
  const status = await DBOS.getWorkflowStatus(runId);
  if (!status) return null;
  const stored = await DBOS.getEvent<RegulatoryReconciliationRun>(runId, viewEventKey, {
    timeoutSeconds: 0.05,
    pollingIntervalMs: 10,
  });
  if (!stored) return null;
  return regulatoryReconciliationRunSchema.parse(projectStatus(stored, status));
}

async function getActiveChild(runId: string) {
  return DBOS.getEvent<string>(runId, activeChildEventKey, {
    timeoutSeconds: 0.05,
    pollingIntervalMs: 10,
  });
}

function projectStatus(view: RegulatoryReconciliationRun, status: WorkflowStatus) {
  const updatedAt = new Date(status.updatedAt ?? status.createdAt).toISOString();
  if (status.status === "CANCELLED") return { ...view, lifecycleStatus: "cancelled" as const, updatedAt };
  if (["ERROR", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"].includes(status.status)) {
    return { ...view, lifecycleStatus: "failed" as const, updatedAt };
  }
  if (["ENQUEUED", "DELAYED"].includes(status.status)) {
    return { ...view, lifecycleStatus: "queued" as const, updatedAt };
  }
  return view;
}

async function waitForView(
  runId: string,
  predicate: (view: RegulatoryReconciliationRun) => boolean,
  timeoutSeconds = 10,
) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const view = await getRun(runId);
    if (view && predicate(view)) return view;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new MarketUniverseRegulatoryPipelineError("timeout", `等待监管对账状态超时：${runId}`);
}

function publishView(view: RegulatoryReconciliationRun) {
  return DBOS.setEvent(viewEventKey, regulatoryReconciliationRunSchema.parse(view));
}

function workflowTimestamp(name: string) {
  return DBOS.runStep(() => Promise.resolve(new Date().toISOString()), { name: `timestamp:${name}` });
}

function runIdentityForUniverse(universe: MarketUniverseVersion) {
  return `market-universe-regulatory:${hash(`${universe.projectId}\u0000${universe.id}\u0000${universe.contentHash}`)}`;
}

function childIdentity(runId: string, model: ModelInput) {
  return `${runId}:model:${hash(`${model.brand}\u0000${model.manufacturerModel}`)}`;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
