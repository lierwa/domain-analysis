import type { SourceExecutionModule } from "@domain-analysis/workbench";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { makeWorkerUtils, run } from "graphile-worker";
import { createSourceExecutionQueue, createSourceExecutionTaskList } from "../src/sourceExecutionQueue";

vi.mock("graphile-worker", () => ({ makeWorkerUtils: vi.fn(), run: vi.fn() }));

describe("来源执行后台任务", () => {
  it("HTTP 返回后仍完整消费执行流，并把 commandId 传给领域幂等入口", async () => {
    const observed: string[] = [];
    const start = vi.fn(async function* () {
      observed.push("started");
      yield { type: "batch.started" } as never;
      observed.push("completed");
    });
    const execution = { start, resume: vi.fn() } as unknown as SourceExecutionModule;
    const task = Object.values(createSourceExecutionTaskList(execution))[0]!;

    await task({ kind: "start", commandId: "source-command-fixture", taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 2, expectedPlanVersion: 3 }, {} as never);

    expect(observed).toEqual(["started", "completed"]);
    expect(start).toHaveBeenCalledWith({ taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 2, expectedPlanVersion: 3, commandId: "source-command-fixture" });
  });

  it("后台任务完成后把瞬时失败交给持久自动恢复调度", async () => {
    const scheduleRecovery = vi.fn();
    const start = vi.fn(async function* () { yield { type: "batch.partial" } as never; });
    const execution = { start, resume: vi.fn() } as unknown as SourceExecutionModule;
    const taskList = createSourceExecutionTaskList(execution, scheduleRecovery);
    const task = Object.values(taskList)[0]!;
    const command = { kind: "start", commandId: "source-command-fixture", taskId: "task-1",
      planId: "plan-1", expectedTaskRevision: 2, expectedPlanVersion: 3 };

    await task(command, {} as never);

    expect(scheduleRecovery).toHaveBeenCalledWith(command);
  });

  it("Resume Worker 把 commandId 传给新 Run，供崩溃锁精确恢复", async () => {
    const resume = vi.fn(async function* () { yield { type: "run.started" } as never; });
    const execution = { start: vi.fn(), resume } as unknown as SourceExecutionModule;
    const task = Object.values(createSourceExecutionTaskList(execution))[0]!;

    await task({ kind: "resume", commandId: "source-command-resume", taskId: "task-1", runId: "run-1",
      expectedTaskRevision: 2, expectedPlanVersion: 3 }, {} as never);

    expect(resume).toHaveBeenCalledWith({ taskId: "task-1", runId: "run-1",
      expectedTaskRevision: 2, expectedPlanVersion: 3, commandId: "source-command-resume" });
  });

  it("enqueue 只把 revision body 交给 prepare，不把路由参数泄漏进严格 schema", async () => {
    const addJob = vi.fn().mockResolvedValue(undefined);
    vi.mocked(makeWorkerUtils).mockResolvedValue({ migrate: vi.fn(), addJob,
      release: vi.fn(), forceUnlockWorkers: vi.fn() } as never);
    vi.mocked(run).mockResolvedValue({ stop: vi.fn() } as never);
    const prepare = vi.fn().mockResolvedValue({ status: "ready", message: "ready" });
    const execution = { prepare } as unknown as SourceExecutionModule;
    const queue = await createSourceExecutionQueue({ connectionString: "postgresql://fixture", execution,
      pgPool: fakePool([]) });

    const accepted = await queue.enqueueStart({ taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 2, expectedPlanVersion: 3 });

    expect(accepted.status).toBe("accepted");
    expect(prepare).toHaveBeenCalledWith({ taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 2, expectedPlanVersion: 3 });
    expect(addJob).toHaveBeenCalledWith("execute_source_collection", expect.objectContaining({ kind: "start" }),
      expect.objectContaining({ jobKey: expect.any(String), maxAttempts: 1 }));
    await queue.close();
  });

  it("启动时只用官方接口释放已终态 Batch 或 Run 精确关联的崩溃 Worker 锁", async () => {
    const forceUnlockWorkers = vi.fn().mockResolvedValue(undefined);
    vi.mocked(makeWorkerUtils).mockResolvedValue({ migrate: vi.fn(), addJob: vi.fn(),
      release: vi.fn(), forceUnlockWorkers } as never);
    vi.mocked(run).mockResolvedValue({ stop: vi.fn() } as never);

    const query = vi.fn().mockResolvedValue({ rows: [{ locked_by: "pool-crashed" }] });
    const queue = await createSourceExecutionQueue({ connectionString: "postgresql://fixture",
      execution: {} as SourceExecutionModule,
      pgPool: { query, on: vi.fn(), end: vi.fn() } as unknown as Pool });

    expect(forceUnlockWorkers).toHaveBeenCalledWith(["pool-crashed"]);
    expect(query.mock.calls[0]?.[0]).toContain("runs.execution_command_id = jobs.key");
    expect(query.mock.calls[0]?.[1]).toEqual(["source_collection", "execute_source_collection"]);
    await queue.close();
  });

  it("启动时扫描未完成批次并用确定性 job key 投递自动 Resume", async () => {
    const addJob = vi.fn().mockResolvedValue(undefined);
    const forceUnlockWorkers = vi.fn().mockResolvedValue(undefined);
    vi.mocked(makeWorkerUtils).mockResolvedValue({ migrate: vi.fn(), addJob,
      release: vi.fn(), forceUnlockWorkers } as never);
    vi.mocked(run).mockResolvedValue({ stop: vi.fn() } as never);
    const request = { batchId: "batch-1", taskId: "task-1", runId: "run-failed",
      expectedTaskRevision: 2, expectedPlanVersion: 3, runAt: new Date("2026-08-31T00:01:00.000Z") };
    const automaticResumeRequests = vi.fn().mockResolvedValue([request]);
    const execution = { automaticResumeRequests } as unknown as SourceExecutionModule;
    const datasets = { listUnfinishedBatches: vi.fn().mockResolvedValue([{ id: "batch-1" }]) } as never;

    const queue = await createSourceExecutionQueue({ connectionString: "postgresql://fixture", execution,
      datasets, pgPool: fakePool([]) });

    expect(automaticResumeRequests).toHaveBeenCalledWith({ batchId: "batch-1" });
    expect(addJob).toHaveBeenCalledWith("execute_source_collection", expect.objectContaining({
      kind: "resume", commandId: "source-auto-resume-run-failed", runId: "run-failed",
    }), expect.objectContaining({ jobKey: "source-auto-resume-run-failed",
      jobKeyMode: "preserve_run_at", runAt: request.runAt, maxAttempts: 1 }));
    await queue.close();
  });
});

function fakePool(rows: Array<{ locked_by: string }>) {
  return { query: vi.fn().mockResolvedValue({ rows }), on: vi.fn(), end: vi.fn() } as unknown as Pool;
}
