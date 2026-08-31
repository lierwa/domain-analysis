import { Readable } from "node:stream";

import { sourceCaptureResourceKindSchema, sourceDatasetRecordGroupKeySchema } from "@domain-analysis/shared";
import type { SourceDatasetModule } from "@domain-analysis/workbench";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const taskParamsSchema = z.object({ taskId: z.string().min(1) }).strict();
const runParamsSchema = taskParamsSchema.extend({ runId: z.string().min(1) }).strict();
const assetParamsSchema = runParamsSchema.extend({ assetId: z.string().min(1) }).strict();
const assetQuerySchema = z.object({ disposition: z.enum(["inline", "attachment"]).default("attachment") }).strict();
const exportQuerySchema = z.object({ format: z.enum(["jsonl", "csv"]).default("jsonl") }).strict();
const lineageRecordPageQuerySchema = z.object({
  sourceKey: z.string().min(1).max(240),
  targetKey: z.string().min(1).max(240),
  groupKey: sourceDatasetRecordGroupKeySchema,
  cursor: z.string().min(1).max(2_000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
}).strict();
const subjectRecordPageQuerySchema = z.object({
  subjectId: z.string().min(1).max(240),
  resourceKind: sourceCaptureResourceKindSchema,
  cursor: z.string().min(1).max(2_000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
}).strict();
const recordPageQuerySchema = z.union([lineageRecordPageQuerySchema, subjectRecordPageQuerySchema]);

export async function registerSourceDatasetRoutes(app: FastifyInstance, datasets: SourceDatasetModule) {
  app.get("/api/capture-tasks/:taskId/source-runs", async (request) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    return { item: await datasets.listTask(taskId) };
  });
  app.get("/api/capture-tasks/:taskId/source-map/records", async (request) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const query = recordPageQuerySchema.parse(request.query);
    return { item: await datasets.listTaskRecords({ taskId, ...query }) };
  });
  app.get("/api/capture-tasks/:taskId/source-runs/:runId", async (request, reply) => {
    const { taskId, runId } = runParamsSchema.parse(request.params);
    const item = await datasets.getRunAudit(runId);
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
    const { disposition } = assetQuerySchema.parse(request.query);
    const item = await datasets.getRun(runId);
    if (!item || item.run.taskId !== taskId) {
      return reply.status(404).send({ error: "run_not_found", message: "原始数据运行不存在" });
    }
    const { asset, content } = await datasets.openAsset({ runId, assetId });
    const mediaType = safeMediaType(asset.mediaType);
    const inline = disposition === "inline" && safeInlineImageTypes.has(mediaType);
    reply.header("Content-Type", mediaType);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Length", String(asset.bytes));
    reply.header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`);
    return reply.send(content);
  });
}

const safeInlineImageTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
]);

function safeMediaType(value: string) {
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value)
    ? value
    : "application/octet-stream";
}
