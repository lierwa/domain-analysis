import { interviewTimelineEventSchema, interviewTurnRequestSchema } from "@domain-analysis/shared";
import {
  type CategoryInterviewModule,
  CategoryInterviewError,
} from "@domain-analysis/workbench";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const sessionParamsSchema = z.object({ sessionId: z.string().min(1) }).strict();
const decisionParamsSchema = sessionParamsSchema.extend({ decisionId: z.string().min(1) }).strict();
const briefParamsSchema = sessionParamsSchema.extend({ briefId: z.string().min(1) }).strict();
const revisionSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
const startSchema = z.object({ categoryHint: z.string().min(1).max(120) }).strict();

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
    ));
  });

  app.post("/api/category-interviews/:sessionId/decisions/:decisionId/confirm", async (request) => {
    const { sessionId, decisionId } = decisionParamsSchema.parse(request.params);
    const { expectedRevision } = revisionSchema.parse(request.body);
    return { item: await interviews.confirmDecision({ sessionId, decisionId, expectedRevision }) };
  });

  app.post("/api/category-interviews/:sessionId/briefs/:briefId/confirm", async (request) => {
    const { sessionId, briefId } = briefParamsSchema.parse(request.params);
    const { expectedRevision } = revisionSchema.parse(request.body);
    return { item: await interviews.confirmBrief({ sessionId, briefId, expectedRevision }) };
  });
}

async function* toServerEvents(
  sessionId: string,
  events: ReturnType<CategoryInterviewModule["runTurn"]>,
  cleanup: () => void,
) {
  try {
    try {
      for await (const rawEvent of events) {
        const event = interviewTimelineEventSchema.parse(rawEvent);
        yield { event: event.type, data: JSON.stringify(event) };
      }
    } catch (error) {
      // WHY：SSE plugin 不应接收到 rejected iterable；adapter 将传输失败收窄为公共 typed event。
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000) || "采访流失败";
      const event = interviewTimelineEventSchema.parse({ type: "stream.failed", sessionId, error: message });
      yield { event: event.type, data: JSON.stringify(event) };
    }
  } finally {
    cleanup();
  }
}
