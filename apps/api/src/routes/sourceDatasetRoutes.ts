import { Readable } from "node:stream";

import type { SourceDatasetModule } from "@domain-analysis/workbench";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const taskParamsSchema = z.object({ taskId: z.string().min(1) }).strict();
const runParamsSchema = taskParamsSchema.extend({ runId: z.string().min(1) }).strict();
const assetParamsSchema = runParamsSchema.extend({ assetId: z.string().min(1) }).strict();
const exportQuerySchema = z.object({ format: z.enum(["jsonl", "csv"]).default("jsonl") }).strict();

export async function registerSourceDatasetRoutes(app: FastifyInstance, datasets: SourceDatasetModule) {
  app.get("/api/capture-tasks/:taskId/source-runs", async (request) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    return { item: await datasets.listTask(taskId) };
  });
  app.get("/api/capture-tasks/:taskId/source-runs/:runId", async (request, reply) => {
    const { taskId, runId } = runParamsSchema.parse(request.params);
    const item = await datasets.getRun(runId);
    if (!item || item.run.taskId !== taskId) {
      return reply.status(404).send({ error: "run_not_found", message: "原始数据运行不存在" });
    }
    return { item };
  });
  app.get("/api/capture-tasks/:taskId/source-runs/:runId/export", async (request, reply) => {
    const { taskId, runId } = runParamsSchema.parse(request.params);
    const { format } = exportQuerySchema.parse(request.query);
    const item = await datasets.getRun(runId);
    if (!item || item.run.taskId !== taskId) {
      return reply.status(404).send({ error: "run_not_found", message: "原始数据运行不存在" });
    }
    reply.header("Content-Type", format === "jsonl"
      ? "application/x-ndjson; charset=utf-8"
      : "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename=raw-source-run.${format}`);
    return reply.send(Readable.from(datasets.exportRun({ runId, format })));
  });
  app.get("/api/capture-tasks/:taskId/source-runs/:runId/assets/:assetId", async (request, reply) => {
    const { taskId, runId, assetId } = assetParamsSchema.parse(request.params);
    const item = await datasets.getRun(runId);
    if (!item || item.run.taskId !== taskId) {
      return reply.status(404).send({ error: "run_not_found", message: "原始数据运行不存在" });
    }
    const { asset, content } = await datasets.openAsset({ runId, assetId });
    reply.header("Content-Type", safeMediaType(asset.mediaType));
    reply.header("Content-Length", String(asset.bytes));
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(asset.filename)}`);
    return reply.send(content);
  });
}

function safeMediaType(value: string) {
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value)
    ? value
    : "application/octet-stream";
}
