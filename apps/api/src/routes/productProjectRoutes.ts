import {
  type ProductPipelineModule,
  type ProductProjectModule,
  ProductProjectError,
  type SourceCollectionPlannerModule,
} from "@domain-analysis/workbench";
import { productProjectDraftInputSchema } from "@domain-analysis/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const projectParamsSchema = z.object({ projectId: z.string().min(1) }).strict();
const confirmBodySchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
const emptyBodySchema = z.object({}).strict();

export async function registerProductProjectRoutes(
  app: FastifyInstance,
  productProjects: ProductProjectModule,
  options: ProductProjectRouteOptions = {},
) {
  app.get("/api/product-projects", async () => ({
    items: await productProjects.list(),
  }));

  app.get("/api/product-projects/:projectId", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const item = await productProjects.get(projectId);
    if (!item) throw new ProductProjectError("not_found", `项目不存在：${projectId}`);
    return { item };
  });

  app.put("/api/product-projects/draft", async (request, reply) => {
    const input = productProjectDraftInputSchema.parse(request.body);
    const item = await productProjects.saveDraft(input);
    return reply.status(input.projectId ? 200 : 201).send({ item });
  });

  app.post("/api/product-projects/:projectId/confirm", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const { expectedRevision } = confirmBodySchema.parse(request.body);
    return { item: await productProjects.confirm(projectId, expectedRevision) };
  });

  if (options.pipeline) {
    app.post("/api/product-projects/:projectId/pipeline-runs", async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const item = await options.pipeline!.module.start(projectId, options.pipeline!.requestedBy);
      return reply.status(202).send({ item });
    });
  }

  if (options.sourceCollectionPlanner) {
    app.post("/api/product-projects/:projectId/source-collection-runs", async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      // WHY：生产入口只接受项目事实源；客户端不能注入 URL、Provider 或知识目的绕过 Planner。
      emptyBodySchema.parse(request.body ?? {});
      const item = await options.sourceCollectionPlanner!.start(projectId);
      return reply.status(202).send({ item });
    });
  }

}

interface ProductPipelineRouteOptions {
  module: ProductPipelineModule;
  requestedBy: string;
}

interface ProductProjectRouteOptions {
  pipeline?: ProductPipelineRouteOptions;
  sourceCollectionPlanner?: SourceCollectionPlannerModule;
}
