import { sourcePreparationSchema, sourceRunEventSchema, startCrawlPlanSchema } from "@domain-analysis/shared";
import type { SourceExecutionModule } from "@domain-analysis/workbench";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const paramsSchema = z.object({ taskId: z.string().min(1), planId: z.string().min(1) }).strict();

export async function registerSourceExecutionRoutes(app: FastifyInstance, execution: SourceExecutionModule) {
  app.post("/api/capture-tasks/:taskId/crawl-plans/:planId/prepare", async (request) => {
    const params = paramsSchema.parse(request.params);
    const body = startCrawlPlanSchema.parse(request.body);
    return { item: sourcePreparationSchema.parse(await execution.prepare({ ...params, ...body })) };
  });

  app.post("/api/capture-tasks/:taskId/crawl-plans/:planId/start", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const body = startCrawlPlanSchema.parse(request.body);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.socket.once("close", abort);
    const iterator = execution.start({ ...params, ...body, signal: controller.signal })[Symbol.asyncIterator]();
    // WHY：先拉取首个事件，让版本、Provider 和浏览器预检错误仍能走普通 HTTP 错误契约，而不是变成已打开 SSE 后的断流。
    const first = await iterator.next();
    async function* events() {
      try {
        if (!first.done) {
          const parsed = sourceRunEventSchema.parse(first.value);
          yield { event: parsed.type, data: JSON.stringify(parsed) };
        }
        for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
          const parsed = sourceRunEventSchema.parse(event);
          yield { event: parsed.type, data: JSON.stringify(parsed) };
        }
      } finally { request.socket.off("close", abort); }
    }
    return reply.sse(events());
  });
}
