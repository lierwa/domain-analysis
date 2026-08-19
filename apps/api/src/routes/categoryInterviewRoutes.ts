import {
  interviewTimelineEventSchema,
  interviewTurnRequestSchema,
} from "@domain-analysis/shared";
import {
  type CategoryInterviewModule,
  CategoryInterviewError,
} from "@domain-analysis/workbench";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const sessionParamsSchema = z.object({ sessionId: z.string().min(1) }).strict();
const draftParamsSchema = sessionParamsSchema.extend({ draftId: z.string().min(1) }).strict();
const taskParamsSchema = z.object({ taskId: z.string().min(1) }).strict();
const revisionSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
const startSchema = z.object({ initialRequest: z.string().min(1).max(20_000) }).strict();

export async function registerCategoryInterviewRoutes(
  app: FastifyInstance,
  interviews: CategoryInterviewModule,
) {
  app.get("/api/category-interviews", async () => ({ items: await interviews.list() }));

  app.post("/api/category-interviews", async (request, reply) => {
    const input = startSchema.parse(request.body);
    return reply.status(201).send({ item: await interviews.start(input) });
  });

  app.get("/api/category-interviews/:sessionId", async (request) => {
    const { sessionId } = sessionParamsSchema.parse(request.params);
    const item = await interviews.get(sessionId);
    if (!item) throw new CategoryInterviewError("not_found", `采访会话不存在：${sessionId}`);
    return { item };
  });

  app.delete("/api/category-interviews/:sessionId", async (request, reply) => {
    const { sessionId } = sessionParamsSchema.parse(request.params);
    await interviews.remove(sessionId);
    return reply.status(204).send();
  });

  app.get("/api/capture-tasks/:taskId/interview", async (request) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const item = await interviews.getByTaskId(taskId);
    if (!item) throw new CategoryInterviewError("not_found", `抓取任务没有可修订的对话：${taskId}`);
    return { item };
  });

  app.post("/api/category-interviews/:sessionId/turns", async (request, reply) => {
    const { sessionId } = sessionParamsSchema.parse(request.params);
    const input = interviewTurnRequestSchema.parse(request.body);
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    request.socket.once("close", abort);
    const events = interviews.runTurn({ ...input, sessionId, signal: abortController.signal });
    return reply.sse(toServerEvents(
      sessionId,
      events,
      () => request.socket.off("close", abort),
      (error) => app.log.error({ err: error }, "category interview stream failed"),
    ));
  });

  app.post("/api/category-interviews/:sessionId/task-drafts/:draftId/confirm", async (request) => {
    const { sessionId, draftId } = draftParamsSchema.parse(request.params);
    const { expectedRevision } = revisionSchema.parse(request.body);
    return { item: await interviews.confirmTaskDraft({ sessionId, draftId, expectedRevision }) };
  });
}

async function* toServerEvents(
  sessionId: string,
  events: ReturnType<CategoryInterviewModule["runTurn"]>,
  cleanup: () => void,
  logFailure: (error: unknown) => void,
) {
  try {
    try {
      for await (const rawEvent of events) {
        const event = interviewTimelineEventSchema.parse(rawEvent);
        yield { event: event.type, data: JSON.stringify(event) };
      }
    } catch (error) {
      // WHY：SSE plugin 不应接收到 rejected iterable；adapter 将传输失败收窄为公共 typed event。
      logFailure(error);
      const event = interviewTimelineEventSchema.parse({
        type: "stream.failed",
        sessionId,
        error: "抓取规划连接意外中断，请重试本轮。",
      });
      yield { event: event.type, data: JSON.stringify(event) };
    }
  } finally {
    cleanup();
  }
}
