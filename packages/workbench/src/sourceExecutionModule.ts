import type {
  CrawlPlanSource,
  SourceRunEvent,
  SourceSnapshotCommit,
} from "@domain-analysis/shared";
import { sourceRunEventSchema, startCrawlPlanSchema } from "@domain-analysis/shared";
import type { SourceDatasetModule } from "./sourceDatasetModule";
import type { CrawlPlanningModule } from "./crawlPlanningModule";

export interface SourceProvider {
  readonly key: string;
  readonly version: string;
  validate(source: CrawlPlanSource): void;
  preflight(source: CrawlPlanSource): Promise<void>;
  collect(source: CrawlPlanSource, runId: string, signal?: AbortSignal): AsyncIterable<Omit<SourceSnapshotCommit, "runId">>;
}

export interface SourceExecutionModule {
  start(input: { taskId: string; planId: string; expectedTaskRevision: number; expectedPlanVersion: number; signal?: AbortSignal }): AsyncIterable<SourceRunEvent>;
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
  const resolve = (source: CrawlPlanSource) => {
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
  };
  return {
    validateSource: (source) => { resolve(source); },
    start: async function* (raw) {
      const request = startCrawlPlanSchema.parse({ expectedTaskRevision: raw.expectedTaskRevision, expectedPlanVersion: raw.expectedPlanVersion });
      const view = await planning.get(raw.taskId);
      const plan = view?.plans.find((item) => item.id === raw.planId);
      if (!view || !plan) throw new SourceExecutionError("not_found", `已确认计划不存在：${raw.planId}`);
      if (plan.version !== request.expectedPlanVersion || plan.taskRevision !== request.expectedTaskRevision) {
        throw new SourceExecutionError("revision_conflict", "计划版本或任务范围已变化，请刷新后重试");
      }
      if (plan.status !== "confirmed") throw new SourceExecutionError("invalid_state", "只有当前已确认计划可以启动");
      for (const source of plan.content.sources) {
        const provider = resolve(source);
        if (source.executionBlockers.length > 0) {
          throw new SourceExecutionError("invalid_state", `来源仍有执行阻塞：${source.executionBlockers.join("；")}`);
        }
        try {
          await provider.preflight(source);
        } catch (error) {
          throw new SourceExecutionError("preflight_failed", boundedProviderError(source, error));
        }
      }
      for (const source of plan.content.sources) {
        const provider = resolve(source);
        const run = await datasets.startRun({ taskId: plan.taskId, planId: plan.id, sourceKey: source.key,
          providerKey: provider.key, accessPolicy: { ...source.accessPolicy, jitterMs: { min: 0, max: 0 }, batchSize: 1, batchCooldownMs: 1 } });
        yield sourceRunEventSchema.parse({ type: "run.started", run });
        try {
          for await (const observation of provider.collect(source, run.id, raw.signal)) {
            const view = await datasets.commitSnapshot({ ...observation, runId: run.id });
            yield sourceRunEventSchema.parse({ type: "run.updated", run: view.run });
            if (observation.observation.state !== "accessible" && source.stopPolicy.stopOnAccessRestriction) {
              const stopped = await datasets.finishRun({ runId: run.id, status: "failed", terminationReason: observation.observation.state });
              yield sourceRunEventSchema.parse({ type: "run.failed", run: stopped });
              break;
            }
          }
          const current = await datasets.getRun(run.id);
          if (current?.run.status === "running") {
            const completed = await datasets.finishRun({ runId: run.id, status: raw.signal?.aborted ? "stopped" : "completed",
              terminationReason: raw.signal?.aborted ? "operator_cancelled" : "plan_scope_completed" });
            yield sourceRunEventSchema.parse({ type: raw.signal?.aborted ? "run.stopped" : "run.completed", run: completed });
          }
        } catch (error) {
          const failed = await datasets.finishRun({ runId: run.id, status: raw.signal?.aborted ? "stopped" : "failed",
            terminationReason: error instanceof Error ? error.message : String(error) });
          yield sourceRunEventSchema.parse({ type: raw.signal?.aborted ? "run.stopped" : "run.failed", run: failed });
        }
      }
    },
  };
}

function boundedProviderError(source: CrawlPlanSource, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `${source.provider.key}@${source.provider.version}：${message.slice(0, 1_500) || "Provider 校验失败"}`;
}
