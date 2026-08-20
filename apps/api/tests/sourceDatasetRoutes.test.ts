import { Readable } from "node:stream";

import Fastify from "fastify";
import type { SourceDatasetModule } from "@domain-analysis/workbench";
import { describe, expect, it, vi } from "vitest";

import { registerSourceDatasetRoutes } from "../src/routes/sourceDatasetRoutes";

describe("原始来源附件路由", () => {
  it("校验 task/run 归属后从本地资产存储下载原文", async () => {
    const openAsset = vi.fn().mockResolvedValue({
      asset: { filename: "国家标准 原文.pdf", mediaType: "application/pdf", bytes: 9 },
      content: Readable.from(["pdf-bytes"]),
    });
    const datasets = {
      getRun: vi.fn().mockResolvedValue({ run: { taskId: "task-1" }, targets: [], records: [] }),
      openAsset,
    } as unknown as SourceDatasetModule;
    const app = Fastify({ logger: false });
    await registerSourceDatasetRoutes(app, datasets);

    const response = await app.inject({
      method: "GET", url: "/api/capture-tasks/task-1/source-runs/run-1/assets/asset-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain(encodeURIComponent("国家标准 原文.pdf"));
    expect(response.body).toBe("pdf-bytes");
    expect(openAsset).toHaveBeenCalledWith({ runId: "run-1", assetId: "asset-1" });
    await app.close();
  });

  it("task 与 run 不匹配时不读取附件", async () => {
    const openAsset = vi.fn();
    const datasets = {
      getRun: vi.fn().mockResolvedValue({ run: { taskId: "other" } }), openAsset,
    } as unknown as SourceDatasetModule;
    const app = Fastify({ logger: false });
    await registerSourceDatasetRoutes(app, datasets);

    const response = await app.inject({
      method: "GET", url: "/api/capture-tasks/task-1/source-runs/run-1/assets/asset-1",
    });

    expect(response.statusCode).toBe(404);
    expect(openAsset).not.toHaveBeenCalled();
    await app.close();
  });
});
