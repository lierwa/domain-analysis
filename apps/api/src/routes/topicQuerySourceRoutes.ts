import type { FastifyInstance, FastifyReply } from "fastify";
import {
  createQueryRepository,
  createRawContentRepository,
  createSourceRepository,
  createTopicRepository,
  type AppDb
} from "@domain-analysis/db";
import { z } from "zod";
import { crawlFrequencies, platforms, topicStatuses } from "@domain-analysis/shared";

const createTopicSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  language: z.string().min(2).max(12),
  market: z.string().min(2).max(64)
});

const updateTopicSchema = createTopicSchema.partial().extend({
  status: z.enum(topicStatuses).optional()
});

const createQuerySchema = z.object({
  name: z.string().min(1).max(120),
  includeKeywords: z.array(z.string().min(1)).min(1),
  excludeKeywords: z.array(z.string().min(1)).default([]),
  platforms: z.array(z.enum(platforms)).min(1),
  language: z.string().min(2).max(12),
  frequency: z.enum(crawlFrequencies),
  limitPerRun: z.number().int().min(1).max(500)
});

const updateQuerySchema = createQuerySchema.partial().extend({
  status: z.enum(topicStatuses).optional()
});

const updateSourceSchema = z
  .object({
    enabled: z.boolean().optional(),
    crawlerType: z.enum(["cheerio", "playwright"]).optional()
  })
  .refine((body) => body.enabled !== undefined || body.crawlerType !== undefined, {
    message: "at_least_one_of_enabled_crawlerType"
  });

const createSourceSchema = z.object({
  platform: z.enum(platforms),
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  requiresLogin: z.boolean().default(false),
  crawlerType: z.enum(["cheerio", "playwright"]).default("cheerio"),
  defaultLimit: z.number().int().min(1).max(500).default(100)
});

export async function registerTopicQuerySourceRoutes(app: FastifyInstance, db: AppDb) {
  const topicRepository = createTopicRepository(db);
  const queryRepository = createQueryRepository(db);
  const rawContentRepository = createRawContentRepository(db);
  const sourceRepository = createSourceRepository(db);

  app.addHook("onSend", async (request, reply) => {
    if (request.method === "GET") {
      // WHY: 部署到 Nginx/CDN/平台代理后，配置列表不能被缓存，否则 UI 会显示旧 Topic/Query/Source。
      reply.header("Cache-Control", "no-store");
    }
  });

  app.get("/api/topics", async () => ({
    items: await topicRepository.list()
  }));

  app.post("/api/topics", async (request, reply) => {
    const input = parseBody(createTopicSchema, request.body, reply);
    if (!input) return reply;

    const item = await topicRepository.create(input);
    return reply.status(201).send({ item });
  });

  app.post<{ Params: { id: string } }>("/api/topics/:id/update", async (request, reply) => {
    const input = parseBody(updateTopicSchema, request.body, reply);
    if (!input) return reply;

    const item = await topicRepository.update(request.params.id, input);
    return item ? { item } : reply.status(404).send({ error: "topic_not_found" });
  });

  app.post<{ Params: { id: string } }>("/api/topics/:id/delete", async (request, reply) => {
    // WHY: 当前部署环境只允许 GET/POST，因此状态变更统一使用 POST action 路由。
    // TRADE-OFF: 不完全 RESTful，但能避开代理/网关对 PATCH/DELETE 的限制。
    await topicRepository.remove(request.params.id);
    return reply.send({ ok: true });
  });

  app.get<{ Params: { topicId: string } }>("/api/topics/:topicId/raw-contents", async (request, reply) => {
    const topic = await topicRepository.getById(request.params.topicId);
    if (!topic) {
      return reply.status(404).send({ error: "topic_not_found" });
    }
    return { items: await rawContentRepository.listByTopic(request.params.topicId) };
  });

  app.get<{ Params: { topicId: string } }>("/api/topics/:topicId/queries", async (request) => ({
    items: await queryRepository.listByTopic(request.params.topicId)
  }));

  app.post<{ Params: { topicId: string } }>(
    "/api/topics/:topicId/queries",
    async (request, reply) => {
      const input = parseBody(createQuerySchema, request.body, reply);
      if (!input) return reply;

      const item = await queryRepository.create({
        ...input,
        topicId: request.params.topicId
      });
      return reply.status(201).send({ item });
    }
  );

  app.post<{ Params: { id: string } }>("/api/queries/:id/update", async (request, reply) => {
    const input = parseBody(updateQuerySchema, request.body, reply);
    if (!input) return reply;

    const item = await queryRepository.update(request.params.id, input);
    return item ? { item } : reply.status(404).send({ error: "query_not_found" });
  });

  app.post<{ Params: { id: string } }>("/api/queries/:id/delete", async (request, reply) => {
    await queryRepository.remove(request.params.id);
    return reply.send({ ok: true });
  });

  app.get("/api/sources", async () => {
    await sourceRepository.seedDefaults();
    return { items: await sourceRepository.list() };
  });

  app.post("/api/sources", async (request, reply) => {
    const input = parseBody(createSourceSchema, request.body, reply);
    if (!input) return reply;

    const item = await sourceRepository.create(input);
    return reply.status(201).send({ item });
  });

  app.post<{ Params: { platform: string } }>("/api/sources/:platform/update", async (request, reply) => {
    const input = parseBody(updateSourceSchema, request.body, reply);
    const platformResult = z.enum(platforms).safeParse(request.params.platform);
    if (!input) return reply;
    if (!platformResult.success) {
      return reply.status(400).send({ error: "invalid_platform" });
    }

    const item = await sourceRepository.updateByPlatform(platformResult.data, input);
    return item ? { item } : reply.status(404).send({ error: "source_not_found" });
  });
}

function parseBody<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  body: unknown,
  reply: FastifyReply
): z.infer<TSchema> | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    // WHY: API 边界统一使用 Zod 返回结构化错误，避免无效配置进入采集任务链路。
    reply.status(400).send({ error: "validation_error", issues: result.error.issues });
    return null;
  }
  return result.data;
}
