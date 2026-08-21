import type { SourceExecutionModule } from "@domain-analysis/workbench";
import { describe, expect, it, vi } from "vitest";

import { createSourceExecutionTaskList } from "../src/sourceExecutionQueue";

describe("后台来源执行任务边界", () => {
  it("完整消费 Start 领域流且不注入浏览器 AbortSignal", async () => {
    const consumed: string[] = [];
    const start = vi.fn(() => (async function* () {
      consumed.push("started");
      yield { type: "fixture" };
      await Promise.resolve();
      consumed.push("completed");
    })());
    const tasks = createSourceExecutionTaskList({ start } as unknown as SourceExecutionModule);

    await tasks.execute_source_collection!({ kind: "start", commandId: "source-command-1",
      taskId: "task-1", planId: "plan-1", expectedTaskRevision: 1, expectedPlanVersion: 2 }, {} as never);

    expect(consumed).toEqual(["started", "completed"]);
    expect(start).toHaveBeenCalledWith({ taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 1, expectedPlanVersion: 2 });
  });

  it("非法持久 payload 在外部 seam 失败，不进入 Source Execution", async () => {
    const start = vi.fn();
    const resume = vi.fn();
    const tasks = createSourceExecutionTaskList({ start, resume } as unknown as SourceExecutionModule);

    await expect(tasks.execute_source_collection!({ kind: "start", commandId: "source-command-1",
      taskId: "task-1", planId: "plan-1", expectedTaskRevision: 0, expectedPlanVersion: 2 }, {} as never))
      .rejects.toThrow();
    expect(start).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
});
