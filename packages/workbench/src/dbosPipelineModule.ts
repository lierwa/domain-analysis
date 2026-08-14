import { createHash } from "node:crypto";

import { DBOS, type WorkflowStatus } from "@dbos-inc/dbos-sdk";
import {
  pipelineCommandSchema,
  pipelineRunViewSchema,
  pipelineStages,
  startPipelineInputSchema,
  type FrozenPipelineInput,
  type PipelineCommand,
  type PipelineModule,
  type PipelineRunView,
  type StartPipelineInput,
} from "@domain-analysis/shared";
import canonicalize from "canonicalize";
import { z } from "zod";

type PipelineStage = (typeof pipelineStages)[number];
type InterventionKind = PipelineRunView["interventions"][number]["kind"];
type RegisteredPipelineWorkflow = (
  runId: string,
  input: StartPipelineInput,
) => Promise<PipelineRunView>;

const viewEventKey = "pipeline-view";
const controlTopic = "pipeline-control";
const terminalStatuses = new Set(["succeeded", "failed", "cancelled"]);

const stageOutcomeSchema = z.object({
  intervention: z.object({
    kind: z.enum(["login", "verification", "review", "approval", "source_abnormal"]),
    prompt: z.string().min(1).max(2000),
  }).strict().optional(),
}).strict();

export interface PipelineStageContext {
  runId: string;
  stageExecutionId: string;
  input: FrozenPipelineInput;
  requestedBy: string;
  abortSignal?: AbortSignal;
}

export interface PipelineStageOutcome {
  intervention?: { kind: InterventionKind; prompt: string };
}

export type PipelineStageHandler = (
  context: PipelineStageContext,
) => Promise<PipelineStageOutcome | void>;

export type PipelineStageHandlers = Record<PipelineStage, PipelineStageHandler>;

export interface DbosPipelineModuleOptions {
  stageHandlers: PipelineStageHandlers;
  workflowName?: string;
  maxStepAttempts?: number;
  retryIntervalSeconds?: number;
  stepTimeoutMs?: number;
  commandTimeoutSeconds?: number;
}

export interface OpenDbosPipelineModuleOptions extends DbosPipelineModuleOptions {
  systemDatabaseUrl: string;
  applicationName?: string;
  systemDatabaseSchemaName?: string;
}

export interface OpenedDbosPipelineModule {
  pipeline: PipelineModule;
  close(): Promise<void>;
}

export class DbosPipelineError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_state" | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "DbosPipelineError";
  }
}

export function createDbosPipelineModule(options: DbosPipelineModuleOptions): PipelineModule {
  const workflow = DBOS.registerWorkflow(
    (runId: string, input: StartPipelineInput) => executePipeline(runId, input, options),
    {
      name: options.workflowName ?? "domainAnalysisPipeline",
      inputSchema: z.tuple([z.string().min(1), startPipelineInputSchema]),
    },
  );

  return {
    start: (input) => startPipeline(workflow, input, options),
    command: (runId, command) => commandPipeline(runId, command, options),
    get: getPipeline,
  };
}

export async function openDbosPipelineModule(
  options: OpenDbosPipelineModuleOptions,
): Promise<OpenedDbosPipelineModule> {
  if (DBOS.isInitialized()) {
    throw new DbosPipelineError("invalid_state", "DBOS 已在当前进程启动");
  }
  const pipeline = createDbosPipelineModule(options);
  DBOS.setConfig({
    name: options.applicationName ?? "domain-analysis",
    systemDatabaseUrl: options.systemDatabaseUrl,
    systemDatabaseSchemaName: options.systemDatabaseSchemaName ?? "domain_analysis_pipeline",
    runAdminServer: false,
    logLevel: "warn",
  });
  await DBOS.launch();

  return {
    pipeline,
    close: () => DBOS.shutdown(),
  };
}

async function startPipeline(
  workflow: RegisteredPipelineWorkflow,
  rawInput: StartPipelineInput,
  options: DbosPipelineModuleOptions,
) {
  const input = startPipelineInputSchema.parse(rawInput);
  const runId = pipelineIdentity(input.input);
  // WHY：冻结输入身份直接复用 DBOS 幂等键，重复启动不会产生第二条执行历史。
  await DBOS.startWorkflow(workflow, {
    workflowID: runId,
    workflowAttributes: {
      projectId: input.input.projectId,
      projectRevision: input.input.projectRevision,
    },
  })(runId, input);
  return waitForView(runId, () => true, options.commandTimeoutSeconds);
}

async function commandPipeline(
  runId: string,
  rawCommand: PipelineCommand,
  options: DbosPipelineModuleOptions,
) {
  const command = pipelineCommandSchema.parse(rawCommand);
  const current = await getRequiredPipeline(runId);

  if (command.type === "cancel") {
    if (!terminalStatuses.has(current.lifecycleStatus)) await DBOS.cancelWorkflow(runId);
    return waitForView(runId, (view) => view.lifecycleStatus === "cancelled", options.commandTimeoutSeconds);
  }
  if (command.type === "pause") {
    requireLifecycle(current, ["queued", "running"], command.type);
    await sendCommand(runId, command);
    return waitForView(runId, (view) => view.lifecycleStatus !== "running", options.commandTimeoutSeconds);
  }
  if (command.type === "resume") {
    requireLifecycle(current, ["paused"], command.type);
    await sendCommand(runId, command);
    return waitForView(runId, (view) => view.lifecycleStatus !== "paused", options.commandTimeoutSeconds);
  }
  if (command.type === "resolve_intervention") {
    const intervention = current.interventions.find((item) => item.id === command.interventionId);
    if (!intervention || intervention.status !== "open") {
      throw new DbosPipelineError("invalid_state", "人工事项不存在或已经处理");
    }
    await DBOS.send(runId, command, interventionTopic(intervention.id), commandId(runId, command));
    return waitForView(runId, (view) => !view.interventions.some(
      (item) => item.id === command.interventionId && item.status === "open",
    ), options.commandTimeoutSeconds);
  }

  const stage = current.stages.find((item) => item.id === command.stageExecutionId);
  if (!stage || stage.status !== "failed") {
    throw new DbosPipelineError("invalid_state", "只有失败阶段可以重试");
  }
  const steps = await DBOS.listWorkflowSteps(runId);
  const failedStep = steps?.find((item) => item.name === `pipeline:${stage.stage}`);
  if (!failedStep) throw new DbosPipelineError("invalid_state", "DBOS 中不存在对应失败步骤");
  const forkId = `${runId}:retry:${hashCanonical({
    stageExecutionId: stage.id,
    failedAt: current.updatedAt,
  })}`;
  // WHY：DBOS 失败 step 不可原地覆盖；官方 fork 保留旧历史并从指定 step 创建新运行。
  await DBOS.forkWorkflow(runId, failedStep.functionID, { newWorkflowID: forkId });
  return waitForView(forkId, (view) => view.lifecycleStatus !== "failed", options.commandTimeoutSeconds);
}

async function getPipeline(runId: string): Promise<PipelineRunView | null> {
  const status = await DBOS.getWorkflowStatus(runId);
  if (!status) return null;
  const stored = await DBOS.getEvent<PipelineRunView>(runId, viewEventKey, {
    timeoutSeconds: 0.05,
    pollingIntervalMs: 10,
  });
  if (!stored) return null;
  // WHY：fork 创建瞬间会复制旧 event；等新 workflow 发布自己的视图，避免返回旧运行 ID。
  if (stored.workflowId !== status.workflowID) return null;
  return pipelineRunViewSchema.parse(projectDbosStatus(stored, status));
}

async function executePipeline(
  runId: string,
  input: StartPipelineInput,
  options: DbosPipelineModuleOptions,
): Promise<PipelineRunView> {
  const activeRunId = DBOS.workflowID ?? runId;
  let view = createInitialView(
    activeRunId,
    input.input,
    await workflowTimestamp(),
    activeRunId === runId ? undefined : runId,
  );
  await publishView(view);

  for (const stage of pipelineStages) {
    view = await waitIfPaused(view);
    view = transitionStage(view, stage, "running", await workflowTimestamp());
    await publishView(view);
    try {
      const execution = await runStage(options, stage, view, input);
      view = setAttemptCount(view, stage, execution.attemptCount);
      if (execution.outcome.intervention) {
        view = await waitForIntervention(view, stage, execution.outcome.intervention);
      }
      view = transitionStage(view, stage, "succeeded", await workflowTimestamp());
      await publishView(view);
    } catch (error) {
      view = failStage(view, stage, error, options.maxStepAttempts ?? 3, await workflowTimestamp());
      await publishView(view);
      throw error;
    }
  }

  view = { ...view, lifecycleStatus: "succeeded", currentStage: undefined,
    updatedAt: await workflowTimestamp() };
  await publishView(view);
  return view;
}

async function runStage(
  options: DbosPipelineModuleOptions,
  stage: PipelineStage,
  view: PipelineRunView,
  input: StartPipelineInput,
) {
  return DBOS.runStep(async () => {
    const outcome = await options.stageHandlers[stage]({
      runId: view.id,
      stageExecutionId: stageId(view.id, stage),
      input: input.input,
      requestedBy: input.requestedBy,
      abortSignal: DBOS.stepStatus?.timeoutSignal,
    });
    return {
      outcome: stageOutcomeSchema.parse(outcome ?? {}),
      attemptCount: DBOS.stepStatus?.currentAttempt ?? 1,
    };
  }, {
    name: `pipeline:${stage}`,
    retriesAllowed: true,
    maxAttempts: options.maxStepAttempts ?? 3,
    intervalSeconds: options.retryIntervalSeconds ?? 1,
    timeoutMS: options.stepTimeoutMs,
  });
}

async function waitIfPaused(view: PipelineRunView) {
  const command = await DBOS.recv<PipelineCommand>(controlTopic, {
    timeoutSeconds: 0.01,
    pollingIntervalMs: 10,
  });
  if (command?.type !== "pause") return view;

  let paused: PipelineRunView = {
    ...view,
    lifecycleStatus: "paused",
    updatedAt: await workflowTimestamp(),
  };
  await publishView(paused);
  while (true) {
    const next = await DBOS.recv<PipelineCommand>(controlTopic, {
      timeoutSeconds: 86_400,
      pollingIntervalMs: 100,
    });
    if (next?.type === "resume") break;
  }
  paused = { ...paused, lifecycleStatus: "running", updatedAt: await workflowTimestamp() };
  await publishView(paused);
  return paused;
}

async function waitForIntervention(
  view: PipelineRunView,
  stage: PipelineStage,
  intervention: { kind: InterventionKind; prompt: string },
) {
  const now = await workflowTimestamp();
  const id = `${stageId(view.id, stage)}:intervention`;
  const waiting = pipelineRunViewSchema.parse({
    ...view,
    lifecycleStatus: "waiting_user",
    currentStage: stage,
    stages: view.stages.map((item) => item.stage === stage
      ? { ...item, status: "waiting_user" as const }
      : item),
    interventions: [...view.interventions, {
      id,
      stageExecutionId: stageId(view.id, stage),
      kind: intervention.kind,
      status: "open",
      prompt: intervention.prompt,
      createdAt: now,
    }],
    updatedAt: now,
  });
  await publishView(waiting);
  const resolution = await DBOS.recv<Extract<PipelineCommand, { type: "resolve_intervention" }>>(
    interventionTopic(id),
    { timeoutSeconds: 2_592_000, pollingIntervalMs: 100 },
  );
  if (!resolution) throw new Error(`人工事项等待超时：${id}`);

  const resolvedAt = await workflowTimestamp();
  return {
    ...waiting,
    lifecycleStatus: "running" as const,
    interventions: waiting.interventions.map((item) => item.id === id
      ? { ...item, status: "resolved" as const, resolutionId: resolution.resolutionId, resolvedAt }
      : item),
    updatedAt: resolvedAt,
  };
}

function createInitialView(
  runId: string,
  input: FrozenPipelineInput,
  timestamp: string,
  forkedFromRunId?: string,
): PipelineRunView {
  return pipelineRunViewSchema.parse({
    id: runId,
    workflowId: runId,
    forkedFromRunId,
    input,
    lifecycleStatus: "running",
    currentStage: "acquire",
    stages: pipelineStages.map((stage) => ({
      id: stageId(runId, stage), stage, status: "pending", attemptCount: 0,
    })),
    interventions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function transitionStage(
  view: PipelineRunView,
  stage: PipelineStage,
  status: PipelineRunView["stages"][number]["status"],
  timestamp: string,
) {
  return pipelineRunViewSchema.parse({
    ...view,
    lifecycleStatus: status === "waiting_user" ? "waiting_user" : "running",
    currentStage: stage,
    stages: view.stages.map((item) => item.stage === stage ? {
      ...item,
      status,
      startedAt: item.startedAt ?? (status === "running" ? timestamp : undefined),
      finishedAt: status === "succeeded" ? timestamp : undefined,
    } : item),
    updatedAt: timestamp,
  });
}

function setAttemptCount(view: PipelineRunView, stage: PipelineStage, attemptCount: number) {
  return {
    ...view,
    stages: view.stages.map((item) => item.stage === stage ? { ...item, attemptCount } : item),
  };
}

function failStage(
  view: PipelineRunView,
  stage: PipelineStage,
  error: unknown,
  attemptCount: number,
  timestamp: string,
) {
  return pipelineRunViewSchema.parse({
    ...view,
    lifecycleStatus: "failed",
    currentStage: stage,
    stages: view.stages.map((item) => item.stage === stage ? {
      ...item,
      status: "failed",
      attemptCount,
      finishedAt: timestamp,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    } : item),
    updatedAt: timestamp,
  });
}

function projectDbosStatus(view: PipelineRunView, status: WorkflowStatus): PipelineRunView {
  const updatedAt = new Date(status.updatedAt ?? status.createdAt).toISOString();
  if (status.status === "SUCCESS") {
    return { ...view, lifecycleStatus: "succeeded", currentStage: undefined, updatedAt };
  }
  if (["ERROR", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"].includes(status.status)) {
    return { ...view, lifecycleStatus: "failed", updatedAt };
  }
  if (status.status === "CANCELLED") return cancelView(view, updatedAt);
  if (["ENQUEUED", "DELAYED"].includes(status.status)) {
    if (view.lifecycleStatus === "waiting_user" || view.lifecycleStatus === "paused") return view;
    return { ...view, lifecycleStatus: "queued", updatedAt };
  }
  if (view.lifecycleStatus === "failed") return { ...view, lifecycleStatus: "running", updatedAt };
  return view;
}

function cancelView(view: PipelineRunView, timestamp: string): PipelineRunView {
  return {
    ...view,
    lifecycleStatus: "cancelled",
    stages: view.stages.map((stage) => stage.status === "running" || stage.status === "waiting_user"
      ? { ...stage, status: "cancelled", finishedAt: timestamp }
      : stage),
    interventions: view.interventions.map((item) => item.status === "open"
      ? { ...item, status: "cancelled" }
      : item),
    updatedAt: timestamp,
  };
}

async function waitForView(
  runId: string,
  predicate: (view: PipelineRunView) => boolean,
  timeoutSeconds = 10,
) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const view = await getPipeline(runId);
    if (view && predicate(view)) return view;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new DbosPipelineError("timeout", `等待流水线状态超时：${runId}`);
}

async function getRequiredPipeline(runId: string) {
  const view = await getPipeline(runId);
  if (!view) throw new DbosPipelineError("not_found", `流水线不存在：${runId}`);
  return view;
}

async function publishView(view: PipelineRunView) {
  await DBOS.setEvent(viewEventKey, pipelineRunViewSchema.parse(view));
}

async function sendCommand(runId: string, command: PipelineCommand) {
  await DBOS.send(runId, command, controlTopic, commandId(runId, command));
}

function requireLifecycle(view: PipelineRunView, allowed: string[], command: string) {
  if (!allowed.includes(view.lifecycleStatus)) {
    throw new DbosPipelineError("invalid_state", `${view.lifecycleStatus} 状态不能执行 ${command}`);
  }
}

function pipelineIdentity(input: FrozenPipelineInput) {
  return `pipeline-${hashCanonical(input)}`;
}

function commandId(runId: string, command: PipelineCommand) {
  return `command-${hashCanonical({ runId, command })}`;
}

function hashCanonical(value: unknown) {
  const serialized = canonicalize(value);
  if (serialized === undefined) throw new Error("RFC 8785 无法序列化流水线身份");
  return createHash("sha256").update(serialized).digest("hex");
}

function stageId(runId: string, stage: PipelineStage) {
  return `${runId}:${stage}`;
}

function interventionTopic(interventionId: string) {
  return `pipeline-intervention:${interventionId}`;
}

async function workflowTimestamp() {
  return new Date(await DBOS.now()).toISOString();
}
