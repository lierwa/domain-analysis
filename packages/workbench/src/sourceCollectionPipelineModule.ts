import { createHash } from "node:crypto";

import { DBOS, type WorkflowStatus } from "@dbos-inc/dbos-sdk";
import {
  sourceCollectionPipelineRunSchema,
  sourceCollectionProviderResultSchema,
  sourceCollectionRunSchema,
  sourceCollectionWorkItemSchema,
  startSourceCollectionPipelineSchema,
  type SourceCollectionPipelineRun,
  type SourceCollectionProviderResult,
  type SourceCollectionProviderPort,
  type SourceCollectionRun,
  type SourceCollectionWorkItem,
  type StartSourceCollectionPipeline,
} from "@domain-analysis/shared";
import { z } from "zod";

import { contentHash } from "./contentHash";
import type { SourceDatasetModule } from "./sourceDatasetModule";

const viewEventKey = "source-collection-pipeline-view";
const activeChildEventKey = "source-collection-pipeline-active-child";
const defaultQueueName = "source-collection-items-v1";
const terminalStatuses = new Set(["succeeded", "failed", "cancelled"]);
const frozenInputSchema = z.object({
  sourceRun: sourceCollectionRunSchema,
  workItems: z.array(sourceCollectionWorkItemSchema).min(1).max(100_000),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

type FrozenInput = z.infer<typeof frozenInputSchema>;
type ParentWorkflow = (
  executionId: string,
  input: FrozenInput,
) => Promise<SourceCollectionPipelineRun>;
type ChildWorkflow = (
  sourceRun: SourceCollectionRun,
  item: SourceCollectionWorkItem,
) => Promise<SourceCollectionProviderResult>;

export interface SourceCollectionPipelineModule {
  start(input: StartSourceCollectionPipeline): Promise<SourceCollectionPipelineRun>;
  get(executionId: string): Promise<SourceCollectionPipelineRun | null>;
  cancel(executionId: string): Promise<SourceCollectionPipelineRun>;
}

export interface OpenSourceCollectionPipelineOptions {
  systemDatabaseUrl: string;
  sourceDatasets: SourceDatasetModule;
  source: SourceCollectionProviderPort;
  applicationName?: string;
  systemDatabaseSchemaName?: string;
  workflowName?: string;
  childWorkflowName?: string;
  queueName?: string;
  commandTimeoutSeconds?: number;
}

export type { SourceCollectionProviderPort } from "@domain-analysis/shared";

export interface OpenedSourceCollectionPipeline {
  module: SourceCollectionPipelineModule;
  close(): Promise<void>;
}

export interface RegisteredSourceCollectionPipeline {
  module: SourceCollectionPipelineModule;
  queueName: string;
}

export class SourceCollectionPipelineError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_state" | "input_conflict" | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "SourceCollectionPipelineError";
  }
}

class SourceCollectionStopError extends Error {
  constructor() {
    super("来源返回停止信号");
    this.name = "source_stop_signal";
  }
}

export async function openSourceCollectionPipeline(
  options: OpenSourceCollectionPipelineOptions,
): Promise<OpenedSourceCollectionPipeline> {
  if (DBOS.isInitialized()) {
    throw new SourceCollectionPipelineError("invalid_state", "DBOS 已在当前进程启动");
  }
  const registered = registerSourceCollectionPipeline(options);
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

export function registerSourceCollectionPipeline(
  options: OpenSourceCollectionPipelineOptions,
): RegisteredSourceCollectionPipeline {
  const queueName = options.queueName ?? defaultQueueName;
  const child = DBOS.registerWorkflow(
    (sourceRun: SourceCollectionRun, item: SourceCollectionWorkItem) =>
      runChild(sourceRun, item, options),
    {
      name: options.childWorkflowName ?? "sourceCollectionItemV1",
      inputSchema: z.tuple([sourceCollectionRunSchema, sourceCollectionWorkItemSchema]),
    },
  );
  const parent = DBOS.registerWorkflow(
    (executionId: string, input: FrozenInput) =>
      executeParent(executionId, input, child, queueName, options),
    {
      name: options.workflowName ?? "sourceCollectionPipelineV1",
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
  options: OpenSourceCollectionPipelineOptions,
): SourceCollectionPipelineModule {
  return {
    start: async (rawInput) => {
      const input = startSourceCollectionPipelineSchema.parse(rawInput);
      const executionId = executionIdentity(input.sourceRunId);
      const inputHash = contentHash(input);
      const existing = await getRun(executionId);
      if (existing) {
        if (existing.inputHash !== inputHash) {
          throw new SourceCollectionPipelineError("input_conflict", "同一来源运行提交了不同工作项");
        }
        return existing;
      }
      const sourceView = await options.sourceDatasets.getRun(input.sourceRunId);
      if (!sourceView) {
        throw new SourceCollectionPipelineError("not_found", `来源运行不存在：${input.sourceRunId}`);
      }
      if (sourceView.run.status !== "running") {
        throw new SourceCollectionPipelineError("invalid_state", "只能执行 running 来源运行");
      }
      const frozen = frozenInputSchema.parse({
        sourceRun: sourceView.run,
        workItems: input.workItems,
        inputHash,
      });
      await DBOS.startWorkflow(parent, {
        workflowID: executionId,
        timeoutMS: sourceView.run.accessPolicy.kind === "paced_http"
          ? sourceView.run.accessPolicy.maximumRunMs
          : undefined,
        workflowAttributes: {
          projectId: sourceView.run.projectId,
          sourceRunId: sourceView.run.id,
        },
      })(executionId, frozen);
      return waitForView(
        executionId,
        (view) => view.lifecycleStatus !== "queued",
        options.commandTimeoutSeconds,
      );
    },
    get: getRun,
    cancel: async (executionId) => cancelRun(executionId, options),
  };
}

async function executeParent(
  executionId: string,
  input: FrozenInput,
  child: ChildWorkflow,
  queueName: string,
  options: OpenSourceCollectionPipelineOptions,
) {
  let view = await initialView(executionId, input);
  let recentStarts: number[] = [];
  let lastFinishedAt: number | undefined;
  await publishView(view);
  try {
    for (const [index, item] of input.workItems.entries()) {
      await waitForPacing(input.sourceRun, recentStarts, lastFinishedAt, index);
      view = sourceCollectionPipelineRunSchema.parse({
        ...view,
        lifecycleStatus: "running",
        currentItemId: item.id,
        updatedAt: await workflowTimestamp(),
      });
      await publishView(view);
      const childRunId = childIdentity(executionId, item.id);
      await DBOS.setEvent(activeChildEventKey, childRunId);
      const handle = await DBOS.startWorkflow(child, {
        queueName,
        workflowID: childRunId,
      })(input.sourceRun, item);
      const result = sourceCollectionProviderResultSchema.parse(await handle.getResult());
      await DBOS.setEvent(activeChildEventKey, "");
      const startedAt = Date.parse(result.accessStartedAt);
      lastFinishedAt = Date.parse(result.accessFinishedAt);
      recentStarts = retainRecentStarts(input.sourceRun, recentStarts, startedAt);
      view = withCompletedItem(view, recentStarts, result);
      await publishView(view);
      if (result.stopRun) throw new SourceCollectionStopError();
    }
    await finishSourceRunStep(options.sourceDatasets, input.sourceRun.id, "completed");
    view = sourceCollectionPipelineRunSchema.parse({
      ...view,
      lifecycleStatus: "succeeded",
      currentItemId: undefined,
      updatedAt: await workflowTimestamp(),
    });
    await publishView(view);
    return view;
  } catch (error) {
    await failSourceRunIfOpen(options.sourceDatasets, input.sourceRun.id, errorCode(error));
    view = sourceCollectionPipelineRunSchema.parse({
      ...view,
      lifecycleStatus: "failed",
      currentItemId: undefined,
      errorCode: errorCode(error),
      updatedAt: await workflowTimestamp(),
    });
    await publishView(view);
    throw error;
  }
}

async function runChild(
  sourceRun: SourceCollectionRun,
  item: SourceCollectionWorkItem,
  options: OpenSourceCollectionPipelineOptions,
) {
  const result = await DBOS.runStep(async () => {
    const collected = await options.source.collect({
      sourceRun,
      item,
      abortSignal: DBOS.stepStatus?.timeoutSignal,
    });
    const parsed = sourceCollectionProviderResultSchema.parse(collected);
    if (parsed.observation.requestedUrl !== item.requestedUrl) {
      throw new Error("Provider 返回了不匹配的 requestedUrl");
    }
    return parsed;
  }, {
    name: "collect-source-item",
    retriesAllowed: false,
    timeoutMS: sourceRun.accessPolicy.kind === "paced_http"
      ? sourceRun.accessPolicy.maximumRunMs
      : undefined,
  });
  await DBOS.runStep(() => options.sourceDatasets.commitSnapshot({
    runId: sourceRun.id,
    idempotencyKey: item.id,
    object: item.object,
    targetKeys: item.targetKeys,
    knowledgeNeedIds: item.knowledgeNeedIds,
    observation: result.observation,
    content: result.content,
    parsing: item.parsing,
    claimScopes: item.claimScopes,
    usagePermission: item.usagePermission,
    relations: result.relations,
  }), {
    name: "commit-source-snapshot",
    retriesAllowed: true,
    maxAttempts: 3,
    intervalSeconds: 1,
  });
  return result;
}

async function cancelRun(
  executionId: string,
  options: OpenSourceCollectionPipelineOptions,
) {
  const current = await getRun(executionId);
  if (!current) {
    throw new SourceCollectionPipelineError("not_found", `来源采集执行不存在：${executionId}`);
  }
  if (terminalStatuses.has(current.lifecycleStatus)) return current;
  await DBOS.cancelWorkflow(executionId);
  const activeChildId = await getActiveChild(executionId);
  if (activeChildId) await DBOS.cancelWorkflow(activeChildId);
  try {
    // WHY：先通知来源 adapter 中止可能仍在系统调用中的访问，再关闭业务运行，避免状态已停止但网络仍在继续。
    options.source.cancel(current.sourceRunId, "source_collection_cancelled");
  } finally {
    // WHY：取消入口不在 DBOS workflow 上下文内，直接走幂等领域接口；不能误用 DBOS.runStep。
    await options.sourceDatasets.finishRun({
      runId: current.sourceRunId,
      status: "stopped",
      terminationReason: "source_collection_cancelled",
    });
  }
  return waitForView(
    executionId,
    (view) => view.lifecycleStatus === "cancelled",
    options.commandTimeoutSeconds,
  );
}

async function waitForPacing(
  sourceRun: SourceCollectionRun,
  recentStarts: number[],
  lastFinishedAt: number | undefined,
  completedItems: number,
) {
  if (sourceRun.accessPolicy.kind !== "paced_http" || lastFinishedAt === undefined) return;
  const policy = sourceRun.accessPolicy;
  const now = await DBOS.now();
  const jitter = await durableJitter(policy.jitterMs.min, policy.jitterMs.max);
  const intervalDue = lastFinishedAt + policy.minimumIntervalMs + jitter;
  const cooldownDue = completedItems > 0 && completedItems % policy.batchSize === 0
    ? lastFinishedAt + policy.batchCooldownMs
    : now;
  const windowDue = recentStarts.length < policy.maxRequestsPerMinute
    ? now
    : recentStarts[0]! + 60_000 + policy.minimumIntervalMs + policy.jitterMs.max;
  const waitMs = Math.max(0, intervalDue - now, cooldownDue - now, windowDue - now);
  if (waitMs > 0) await DBOS.sleep(waitMs);
}

async function durableJitter(minimum: number, maximum: number) {
  if (minimum === maximum) return minimum;
  const random = createHash("sha256").update(await DBOS.randomUUID()).digest().readUInt32BE(0);
  return minimum + random % (maximum - minimum + 1);
}

function retainRecentStarts(run: SourceCollectionRun, previous: number[], current: number) {
  if (run.accessPolicy.kind !== "paced_http") return [];
  return [...previous, current].slice(-run.accessPolicy.maxRequestsPerMinute);
}

async function initialView(executionId: string, input: FrozenInput) {
  const timestamp = await workflowTimestamp();
  return sourceCollectionPipelineRunSchema.parse({
    id: executionId,
    sourceRunId: input.sourceRun.id,
    inputHash: input.inputHash,
    lifecycleStatus: "running",
    totalItems: input.workItems.length,
    completedItems: 0,
    recentRequestStartedAt: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function withCompletedItem(
  view: SourceCollectionPipelineRun,
  recentStarts: number[],
  result: SourceCollectionProviderResult,
) {
  return sourceCollectionPipelineRunSchema.parse({
    ...view,
    completedItems: view.completedItems + 1,
    currentItemId: undefined,
    recentRequestStartedAt: recentStarts.map((timestamp) => new Date(timestamp).toISOString()),
    lastRequestFinishedAt: result.accessFinishedAt,
    updatedAt: result.accessFinishedAt,
  });
}

async function finishSourceRunStep(
  datasets: SourceDatasetModule,
  runId: string,
  status: "completed" | "failed" | "stopped",
  terminationReason?: string,
) {
  await DBOS.runStep(() => datasets.finishRun({ runId, status, terminationReason }), {
    name: `finish-source-run:${status}`,
    retriesAllowed: true,
    maxAttempts: 3,
    intervalSeconds: 1,
  });
}

async function failSourceRunIfOpen(
  datasets: SourceDatasetModule,
  runId: string,
  reason: string,
) {
  const current = await DBOS.runStep(() => datasets.getRun(runId), {
    name: "read-source-run-after-failure",
    retriesAllowed: true,
    maxAttempts: 3,
  });
  if (current?.run.status === "running") {
    await finishSourceRunStep(datasets, runId, "failed", reason);
  }
}

async function getRun(executionId: string) {
  const status = await DBOS.getWorkflowStatus(executionId);
  if (!status) return null;
  const stored = await DBOS.getEvent<SourceCollectionPipelineRun>(executionId, viewEventKey, {
    timeoutSeconds: 0.05,
    pollingIntervalMs: 10,
  });
  if (!stored) return null;
  return sourceCollectionPipelineRunSchema.parse(projectStatus(stored, status));
}

function getActiveChild(executionId: string) {
  return DBOS.getEvent<string>(executionId, activeChildEventKey, {
    timeoutSeconds: 0.05,
    pollingIntervalMs: 10,
  });
}

function projectStatus(view: SourceCollectionPipelineRun, status: WorkflowStatus) {
  const updatedAt = new Date(status.updatedAt ?? status.createdAt).toISOString();
  if (status.status === "CANCELLED") {
    return { ...view, lifecycleStatus: "cancelled" as const, currentItemId: undefined, updatedAt };
  }
  if (["ERROR", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"].includes(status.status)) {
    return { ...view, lifecycleStatus: "failed" as const, errorCode: view.errorCode ?? "workflow_error", updatedAt };
  }
  if (["ENQUEUED", "DELAYED"].includes(status.status)) {
    return { ...view, lifecycleStatus: "queued" as const, updatedAt };
  }
  return view;
}

async function waitForView(
  executionId: string,
  predicate: (view: SourceCollectionPipelineRun) => boolean,
  timeoutSeconds = 10,
) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const view = await getRun(executionId);
    if (view && predicate(view)) return view;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new SourceCollectionPipelineError("timeout", `等待来源采集状态超时：${executionId}`);
}

function publishView(view: SourceCollectionPipelineRun) {
  return DBOS.setEvent(viewEventKey, sourceCollectionPipelineRunSchema.parse(view));
}

function workflowTimestamp() {
  return DBOS.runStep(() => Promise.resolve(new Date().toISOString()), { name: "source-collection-timestamp" });
}

function executionIdentity(sourceRunId: string) {
  return `source-collection:${hash(sourceRunId)}`;
}

function childIdentity(executionId: string, itemId: string) {
  return `${executionId}:item:${hash(itemId)}`;
}

function errorCode(error: unknown) {
  return error instanceof Error && error.name ? error.name : "unknown_error";
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
