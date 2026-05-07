export interface SchedulerTickDeps {
  listDuePlans(nowIso: string, limit: number): Promise<Array<{ id: string }>>;
  createScheduledRun(planId: string): Promise<{ id: string }>;
  startRun(runId: string): Promise<unknown>;
  nowIso: string;
  limit: number;
}

export async function runSchedulerTick(deps: SchedulerTickDeps) {
  const duePlans = await deps.listDuePlans(deps.nowIso, deps.limit);
  let createdRuns = 0;

  for (const plan of duePlans) {
    const run = await deps.createScheduledRun(plan.id);
    await deps.startRun(run.id);
    createdRuns += 1;
  }

  return { checkedPlans: duePlans.length, createdRuns };
}

export interface SchedulerLoopOptions {
  intervalMs: number;
  stopSignal?: AbortSignal;
  tick(): Promise<unknown>;
  onError(error: unknown): void;
}

export function startSchedulerLoop(options: SchedulerLoopOptions) {
  const timer = setInterval(() => {
    if (options.stopSignal?.aborted) {
      clearInterval(timer);
      return;
    }
    void options.tick().catch(options.onError);
  }, options.intervalMs);

  return () => clearInterval(timer);
}
