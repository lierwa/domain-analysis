import { type DataCollectionWorkbench, type SourceExecutionModule } from "@domain-analysis/workbench";
import { describe, expect, it, vi } from "vitest";

import { buildServer } from "../src/server";
import type { SourceExecutionQueue } from "../src/sourceExecutionQueue";

describe("来源执行路由", () => {
  it("确认后的准备接口返回人工登录动作且不建立 SSE", async () => {
    const execution = {
      prepare: async () => ({ status: "action_required", action: "login_required",
        sourceKey: "jd.refrigerator", message: "请扫码登录后重新检查" }),
    } as unknown as SourceExecutionModule;
    const workbench = {
      captureTasks: {}, sourceDatasets: {}, sourceExecution: execution, close: async () => undefined,
    } as unknown as DataCollectionWorkbench;
    const queue = { close: async () => undefined } as unknown as SourceExecutionQueue;
    const app = await buildServer({ logger: false, workbench, sourceExecutionQueue: queue });

    const response = await app.inject({
      method: "POST",
      url: "/api/capture-tasks/task-1/crawl-plans/plan-1/prepare",
      payload: { expectedTaskRevision: 1, expectedPlanVersion: 2 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { status: "action_required", action: "login_required",
      sourceKey: "jd.refrigerator", message: "请扫码登录后重新检查" } });
    await app.close();
  });

  it("Start 只提交后台命令并立即返回 202，不在 HTTP 请求内消费抓取流", async () => {
    const start = vi.fn();
    const execution = { start } as unknown as SourceExecutionModule;
    const enqueueStart = vi.fn(async () => ({ status: "accepted" as const, commandId: "source-command-1" }));
    const queue = { enqueueStart, close: async () => undefined } as unknown as SourceExecutionQueue;
    const workbench = {
      captureTasks: {}, sourceDatasets: {}, sourceExecution: execution, close: async () => undefined,
    } as unknown as DataCollectionWorkbench;
    const app = await buildServer({ logger: false, workbench, sourceExecutionQueue: queue });

    const response = await app.inject({
      method: "POST",
      url: "/api/capture-tasks/task-1/crawl-plans/plan-1/start",
      payload: { expectedTaskRevision: 1, expectedPlanVersion: 2 },
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({ item: { status: "accepted", commandId: "source-command-1" } });
    expect(enqueueStart).toHaveBeenCalledWith({ taskId: "task-1", planId: "plan-1",
      expectedTaskRevision: 1, expectedPlanVersion: 2 });
    expect(start).not.toHaveBeenCalled();
    await app.close();
  });

  it("显式 Resume 也只提交后台命令，页面离开不会取消继续任务", async () => {
    const resume = vi.fn();
    const execution = { resume } as unknown as SourceExecutionModule;
    const enqueueResume = vi.fn(async () => ({ status: "accepted" as const,
      commandId: "source-command-resume-1" }));
    const queue = { enqueueResume, close: async () => undefined } as unknown as SourceExecutionQueue;
    const workbench = { captureTasks: {}, sourceDatasets: {}, sourceExecution: execution,
      close: async () => undefined } as unknown as DataCollectionWorkbench;
    const app = await buildServer({ logger: false, workbench, sourceExecutionQueue: queue });

    const response = await app.inject({ method: "POST",
      url: "/api/capture-tasks/task-1/source-runs/run-old/resume",
      payload: { expectedTaskRevision: 1, expectedPlanVersion: 2 } });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ item: { status: "accepted", commandId: "source-command-resume-1" } });
    expect(enqueueResume).toHaveBeenCalledWith({ taskId: "task-1", runId: "run-old",
      expectedTaskRevision: 1, expectedPlanVersion: 2 });
    expect(resume).not.toHaveBeenCalled();
    await app.close();
  });
});
