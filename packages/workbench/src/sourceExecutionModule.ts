import type {
  CrawlPlan,
  CrawlPlanSource,
  CrawlPlanTarget,
  SourcePreparation,
  SourceProviderEvent,
  SourceRunEvent,
} from "@domain-analysis/shared";
import {
  sourcePreparationSchema,
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
  beginExecution?(input: { executionKey: string; sources: readonly CrawlPlanSource[] }): Promise<void> | void;
  endExecution?(executionKey: string): Promise<void> | void;
  prepare?(source: CrawlPlanSource): Promise<SourcePreparation>;
  preflight(source: CrawlPlanSource): Promise<void>;
  collect(source: CrawlPlanSource, runId: string, signal?: AbortSignal): AsyncIterable<SourceProviderEvent>;
  close?(): Promise<void>;
}

export interface SourceExecutionModule {
  prepare(input: { taskId: string; planId: string; expectedTaskRevision: number;
    expectedPlanVersion: number }): Promise<SourcePreparation>;
  start(input: { taskId: string; planId: string; expectedTaskRevision: number;
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
      const view = await planning.get(raw.taskId);
      const plan = view?.plans.find((item) => item.id === raw.planId);
      requireExecutablePlan(view, plan, request);
      const scopes = providerScopes(plan, resolve);
      await beginProviderScopes(plan, scopes);
      for (const scope of scopes) {
        const result = await prepareSource(scope.sources[0]!, scope.provider);
        if (result.status === "action_required") return result;
      }
      return sourcePreparationSchema.parse({ status: "ready", message: "抓取环境已准备完成，可以开始抓取。" });
    },
    start: async function* (raw) {
      const request = startCrawlPlanSchema.parse({ expectedTaskRevision: raw.expectedTaskRevision,
        expectedPlanVersion: raw.expectedPlanVersion });
      const view = await planning.get(raw.taskId);
      const plan = view?.plans.find((item) => item.id === raw.planId);
      requireExecutablePlan(view, plan, request);
      const scopes = providerScopes(plan, resolve);
      const executionKey = planExecutionKey(plan);
      try {
        await beginProviderScopes(plan, scopes);
        for (const scope of scopes) {
          // WHY：浏览器和登录是 Provider 会话级准备；来源仍逐项 validate，但 Start 只做一次站点 preflight。
          await preflightSource(scope.sources[0]!, scope.provider);
        }
        const stoppedProviders = new Map<string, string>();
        for (const source of plan.content.sources) {
          if (raw.signal?.aborted) return;
          const provider = resolve(source);
          const identity = providerIdentity(provider);
          const blockedBy = stoppedProviders.get(identity);
          if (blockedBy) {
            yield* stopSource(plan, source, provider, datasets, `provider_access_surface_stopped:${blockedBy}`);
            continue;
          }
          const accessRestriction = yield* executeSource(plan, source, provider, datasets, raw.signal);
          if (accessRestriction) stoppedProviders.set(identity, accessRestriction);
        }
      } finally {
        await endProviderScopes(executionKey, scopes);
      }
    },
  };
}

async function* executeSource(
  plan: CrawlPlan,
  source: CrawlPlanSource,
  provider: SourceProvider,
  datasets: SourceDatasetModule,
  signal?: AbortSignal,
): AsyncGenerator<SourceRunEvent, string | undefined> {
  const run = await datasets.startRun({ taskId: plan.taskId, planId: plan.id, planVersion: plan.version,
    sourceKey: source.key, providerKey: provider.key, providerVersion: provider.version,
    accessPolicy: effectiveAccessPolicy(source), targetKeys: source.targets.map((target) => target.key) });
  yield parseRunEvent({ type: "run.started", run });
  const states = new Map(source.targets.map((target) => [target.key,
    { status: "pending" as TargetState, accessibleCount: 0 }]));
  try {
    for await (const rawEvent of provider.collect(source, run.id, signal)) {
      const event = sourceProviderEventSchema.parse(rawEvent);
      const state = requireTargetState(states, event.targetKey);
      if (event.type === "capture") {
        await ensureTargetRunning(datasets, run.id, event.targetKey, state);
        const view = await datasets.commitSnapshot({ ...event.snapshot, runId: run.id,
          targetKey: event.targetKey, assets: event.assets });
        if (event.snapshot.observation.state === "accessible") state.accessibleCount += 1;
        yield parseRunEvent({ type: "run.updated", run: view.run });
        if (event.snapshot.observation.state !== "accessible" && source.stopPolicy.stopOnAccessRestriction) {
          state.status = "failed";
          await datasets.finishTarget({ runId: run.id, targetKey: event.targetKey, status: "failed",
            terminationReason: event.snapshot.observation.state });
          await closeOpenTargets(datasets, run.id, states, event.snapshot.observation.state, false);
          const failed = await datasets.finishRun({ runId: run.id, status: "failed",
            terminationReason: event.snapshot.observation.state });
          yield parseRunEvent({ type: "run.failed", run: failed });
          return blocksProviderAccessSurface(event.snapshot.observation.state)
            ? event.snapshot.observation.state
            : undefined;
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
    return undefined;
  } catch (error) {
    const stopped = Boolean(signal?.aborted);
    const reason = stopped ? "operator_cancelled" : boundedMessage(error);
    await closeOpenTargets(datasets, run.id, states, reason, stopped);
    const failed = await datasets.finishRun({ runId: run.id, status: stopped ? "stopped" : "failed",
      terminationReason: reason });
    yield parseRunEvent({ type: stopped ? "run.stopped" : "run.failed", run: failed });
    return undefined;
  }
}

async function* stopSource(
  plan: CrawlPlan,
  source: CrawlPlanSource,
  provider: SourceProvider,
  datasets: SourceDatasetModule,
  reason: string,
): AsyncGenerator<SourceRunEvent> {
  const run = await datasets.startRun({ taskId: plan.taskId, planId: plan.id, planVersion: plan.version,
    sourceKey: source.key, providerKey: provider.key, providerVersion: provider.version,
    accessPolicy: effectiveAccessPolicy(source), targetKeys: source.targets.map((target) => target.key) });
  yield parseRunEvent({ type: "run.started", run });
  for (const target of source.targets) {
    await datasets.finishTarget({ runId: run.id, targetKey: target.key, status: "stopped",
      terminationReason: reason });
  }
  const stopped = await datasets.finishRun({ runId: run.id, status: "stopped", terminationReason: reason });
  yield parseRunEvent({ type: "run.stopped", run: stopped });
}

interface ProviderScope {
  identity: string;
  provider: SourceProvider;
  sources: CrawlPlanSource[];
}

function providerScopes(plan: CrawlPlan, resolve: (source: CrawlPlanSource) => SourceProvider) {
  const scopes = new Map<string, ProviderScope>();
  for (const source of plan.content.sources) {
    requireNoExecutionBlockers(source);
    const provider = resolve(source);
    const identity = providerIdentity(provider);
    const scope = scopes.get(identity) ?? { identity, provider, sources: [] };
    scope.sources.push(source);
    scopes.set(identity, scope);
  }
  return [...scopes.values()];
}

async function beginProviderScopes(plan: CrawlPlan, scopes: readonly ProviderScope[]) {
  const executionKey = planExecutionKey(plan);
  for (const scope of scopes) {
    await scope.provider.beginExecution?.({ executionKey, sources: scope.sources });
  }
}

async function endProviderScopes(executionKey: string, scopes: readonly ProviderScope[]) {
  for (const scope of scopes) await scope.provider.endExecution?.(executionKey);
}

function planExecutionKey(plan: CrawlPlan) {
  return `${plan.taskId}:${plan.id}:v${plan.version}`;
}

function providerIdentity(provider: SourceProvider) {
  return `${provider.key}@${provider.version}`;
}

function blocksProviderAccessSurface(state: string) {
  return state === "login_required" || state === "verification_required"
    || state === "access_denied" || state === "rate_limited";
}

function requireExecutablePlan(
  view: Awaited<ReturnType<CrawlPlanningModule["get"]>>,
  plan: CrawlPlan | undefined,
  request: { expectedTaskRevision: number; expectedPlanVersion: number },
): asserts plan is CrawlPlan {
  if (!view || !plan) throw new SourceExecutionError("not_found", "已确认计划不存在");
  if (plan.version !== request.expectedPlanVersion || plan.taskRevision !== request.expectedTaskRevision
    || view.taskRevision !== request.expectedTaskRevision) {
    throw new SourceExecutionError("revision_conflict", "计划版本或任务范围已变化，请刷新后重试");
  }
  if (plan.status !== "confirmed") throw new SourceExecutionError("invalid_state", "只有当前已确认计划可以启动");
  if (plan.content.executionChecklistVersion !== 2
    || plan.content.sources.some((source) => source.targets.some((target) => target.providerConfiguration.length === 0))) {
    throw new SourceExecutionError("invalid_state", "该计划不是当前完整执行清单，请重新规划并确认");
  }
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

function effectiveAccessPolicy(source: CrawlPlanSource) {
  return { ...source.accessPolicy, jitterMs: { min: 0, max: 0 }, batchSize: 1, batchCooldownMs: 1 };
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

function boundedProviderError(source: CrawlPlanSource, error: unknown) {
  return `${source.provider.key}@${source.provider.version}：${boundedMessage(error)}`;
}

function boundedMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_500) || "Provider 校验失败";
}
