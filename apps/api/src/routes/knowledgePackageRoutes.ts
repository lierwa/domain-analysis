import type { KnowledgePackageModule } from "@domain-analysis/workbench";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const projectParamsSchema = z.object({ projectId: z.string().min(1) }).strict();
const versionParamsSchema = projectParamsSchema.extend({
  versionHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export async function registerKnowledgePackageRoutes(
  app: FastifyInstance,
  packages: KnowledgePackageModule,
) {
  app.get("/api/product-projects/:projectId/knowledge-packages", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const [items, active] = await Promise.all([
      packages.list(projectId),
      packages.active(projectId),
    ]);
    return { items, active };
  });

  app.post("/api/product-projects/:projectId/knowledge-packages", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return reply.status(201).send({ item: await packages.build(projectId) });
  });

  app.post("/api/product-projects/:projectId/knowledge-packages/:versionHash/activate", async (request) => {
    const { projectId, versionHash } = versionParamsSchema.parse(request.params);
    return { item: await packages.activate(projectId, versionHash) };
  });

  app.post("/api/product-projects/:projectId/knowledge-packages/rollback", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return { item: await packages.rollback(projectId) };
  });
}
