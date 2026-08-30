import {
  confirmCrawlPlanSchema,
  crawlPlanningEventSchema,
  crawlPlanningRunRequestSchema,
} from "@domain-analysis/shared";
import { type CrawlPlanningModule, CrawlPlanningError } from "@domain-analysis/workbench";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const taskParamsSchema = z.object({ taskId: z.string().min(1) }).strict();
const planParamsSchema = taskParamsSchema.extend({ planId: z.string().min(1) }).strict();

export async function registerCrawlPlanningRoutes(app: FastifyInstance, planning: CrawlPlanningModule) {
  app.get("/api/capture-tasks/:taskId/crawl-planning", async (request) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const item = await planning.get(taskId);
    if (!item) throw new CrawlPlanningError("not_found", `抓取任务不存在：${taskId}`);
    return { item };
  });

  app.post("/api/capture-tasks/:taskId/crawl-planning/runs", async (request, reply) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const input = crawlPlanningRunRequestSchema.parse(request.body);
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    request.socket.once("close", abort);
    const events = planning.run({ ...input, taskId, signal: abortController.signal });
    return reply.sse(toServerEvents(taskId, events,
      () => request.socket.off("close", abort),
      (error) => app.log.error({ err: error }, "crawl planning stream failed")));
  });

  app.post("/api/capture-tasks/:taskId/crawl-plans/:planId/confirm", async (request) => {
    const { taskId, planId } = planParamsSchema.parse(request.params);
    const input = confirmCrawlPlanSchema.parse(request.body);
    return { item: await planning.confirm({ ...input, taskId, planId }) };
  });
}

async function* toServerEvents(
  taskId: string,
  events: ReturnType<CrawlPlanningModule["run"]>,
  cleanup: () => void,
  logFailure: (error: unknown) => void,
) {
  try {
    try {
      for await (const rawEvent of events) {
        const event = crawlPlanningEventSchema.parse(rawEvent);
        yield { event: event.type, data: JSON.stringify(event) };
      }
    } catch (error) {
      logFailure(error);
      const event = crawlPlanningEventSchema.parse({
        type: "stream.failed", taskId, error: "规划连接意外中断，请刷新后重试。",
      });
      yield { event: event.type, data: JSON.stringify(event) };
    }
  } finally {
    cleanup();
  }
}
