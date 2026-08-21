import { defaultWorkbenchDatabaseUrl } from "@domain-analysis/db";
import type { DataCollectionWorkbench, SourceExecutionModule } from "@domain-analysis/workbench";
import { describe, expect, it, vi } from "vitest";

import { buildServer } from "../src/server";
import { createSourceExecutionQueue } from "../src/sourceExecutionQueue";

const integration = process.env.RUN_SOURCE_EXECUTION_QUEUE === "1" ? describe : describe.skip;

integration("Graphile 后台来源执行", () => {
  it("HTTP 202 响应结束后仍由服务端消费完整抓取流", async () => {
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    let completed = false;
    const execution = {
      prepare: vi.fn(async () => ({ status: "ready", message: "fixture ready" })),
      start: vi.fn(() => (async function* () {
        yield { type: "fixture.started" };
        await new Promise((resolve) => setTimeout(resolve, 300));
        completed = true;
        yield { type: "fixture.completed" };
      })()),
    } as unknown as SourceExecutionModule;
    const queue = await createSourceExecutionQueue({
      connectionString: process.env.POSTGRES_DATABASE_URL ?? defaultWorkbenchDatabaseUrl,
      execution,
      // WHY：开发 API 可能正在运行真实长批次；测试必须使用独立 task 名，避免被生产 worker 领取。
      taskIdentifier: `execute_source_collection_test_${suffix}`,
      queueIdentifier: `source_collection_test_${suffix}`,
    });
    const workbench = { captureTasks: {}, sourceDatasets: {}, sourceExecution: execution,
      close: async () => undefined } as unknown as DataCollectionWorkbench;
    const app = await buildServer({ logger: false, workbench, sourceExecutionQueue: queue });
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });

    try {
      const startedAt = Date.now();
      const response = await fetch(`${origin}/api/capture-tasks/task-1/crawl-plans/plan-1/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Connection: "close" },
        body: JSON.stringify({ expectedTaskRevision: 1, expectedPlanVersion: 2 }),
      });
      const acceptedMs = Date.now() - startedAt;
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(202);
      expect(acceptedMs).toBeLessThan(250);
      expect(completed).toBe(false);
      await waitFor(() => completed);
      expect(execution.start).toHaveBeenCalledWith({ taskId: "task-1", planId: "plan-1",
        expectedTaskRevision: 1, expectedPlanVersion: 2 });
    } finally {
      await app.close();
    }
  }, 10_000);
});

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("后台任务未在 5 秒内完成");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
