import { crawlPlanningEventSchema, type CrawlPlanningView } from "@domain-analysis/shared";
import type { CrawlPlanningModule } from "@domain-analysis/workbench";
import { FastifySSEPlugin } from "fastify-sse-v2";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerCrawlPlanningRoutes } from "../src/routes/crawlPlanningRoutes";

describe("抓取计划路由", () => {
  it("把运行请求转换为 SSE，并把 task revision 交给领域模块", async () => {
    const run = vi.fn((input: Parameters<CrawlPlanningModule["run"]>[0]) => streamStarted(input.taskId));
    const planning = { run } as unknown as CrawlPlanningModule;
    const app = Fastify({ logger: false });
    await app.register(FastifySSEPlugin, { retryDelay: false });
    await registerCrawlPlanningRoutes(app, planning);

    const response = await app.inject({
      method: "POST",
      url: "/api/capture-tasks/task-1/crawl-planning/runs",
      payload: { expectedTaskRevision: 3, instruction: "评价只取样本" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("event: run.started");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1", expectedTaskRevision: 3, instruction: "评价只取样本",
    }));
    await app.close();
  });

  it("确认计划时只调用确认门并返回最新视图", async () => {
    const view = emptyView();
    const confirm = vi.fn().mockResolvedValue(view);
    const planning = { confirm } as unknown as CrawlPlanningModule;
    const app = Fastify({ logger: false });
    await registerCrawlPlanningRoutes(app, planning);

    const response = await app.inject({
      method: "POST",
      url: "/api/capture-tasks/task-1/crawl-plans/plan-2/confirm",
      payload: { expectedTaskRevision: 3 },
    });

    expect(response.statusCode).toBe(200);
    expect(confirm).toHaveBeenCalledWith({ taskId: "task-1", planId: "plan-2", expectedTaskRevision: 3 });
    expect(response.json()).toEqual({ item: view });
    await app.close();
  });
});

async function* streamStarted(taskId: string) {
  yield crawlPlanningEventSchema.parse({ type: "run.started", taskId, runId: "run-1" });
}

function emptyView(): CrawlPlanningView {
  return { taskId: "task-1", taskRevision: 3, runs: [], plans: [] };
}
