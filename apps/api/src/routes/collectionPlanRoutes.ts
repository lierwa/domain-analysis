import type { AppDb } from "@domain-analysis/db";
import { createCollectionPlanInputSchema } from "@domain-analysis/shared";
import type { FastifyInstance } from "fastify";
import { createCollectionPlanService } from "../services/collectionPlanService";

export async function registerCollectionPlanRoutes(app: FastifyInstance, db: AppDb) {
  const service = createCollectionPlanService(db);

  app.post("/api/collection-plans", async (request, reply) => {
    const input = createCollectionPlanInputSchema.parse(request.body);
    const plan = await service.createPlan(input);
    return reply.code(201).send(plan);
  });

  app.get("/api/projects/:projectId/collection-plans", async (request) => {
    const params = request.params as { projectId: string };
    return service.listByProject(params.projectId);
  });

  app.post("/api/collection-plans/:id/pause", async (request) => {
    const params = request.params as { id: string };
    return service.pausePlan(params.id);
  });

  app.post("/api/collection-plans/:id/resume", async (request) => {
    const params = request.params as { id: string };
    return service.resumePlan(params.id);
  });
}
