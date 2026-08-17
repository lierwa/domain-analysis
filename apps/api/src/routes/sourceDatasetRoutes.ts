import { Readable } from "node:stream";

import { sourceEvidenceSelectionSchema } from "@domain-analysis/shared";
import type { SourceDatasetModule, SourceEvidenceModule } from "@domain-analysis/workbench";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const projectParamsSchema = z.object({ projectId: z.string().min(1) }).strict();
const runParamsSchema = projectParamsSchema.extend({ runId: z.string().min(1) }).strict();
const exportQuerySchema = z.object({ format: z.enum(["jsonl", "csv"]).default("jsonl") }).strict();
const snapshotParamsSchema = projectParamsSchema.extend({ snapshotId: z.string().min(1) }).strict();
const materializeBodySchema = z.object({
  requestId: z.string().min(1),
  selection: sourceEvidenceSelectionSchema,
}).strict();

export async function registerSourceDatasetRoutes(
  app: FastifyInstance,
  sourceDatasets: SourceDatasetModule,
  sourceEvidence?: SourceEvidenceModule,
) {
  app.get("/api/product-projects/:projectId/source-runs", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return { items: await sourceDatasets.listProject(projectId) };
  });

  app.get("/api/product-projects/:projectId/source-runs/:runId", async (request, reply) => {
    const { projectId, runId } = runParamsSchema.parse(request.params);
    const item = await sourceDatasets.getRun(runId);
    if (!item || item.run.projectId !== projectId) {
      return reply.status(404).send({ error: "run_not_found", message: "来源运行不存在" });
    }
    return { item };
  });

  app.get(
    "/api/product-projects/:projectId/source-runs/:runId/export",
    async (request, reply) => {
      const { projectId, runId } = runParamsSchema.parse(request.params);
      const { format } = exportQuerySchema.parse(request.query);
      const item = await sourceDatasets.getRun(runId);
      if (!item || item.run.projectId !== projectId) {
        return reply.status(404).send({ error: "run_not_found", message: "来源运行不存在" });
      }
      const mediaType = format === "jsonl"
        ? "application/x-ndjson; charset=utf-8"
        : "text/csv; charset=utf-8";
      reply.header("Content-Type", mediaType);
      reply.header("Content-Disposition", `attachment; filename=source-run.${format}`);
      return reply.send(Readable.from(sourceDatasets.exportRun({ runId, format })));
    },
  );

  if (sourceEvidence) {
    app.post("/api/product-projects/:projectId/source-snapshots/:snapshotId/evidence", async (request, reply) => {
      const { projectId, snapshotId } = snapshotParamsSchema.parse(request.params);
      const snapshot = await sourceDatasets.getSnapshot(snapshotId);
      if (!snapshot || snapshot.object.projectId !== projectId) {
        return reply.status(404).send({ error: "snapshot_not_found", message: "来源快照不存在" });
      }
      const body = materializeBodySchema.parse(request.body);
      const item = await sourceEvidence.materialize({ snapshotId, ...body });
      return reply.status(201).send({ item });
    });
  }

}
