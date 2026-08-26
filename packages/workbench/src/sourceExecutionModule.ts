import type {
  CrawlPlan,
  CrawlPlanSource,
  CrawlPlanTarget,
  SourceAccessPolicy,
  SourceCollectionRun,
  SourceExecutionEvent,
  SourcePreparation,
  SourceProviderCollectionContext,
  SourceProviderEvent,
  SourceRequestAdmissionPort,
  SourceRunEvent,
} from "@domain-analysis/shared";
import {
  sourceExecutionEventSchema,
  sourcePreparationSchema,
  sourceProviderCollectionContextSchema,
  sourceProviderEventSchema,
  sourceRunEventSchema,
  startCrawlPlanSchema,
} from "@domain-analysis/shared";

import type { CrawlPlanningModule } from "./crawlPlanningModule";
import type { SourceDatasetModule } from "./sourceDatasetModule";

export interface SourceProvider {
  readonly key: string;
  readonly version: string;
  validate(source: CrawlPlanSource): void;
  prepare?(source: CrawlPlanSource): Promise<SourcePreparation>;
  preflight(source: CrawlPlanSource): Promise<void>;
  collect(source: CrawlPlanSource, runId: string, admission: SourceRequestAdmissionPort,
    signal?: AbortSignal, context?: SourceProviderCollectionContext): AsyncIterable<SourceProviderEvent>;
  close?(): Promise<void>;
}

export interface SourceExecutionModule {
  prepare(input: { taskId: string; planId: string; expectedTaskRevision: number;
    expectedPlanVersion: number }): Promise<SourcePreparation>;
  start(input: { taskId: string; planId: string; expectedTaskRevision: number;
    expectedPlanVersion: number; signal?: AbortSignal }): AsyncIterable<SourceExecutionEvent>;
  resume(input: { taskId: string; runId: string; expectedTaskRevision: number;
    expectedPlanVersion: number; signal?: AbortSignal }): AsyncIterable<SourceRunEvent>;
  validateSource(source: CrawlPlanSource): void;
}

export class SourceExecutionError extends Error {
  constructor(
    readonly code: "not_found" | "revision_conflict" | "invalid_state" | "preflight_failed",
    message: string,
  ) {
    super(message);
    this.name = "SourceExecutionError";
  }
}

export function createSourceExecutionModule(
  planning: CrawlPlanningModule,
  datasets: SourceDatasetModule,
  providers: ReadonlyMap<string, SourceProvider>,
): SourceExecutionModule {
  const resolve = (source: CrawlPlanSource) => resolveProvider(providers, source);
  return {
    validateSource: (source) => { resolve(source); },
    prepare: async (raw) => {
      const request = startCrawlPlanSchema.parse({ expectedTaskRevision: raw.expectedTaskRevision,
        expectedPlanVersion: raw.expectedPlanVersion });
      const plan = await planning.requireExecutablePlan({ taskId: raw.taskId, planId: raw.planId, ...request });
      const sources = resolveExecutableSources(plan, resolve);
      const preparedProviders = new Set<string>();
      for (const { source, provider, identity } of sources) {
        if (preparedProviders.has(identity)) continue;
        const result = await prepareSource(source, provider);
        if (result.status === "action_required") return result;
        preparedProviders.add(identity);
      }
      return sourcePreparationSchema.parse({ status: "ready",
        message: "只完成抓取条件检查，尚未创建抓取批次，也没有访问任何来源。" });
    },
    start: async function* (raw) {
      const request = startCrawlPlanSchema.parse({ expectedTaskRevision: raw.expectedTaskRevision,
        expectedPlanVersion: raw.expectedPlanVersion });
      const plan = await planning.requireExecutablePlan({ taskId: raw.taskId, planId: raw.planId, ...request });
      const sources = resolveExecutableSources(plan, resolve);
      const batch = await datasets.startBatch({ taskId: plan.taskId, planId: plan.id,
        planVersion: plan.version, taskRevision: plan.taskRevision, plannedSourceCount: sources.length });
      const batchLease = await datasets.acquireBatchLease(batch.id);
      yield parseExecutionEvent({ type: "batch.started", batch });
      const terminals = { completed: 0, failed: 0, stopped: 0 };
      let finalized = false;
      const providerReadiness = new Map<string, ProviderReadiness>();
      try {
        for (const { source, provider, identity } of sources) {
          if (raw.signal?.aborted) break;
          let readiness = providerReadiness.get(identity);
          if (!readiness) {
            try {
              await preflightSource(source, provider);
              readiness = { status: "ready" };
            } catch (error) {
              readiness = { status: "failed", reason: boundedMessage(error) };
            }
            providerReadiness.set(identity, readiness);
          }
          const events = readiness.status === "failed"
            ? recordPreflightFailure(plan, source, provider, datasets, readiness.reason, batch.id)
            : executeSource(plan, source, provider, datasets, raw.signal, undefined, batch.id);
          for await (const event of events) {
            countTerminal(event, terminals);
            yield parseExecutionEvent(event);
          }
        }
        const outcome = batchOutcome(terminals, sources.length, Boolean(raw.signal?.aborted));
        const finished = await datasets.finishBatch({ batchId: batch.id, ...outcome });
        finalized = true;
        yield parseExecutionEvent({ type: `batch.${outcome.status}` as const, batch: finished });
      } catch (error) {
        const terminationReason = boundedMessage(error);
        const failed = await datasets.finishBatch({ batchId: batch.id, status: "failed", terminationReason });
        finalized = true;
        yield parseExecutionEvent({ type: "batch.failed", batch: failed });
      } finally {
        if (!finalized) {
          // WHY：SSE 消费者离开页面时生成器会被关闭；批次必须留下 stopped 事实，不能永久伪装 running。
          await datasets.finishBatch({ batchId: batch.id, status: "stopped",
            terminationReason: "operator_cancelled" }).catch(() => undefined);
        }
        await batchLease.release();
      }
    },
    resume: async function* (raw) {
      const request = startCrawlPlanSchema.parse({ expectedTaskRevision: raw.expectedTaskRevision,
        expectedPlanVersion: raw.expectedPlanVersion });
      const previous = await datasets.getRun(raw.runId);
      if (!previous || previous.run.taskId !== raw.taskId) {
        throw new SourceExecutionError("not_found", "待继续的来源运行不存在");
      }
      const plan = await planning.requireExecutablePlan({ taskId: raw.taskId,
        planId: previous.run.sourceCollectionPlanId ?? "", ...request });
      const source = requireResumableSource(plan, previous.run);
      const provider = resolve(source);
      requireNoExecutionBlockers(source);
      await preflightSource(source, provider);
      const preparedRun = await datasets.prepareRunForResume(previous.run.id);
      const queueRunId = await findResumeRootRunId(datasets, preparedRun);
      // WHY：恢复产生新 Source Run，但仍属于用户最初启动的同一批次；只继承批次关系，
      // 不修改旧运行和批次事实，确保 UI、导出与失败重试都能按一次抓取聚合。
      yield* executeSource(plan, source, provider, datasets, raw.signal,
        sourceProviderCollectionContextSchema.parse({ resumedFromRunId: preparedRun.id, queueRunId,
          accessPolicy: effectiveAccessPolicy(source) }), preparedRun.executionBatchId);
    },
  };
}

type ProviderReadiness = { status: "ready" } | { status: "failed"; reason: string };

function resolveExecutableSources(plan: CrawlPlan, resolve: (source: CrawlPlanSource) => SourceProvider) {
  return plan.content.sources.map((source) => {
    const provider = resolve(source);
    requireNoExecutionBlockers(source);
    return { source, provider, identity: `${provider.key}@${provider.version}` };
  });
}

async function* recordPreflightFailure(
  plan: CrawlPlan,
  source: CrawlPlanSource,
  provider: SourceProvider,
  datasets: SourceDatasetModule,
  reason: string,
  batchId: string,
): AsyncIterable<SourceRunEvent> {
  const run = await datasets.startRun({ taskId: plan.taskId, planId: plan.id, planVersion: plan.version,
    batchId,
    sourceKey: source.key, providerKey: provider.key, providerVersion: provider.version,
    requestBudget: source.stopPolicy.requestBudget, accessPolicy: effectiveAccessPolicy(source),
    targetKeys: source.targets.map((target) => target.key) });
  yield parseRunEvent({ type: "run.started", run });
  const states = new Map(source.targets.map((target) => [target.key,
    { status: "pending" as TargetState, accessibleCount: 0 }]));
  await closeOpenTargets(datasets, run.id, states, reason, false);
  const failed = await datasets.finishRun({ runId: run.id, status: "failed", terminationReason: reason });
  yield parseRunEvent({ type: "run.failed", run: failed });
}

async function* executeSource(
  plan: CrawlPlan,
  source: CrawlPlanSource,
  provider: SourceProvider,
  datasets: SourceDatasetModule,
  signal?: AbortSignal,
  collectionContext?: SourceProviderCollectionContext,
  batchId?: string,
): AsyncIterable<SourceRunEvent> {
  const run = await datasets.startRun({ taskId: plan.taskId, planId: plan.id, planVersion: plan.version,
    batchId,
    sourceKey: source.key, providerKey: provider.key, providerVersion: provider.version,
    requestBudget: source.stopPolicy.requestBudget, accessPolicy: effectiveAccessPolicy(source),
    targetKeys: source.targets.map((target) => target.key),
    resumedFromRunId: collectionContext?.resumedFromRunId });
  const lease = await datasets.acquireRunLease(run.id);
  try {
    yield parseRunEvent({ type: "run.started", run });
    const states = new Map(source.targets.map((target) => [target.key,
      { status: "pending" as TargetState, accessibleCount: 0 }]));
    try {
      // WHY：Provider 必须在任何网络工作入队前先持久化 Capture Work Item；因此 target 生命周期先于 collect 开启。
      for (const target of source.targets) {
        await ensureTargetRunning(datasets, run.id, target.key, states.get(target.key)!);
      }
      for await (const rawEvent of provider.collect(source, run.id, datasets, signal,
        collectionContext ?? { queueRunId: run.id, accessPolicy: effectiveAccessPolicy(source) })) {
      const event = sourceProviderEventSchema.parse(rawEvent);
      const state = requireTargetState(states, event.targetKey);
      if (event.type === "capture") {
        await ensureTargetRunning(datasets, run.id, event.targetKey, state);
        const view = await datasets.commitSnapshot({ ...event.snapshot, runId: run.id,
          targetKey: event.targetKey, assets: event.assets,
          resourceReferences: event.resourceReferences });
        if (event.snapshot.observation.state === "accessible"
          && event.snapshot.observation.contentAssessment?.status !== "rejected"
          && event.snapshot.observation.contentAssessment?.status !== "supporting") {
          state.accessibleCount += 1;
        }
        yield parseRunEvent({ type: "run.updated", run: view.run });
        if (event.snapshot.observation.state !== "accessible" && source.stopPolicy.stopOnAccessRestriction) {
          state.status = "failed";
          await datasets.finishTarget({ runId: run.id, targetKey: event.targetKey, status: "failed",
            terminationReason: event.snapshot.observation.state });
          await closeOpenTargets(datasets, run.id, states, event.snapshot.observation.state, false);
          const failed = await datasets.finishRun({ runId: run.id, status: "failed",
            terminationReason: event.snapshot.observation.state });
          yield parseRunEvent({ type: "run.failed", run: failed });
          return;
        }
        continue;
      }
      await ensureTargetRunning(datasets, run.id, event.targetKey, state);
      assertQuantityReached(source.targets, event.targetKey, state.accessibleCount);
      await datasets.finishTarget({ runId: run.id, targetKey: event.targetKey,
        status: "completed", terminationReason: "target_scope_completed" });
      state.status = "completed";
      const updated = await datasets.getRun(run.id);
      if (updated) yield parseRunEvent({ type: "run.updated", run: updated.run });
      }
      if (signal?.aborted) {
      await closeOpenTargets(datasets, run.id, states, "operator_cancelled", true);
      const stopped = await datasets.finishRun({ runId: run.id, status: "stopped",
        terminationReason: "operator_cancelled" });
      yield parseRunEvent({ type: "run.stopped", run: stopped });
      return;
      }
      if ([...states.values()].some((state) => state.status !== "completed")) {
      throw new Error("Provider 在全部 target 完成前结束");
      }
      const completed = await datasets.finishRun({ runId: run.id, status: "completed",
        terminationReason: "plan_scope_completed" });
      yield parseRunEvent({ type: "run.completed", run: completed });
    } catch (error) {
      const stopped = Boolean(signal?.aborted);
      const reason = stopped ? "operator_cancelled" : boundedMessage(error);
      await closeOpenTargets(datasets, run.id, states, reason, stopped);
      const failed = await datasets.finishRun({ runId: run.id, status: stopped ? "stopped" : "failed",
        terminationReason: reason });
      yield parseRunEvent({ type: stopped ? "run.stopped" : "run.failed", run: failed });
    }
  } finally { await lease.release(); }
}

function requireResumableSource(plan: CrawlPlan, run: SourceCollectionRun) {
  if (run.status === "completed") {
    throw new SourceExecutionError("invalid_state", "已完成的来源运行不能继续");
  }
  const source = plan.content.sources.find((item) => item.key === run.sourceCollectionPlanSourceKey);
  if (!source || source.provider.key !== run.providerKey || source.provider.version !== run.providerVersion
    || plan.version !== run.sourceCollectionPlanVersion) {
    throw new SourceExecutionError("revision_conflict", "前序运行与当前确认计划或 Provider 不一致");
  }
  return source;
}

async function findResumeRootRunId(datasets: SourceDatasetModule, run: SourceCollectionRun) {
  const seen = new Set<string>();
  let current = run;
  while (current.resumedFromRunId) {
    if (seen.has(current.id)) throw new SourceExecutionError("invalid_state", "Source Run 恢复链形成循环");
    seen.add(current.id);
    const parent = await datasets.getRun(current.resumedFromRunId);
    if (!parent) throw new SourceExecutionError("invalid_state", "Source Run 恢复链不完整");
    current = parent.run;
  }
  return current.id;
}

function resolveProvider(providers: ReadonlyMap<string, SourceProvider>, source: CrawlPlanSource) {
  const provider = providers.get(source.provider.key);
  if (!provider || provider.version !== source.provider.version) {
    throw new SourceExecutionError("invalid_state", `Provider 不可用：${source.provider.key}@${source.provider.version}`);
  }
  try {
    provider.validate(source);
  } catch (error) {
    throw new SourceExecutionError("invalid_state", boundedProviderError(source, error));
  }
  return provider;
}

async function preflightSource(source: CrawlPlanSource, provider: SourceProvider) {
  try {
    await provider.preflight(source);
  } catch (error) {
    throw new SourceExecutionError("preflight_failed", boundedProviderError(source, error));
  }
}

async function prepareSource(source: CrawlPlanSource, provider: SourceProvider) {
  try {
    if (provider.prepare) return sourcePreparationSchema.parse(await provider.prepare(source));
    await provider.preflight(source);
    return sourcePreparationSchema.parse({ status: "ready", message: `${source.name} 已通过运行准备检查。` });
  } catch (error) {
    throw new SourceExecutionError("preflight_failed", boundedProviderError(source, error));
  }
}

function requireNoExecutionBlockers(source: CrawlPlanSource) {
  if (source.executionBlockers.length > 0) {
    throw new SourceExecutionError("invalid_state", `来源仍有执行阻塞：${source.executionBlockers.join("；")}`);
  }
}

function effectiveAccessPolicy(source: CrawlPlanSource): SourceAccessPolicy {
  return {
    ...source.accessPolicy,
    jitterMs: { min: 0, max: 0 },
    batchSize: source.accessPolicy.maxRequestsPerMinute,
    batchCooldownMs: 60_000,
  };
}

type TargetState = "pending" | "running" | "completed" | "failed" | "stopped";

function requireTargetState(states: Map<string, { status: TargetState; accessibleCount: number }>, targetKey: string) {
  const state = states.get(targetKey);
  if (!state) throw new Error(`Provider 返回了计划外 target：${targetKey}`);
  if (state.status === "completed" || state.status === "failed" || state.status === "stopped") {
    throw new Error(`Provider 重复结束或写入 target：${targetKey}`);
  }
  return state;
}

async function ensureTargetRunning(
  datasets: SourceDatasetModule,
  runId: string,
  targetKey: string,
  state: { status: TargetState },
) {
  if (state.status === "pending") {
    await datasets.startTarget({ runId, targetKey });
    state.status = "running";
  }
}

function assertQuantityReached(targets: CrawlPlanTarget[], targetKey: string, accessibleCount: number) {
  const target = targets.find((item) => item.key === targetKey)!;
  if (target.quantity.mode !== "all_available" && accessibleCount !== target.quantity.targetCount) {
    throw new Error(`target 数量未对账：${targetKey} 计划 ${target.quantity.targetCount}，实际 ${accessibleCount}`);
  }
}

async function closeOpenTargets(
  datasets: SourceDatasetModule,
  runId: string,
  states: Map<string, { status: TargetState }>,
  reason: string,
  stopped: boolean,
) {
  for (const [targetKey, state] of states) {
    if (state.status === "completed" || state.status === "failed" || state.status === "stopped") continue;
    const status = state.status === "running" && !stopped ? "failed" : "stopped";
    await datasets.finishTarget({ runId, targetKey, status, terminationReason: reason });
    state.status = status;
  }
}

function parseRunEvent(event: SourceRunEvent) {
  return sourceRunEventSchema.parse(event);
}

function parseExecutionEvent(event: SourceExecutionEvent) {
  return sourceExecutionEventSchema.parse(event);
}

function countTerminal(event: SourceRunEvent, counts: { completed: number; failed: number; stopped: number }) {
  if (event.type === "run.completed") counts.completed += 1;
  else if (event.type === "run.failed") counts.failed += 1;
  else if (event.type === "run.stopped") counts.stopped += 1;
}

function batchOutcome(counts: { completed: number; failed: number; stopped: number }, total: number, aborted: boolean) {
  if (aborted || counts.stopped > 0) return { status: "stopped" as const,
    terminationReason: `${counts.completed}/${total} 个来源完成，批次已停止` };
  if (counts.completed === total) return { status: "completed" as const,
    terminationReason: `${total}/${total} 个来源完成` };
  if (counts.completed > 0) return { status: "partial" as const,
    terminationReason: `${counts.completed}/${total} 个来源完成，${counts.failed} 个来源失败` };
  return { status: "failed" as const, terminationReason: `0/${total} 个来源完成，${counts.failed} 个来源失败` };
}

function boundedProviderError(source: CrawlPlanSource, error: unknown) {
  return `${source.provider.key}@${source.provider.version}：${boundedMessage(error)}`;
}

function boundedMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_500) || "Provider 校验失败";
}
