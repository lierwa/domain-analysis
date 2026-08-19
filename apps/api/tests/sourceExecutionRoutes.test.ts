import { SourceExecutionError, type DataCollectionWorkbench, type SourceExecutionModule } from "@domain-analysis/workbench";
import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server";

describe("来源执行路由", () => {
  it("在 SSE 建立前把 Provider 预检失败返回为可读的 422", async () => {
    const execution = {
      start: async function* () {
        throw new SourceExecutionError("preflight_failed", "jd.catalog-product@1.0.0：CDP 未连接");
      },
    } as unknown as SourceExecutionModule;
    const workbench = {
      captureTasks: {}, sourceDatasets: {}, sourceExecution: execution, close: async () => undefined,
    } as unknown as DataCollectionWorkbench;
    const app = await buildServer({ logger: false, workbench });

    const response = await app.inject({
      method: "POST",
      url: "/api/capture-tasks/task-1/crawl-plans/plan-1/start",
      payload: { expectedTaskRevision: 1, expectedPlanVersion: 2 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: "preflight_failed", message: "jd.catalog-product@1.0.0：CDP 未连接",
    });
    await app.close();
  });
});
