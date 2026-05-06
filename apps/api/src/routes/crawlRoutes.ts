import type { FastifyInstance, FastifyReply } from "fastify";
import {
  createCrawlTaskRepository,
  createQueryRepository,
  createRawContentRepository,
  createSourceRepository,
  type AppDb
} from "@domain-analysis/db";
import { platforms, type TaskStatus } from "@domain-analysis/shared";
import { TaskQueue } from "@domain-analysis/worker";
import { z } from "zod";

const crawlRequestSchema = z.object({
  platform: z.enum(platforms).refine((platform) => platform === "reddit" || platform === "x", {
    message: "Only reddit and x collection are implemented"
  })
});

export async function registerCrawlRoutes(app: FastifyInstance, db: AppDb) {
  const queryRepository = createQueryRepository(db);
  const sourceRepository = createSourceRepository(db);
  const taskRepository = createCrawlTaskRepository(db);
  const rawContentRepository = createRawContentRepository(db);
  const queue = new TaskQueue();

  app.get("/api/crawl-tasks", async () => ({
    items: await taskRepository.list()
  }));

  app.post<{ Params: { id: string } }>("/api/crawl-tasks/:id/delete", async (request, reply) => {
    const task = (await taskRepository.list()).find((item) => item.id === request.params.id);
    if (!task) return reply.status(404).send({ error: "crawl_task_not_found" });
    if (task.status === "pending" || task.status === "running") {
      return reply.status(400).send({ error: "cannot_delete_running_task" });
    }

    await taskRepository.remove(task.id);
    return reply.send({ ok: true });
  });

  app.post("/api/crawl-tasks/clear-finished", async () => ({
    deletedCount: await taskRepository.removeFinished()
  }));

  app.get("/api/raw-contents", async () => ({
    items: await rawContentRepository.list()
  }));

  app.post<{ Params: { id: string } }>("/api/queries/:id/crawl", async (request, reply) => {
    const input = parseBody(crawlRequestSchema, request.body, reply);
    if (!input) return reply;

    await sourceRepository.seedDefaults();
    const query = await queryRepository.getById(request.params.id);
    if (!query) return reply.status(404).send({ error: "query_not_found" });
    if (!query.platforms.includes(input.platform)) {
      return reply.status(400).send({ error: "platform_not_enabled_for_query" });
    }

    const source = await sourceRepository.getByPlatform(input.platform);
    if (!source) return reply.status(404).send({ error: "source_not_found" });
    if (!source.enabled) return reply.status(400).send({ error: "source_disabled" });

    const existingTask = (await taskRepository.list()).find(
      (item) =>
        item.queryId === query.id &&
        item.sourceId === source.id &&
        (item.status === "pending" || item.status === "running")
    );
    if (existingTask) {
      return reply.status(202).send({ item: existingTask });
    }

    const task = await taskRepository.create({
      topicId: query.topicId,
      queryId: query.id,
      sourceId: source.id,
      targetCount: Math.min(query.limitPerRun, source.defaultLimit)
    });

    const startedAt = new Date().toISOString();
    const runningTask = await taskRepository.update(task.id, { status: "running", startedAt });

    void queue
      .add({
        id: task.id,
        kind: "crawl",
        payload: {
          platform: input.platform,
          query: {
            name: query.name,
            includeKeywords: query.includeKeywords,
            excludeKeywords: query.excludeKeywords,
            language: query.language,
            limitPerRun: Math.min(query.limitPerRun, source.defaultLimit)
          }
        }
      })
      .then(async (result) => {
        const collectedCount = result?.items?.length ?? 0;
        const inserted = await rawContentRepository.createMany(
          (result?.items ?? []).map((item) => ({
            ...item,
            topicId: query.topicId,
            queryId: query.id,
            sourceId: source.id
          }))
        );
        await taskRepository.update(task.id, {
          status: collectedCount === 0 ? "no_content" : "success",
          collectedCount,
          validCount: inserted.items.length,
          duplicateCount: inserted.duplicates,
          errorMessage:
            collectedCount === 0
              ? "No public posts matched this query, or the source returned an empty result."
              : null,
          finishedAt: new Date().toISOString()
        });
      })
      .catch(async (error) => {
        await taskRepository.update(task.id, {
          status: classifyCrawlError(error),
          errorMessage: error instanceof Error ? error.message : "unknown_crawl_error",
          finishedAt: new Date().toISOString()
        });
      });

    // WHY: 公开采集必须低并发慢速执行；API 立即返回任务，避免慢抓取阻塞用户界面和健康检查。
    // TRADE-OFF: MVP 仍是进程内队列，进程重启会丢运行中任务；后续再迁移到持久化队列。
    return reply.status(202).send({ item: runningTask });
  });
}

function classifyCrawlError(error: unknown): TaskStatus {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("rate_limited") || message.includes("_429")) return "rate_limited";
  if (message.includes("login_required")) return "login_required";
  if (message.includes("parse")) return "parse_failed";
  return "failed";
}

function parseBody<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  body: unknown,
  reply: FastifyReply
): z.infer<TSchema> | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    // WHY: 采集入口必须在 API 边界限制平台，避免未实现平台进入 worker 后变成不可追踪失败。
    reply.status(400).send({ error: "validation_error", issues: result.error.issues });
    return null;
  }
  return result.data;
}
