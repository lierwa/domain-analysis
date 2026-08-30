import {
  sourceExecutionAcceptanceSchema,
  sourceExecutionPlanRequestSchema,
  sourcePreparationSchema,
} from "@domain-analysis/shared";
import type { SourceExecutionModule } from "@domain-analysis/workbench";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { SourceExecutionQueue } from "../sourceExecutionQueue";

const planParamsSchema = z.object({ taskId: z.string().min(1), planId: z.string().min(1) }).strict();
const runParamsSchema = z.object({ taskId: z.string().min(1), runId: z.string().min(1) }).strict();

export async function registerSourceExecutionRoutes(
  app: FastifyInstance,
  execution: SourceExecutionModule,
  queue: SourceExecutionQueue,
) {
  app.post("/api/capture-tasks/:taskId/crawl-plans/:planId/prepare", async (request) => {
    const params = planParamsSchema.parse(request.params);
    const body = sourceExecutionPlanRequestSchema.parse(request.body);
    return { item: sourcePreparationSchema.parse(await execution.prepare({ ...params, ...body })) };
  });
  app.post("/api/capture-tasks/:taskId/crawl-plans/:planId/start", async (request, reply) => {
    const params = planParamsSchema.parse(request.params);
    const body = sourceExecutionPlanRequestSchema.parse(request.body);
    const accepted = await queue.enqueueStart({ ...params, ...body });
    return reply.code(202).send({ item: sourceExecutionAcceptanceSchema.parse(accepted) });
  });
  app.post("/api/capture-tasks/:taskId/source-runs/:runId/resume", async (request, reply) => {
    const params = runParamsSchema.parse(request.params);
    const body = sourceExecutionPlanRequestSchema.parse(request.body);
    const accepted = await queue.enqueueResume({ ...params, ...body });
    return reply.code(202).send({ item: sourceExecutionAcceptanceSchema.parse(accepted) });
  });
}
