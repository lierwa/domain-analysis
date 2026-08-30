import { Readable } from "node:stream";

import Fastify from "fastify";
import type { SourceDatasetModule } from "@domain-analysis/workbench";
import { describe, expect, it, vi } from "vitest";

import { registerSourceDatasetRoutes } from "../src/routes/sourceDatasetRoutes";

describe("原始来源附件路由", () => {
  it("分页读取任务聚合地图中的单条记录", async () => {
    const listTaskRecords = vi.fn().mockResolvedValue({ items: [], totalCount: 0 });
    const datasets = { listTaskRecords } as unknown as SourceDatasetModule;
    const app = Fastify({ logger: false });
    await registerSourceDatasetRoutes(app, datasets);

    const response = await app.inject({ method: "GET",
      url: "/api/capture-tasks/task-1/source-map/records?sourceKey=zol.catalog&targetKey=market.catalog&groupKey=html_link%3A1&limit=30" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { items: [], totalCount: 0 } });
    expect(listTaskRecords).toHaveBeenCalledWith({ taskId: "task-1", sourceKey: "zol.catalog",
      targetKey: "market.catalog", groupKey: "html_link:1", limit: 30 });
    await app.close();
  });

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

  it("只允许安全栅格图片以内联方式预览，并声明 nosniff", async () => {
    const openAsset = vi.fn().mockResolvedValue({
      asset: { filename: "front.jpg", mediaType: "image/jpeg", bytes: 4 },
      content: Readable.from([Buffer.from([0xff, 0xd8, 0xff, 0xd9])]),
    });
    const datasets = {
      getRun: vi.fn().mockResolvedValue({ run: { taskId: "task-1" }, targets: [], records: [] }),
      openAsset,
    } as unknown as SourceDatasetModule;
    const app = Fastify({ logger: false });
    await registerSourceDatasetRoutes(app, datasets);

    const response = await app.inject({ method: "GET",
      url: "/api/capture-tasks/task-1/source-runs/run-1/assets/asset-1?disposition=inline" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toContain("inline");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    await app.close();
  });

  it("SVG 即使请求 inline 也强制下载", async () => {
    const datasets = {
      getRun: vi.fn().mockResolvedValue({ run: { taskId: "task-1" }, targets: [], records: [] }),
      openAsset: vi.fn().mockResolvedValue({ asset: { filename: "unsafe.svg", mediaType: "image/svg+xml", bytes: 6 },
        content: Readable.from(["<svg/>"]) }),
    } as unknown as SourceDatasetModule;
    const app = Fastify({ logger: false });
    await registerSourceDatasetRoutes(app, datasets);

    const response = await app.inject({ method: "GET",
      url: "/api/capture-tasks/task-1/source-runs/run-1/assets/asset-1?disposition=inline" });

    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    await app.close();
  });
});
