import {
  knowledgeReviewDecisionDraftSchema,
  runKnowledgeFactorySchema,
} from "@domain-analysis/shared";
import type {
  KnowledgeFactoryModule,
  KnowledgeReviewModule,
} from "@domain-analysis/workbench";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const projectParamsSchema = z.object({ projectId: z.string().min(1) }).strict();
const batchParamsSchema = projectParamsSchema.extend({ batchId: z.string().min(1) }).strict();
const batchOnlyParamsSchema = z.object({ batchId: z.string().min(1) }).strict();

export async function registerKnowledgeRoutes(
  app: FastifyInstance,
  factory: KnowledgeFactoryModule,
  review: KnowledgeReviewModule,
) {
  app.get("/api/product-projects/:projectId/knowledge-batches", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return { items: await factory.listProject(projectId) };
  });

  app.post("/api/product-projects/:projectId/knowledge-batches", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = runKnowledgeFactorySchema.parse({ ...request.body as object, projectId });
    return reply.status(201).send({ item: await factory.run(input) });
  });

  app.get("/api/product-projects/:projectId/knowledge-batches/:batchId", async (request, reply) => {
    const { projectId, batchId } = batchParamsSchema.parse(request.params);
    const item = await factory.get(batchId);
    if (!item || item.batch.projectId !== projectId) {
      return reply.status(404).send({ error: "batch_not_found", message: "知识批次不存在" });
    }
    return { item, decisions: await review.listBatch(batchId) };
  });

  app.post("/api/knowledge-batches/:batchId/reviews", async (request, reply) => {
    const { batchId } = batchOnlyParamsSchema.parse(request.params);
    const input = knowledgeReviewDecisionDraftSchema.parse({ ...request.body as object, batchId });
    return reply.status(201).send({ item: await review.decide(input) });
  });

  app.get("/api/product-projects/:projectId/reviewed-knowledge", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return { items: await review.listReviewed(projectId) };
  });
}
