import { knowledgePackCreateSchema,
  knowledgeReviewRequestSchema, knowledgeRevisionRequestSchema, knowledgeSelectionRequestSchema } from "@domain-analysis/shared";
import type { KnowledgeProcessingModule } from "@domain-analysis/workbench";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const packParams = z.object({ packId: z.string().min(1).max(240) }).strict();
const runParams = packParams.extend({ runId: z.string().min(1).max(240) });
const itemParams = runParams.extend({ itemId: z.string().min(1).max(240) });
const versionParams = packParams.extend({ versionId: z.string().min(1).max(240) });
const retryRequest = z.object({ expectedGeneration: z.number().int().positive() }).strict();

export async function registerKnowledgeProcessingRoutes(app: FastifyInstance, module: KnowledgeProcessingModule) {
  app.get("/api/knowledge-processing/capabilities", async () => ({ item: await module.capabilities() }));
  app.get("/api/knowledge-packs", async () => ({ items: await module.list() }));
  app.post("/api/knowledge-packs", async request => ({ item: await module.create(knowledgePackCreateSchema.parse(request.body)) }));
  app.get("/api/knowledge-packs/:packId", async request => ({ item: await module.get(packParams.parse(request.params).packId) }));
  app.put("/api/knowledge-packs/:packId/selection", async request => {
    const { packId } = packParams.parse(request.params);
    return { item: await module.select(packId, knowledgeSelectionRequestSchema.parse(request.body)) };
  });
  app.post("/api/knowledge-packs/:packId/runs", async request => {
    const { packId } = packParams.parse(request.params);
    return { item: await module.start(packId, knowledgeRevisionRequestSchema.parse(request.body).expectedRevision) };
  });
  app.get("/api/knowledge-packs/:packId/runs/:runId", async request => {
    const { packId, runId } = runParams.parse(request.params);
    return { item: await module.run(packId, runId) };
  });
  app.post("/api/knowledge-packs/:packId/runs/:runId/stop", async request => {
    const { packId, runId } = runParams.parse(request.params);
    return { item: await module.stop(packId, runId) };
  });
  app.post("/api/knowledge-packs/:packId/runs/:runId/retry", async request => {
    const { packId, runId } = runParams.parse(request.params);
    return { item: await module.retry(packId, runId, retryRequest.parse(request.body).expectedGeneration) };
  });
  app.post("/api/knowledge-packs/:packId/runs/:runId/reviews", async request => {
    const { packId, runId } = runParams.parse(request.params);
    return { item: await module.review(packId, runId, knowledgeReviewRequestSchema.parse(request.body)) };
  });
  app.post("/api/knowledge-packs/:packId/runs/:runId/ai-review", async request => {
    const { packId, runId } = runParams.parse(request.params);
    return { item: await module.startAiReview(packId, runId,
      knowledgeRevisionRequestSchema.parse(request.body).expectedRevision) };
  });
  app.get("/api/knowledge-packs/:packId/runs/:runId/items/:itemId/image", async (request, reply) => {
    const { packId, runId, itemId } = itemParams.parse(request.params);
    reply.type("image/png").header("X-Content-Type-Options", "nosniff").header("Cache-Control", "no-store");
    return reply.send(await module.readImage(packId, runId, itemId));
  });
  app.post("/api/knowledge-packs/:packId/runs/:runId/versions", async request => {
    const { packId, runId } = runParams.parse(request.params);
    return { item: await module.buildVersion(packId, runId, knowledgeRevisionRequestSchema.parse(request.body).expectedRevision) };
  });
  app.post("/api/knowledge-packs/:packId/versions/:versionId/publish", async request => {
    const { packId, versionId } = versionParams.parse(request.params);
    return { item: await module.publishVersion(packId, versionId, knowledgeRevisionRequestSchema.parse(request.body).expectedRevision) };
  });
  app.get("/api/knowledge-packs/:packId/versions/:versionId/files", async (request, reply) => {
    const { packId, versionId } = versionParams.parse(request.params);
    const { path } = z.object({ path: z.string().max(240).optional() }).strict().parse(request.query);
    const file = await module.readVersionFile(packId, versionId, path);
    reply.type(file.mediaType).header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `${path ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    return reply.send(Buffer.from(file.bytes));
  });
}
