import type {
  CategoryInterviewView,
  InterviewTimelineEvent,
} from "@domain-analysis/shared";
import type { CategoryInterviewModule } from "@domain-analysis/workbench";
import Fastify from "fastify";
import { FastifySSEPlugin } from "fastify-sse-v2";
import { describe, expect, it, vi } from "vitest";

import { registerCategoryInterviewRoutes } from "../src/routes/categoryInterviewRoutes";

describe("Category Interview HTTP contract", () => {
  it("starts, reads and streams only typed timeline events", async () => {
    const module = fakeModule();
    const app = Fastify();
    await app.register(FastifySSEPlugin, { retryDelay: false });
    await registerCategoryInterviewRoutes(app, module);

    const started = await app.inject({
      method: "POST",
      url: "/api/category-interviews",
      payload: { categoryHint: "冰箱" },
    });
    expect(started.statusCode).toBe(201);
    expect(started.json().item.session.categoryHint).toBe("冰箱");
    const listed = await app.inject({ method: "GET", url: "/api/category-interviews" });
    expect(listed.json().items[0].id).toBe("session-fridge");

    const streamed = await app.inject({
      method: "POST",
      url: "/api/category-interviews/session-fridge/turns",
      payload: { trigger: "user_message", expectedRevision: 1, text: "开启冰箱品类" },
    });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers["content-type"]).toContain("text/event-stream");
    const events = streamed.body.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5).trim()) as InterviewTimelineEvent);
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "assistant.delta",
      "turn.completed",
    ]);
    expect(module.runTurn).toHaveBeenCalledWith(expect.objectContaining({
      trigger: "user_message",
      text: "开启冰箱品类",
    }));
    await app.close();
  });

  it("uses explicit decision and brief confirmation routes", async () => {
    const module = fakeModule();
    const app = Fastify();
    await app.register(FastifySSEPlugin, { retryDelay: false });
    await registerCategoryInterviewRoutes(app, module);

    const decision = await app.inject({
      method: "POST",
      url: "/api/category-interviews/session-fridge/decisions/decision-1/confirm",
      payload: { expectedRevision: 2 },
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().item.session.revision).toBe(3);

    const brief = await app.inject({
      method: "POST",
      url: "/api/category-interviews/session-fridge/briefs/brief-1/confirm",
      payload: { expectedRevision: 3 },
    });
    expect(brief.statusCode).toBe(200);
    expect(module.confirmBrief).toHaveBeenCalledWith({
      sessionId: "session-fridge",
      briefId: "brief-1",
      expectedRevision: 3,
    });
    await app.close();
  });

  it("keeps generator failures inside the typed SSE boundary", async () => {
    const module = fakeModule();
    module.runTurn = async function* () {
      throw new Error("x".repeat(3000));
    };
    const app = Fastify();
    await app.register(FastifySSEPlugin, { retryDelay: false });
    await registerCategoryInterviewRoutes(app, module);

    const response = await app.inject({
      method: "POST",
      url: "/api/category-interviews/session-fridge/turns",
      payload: { trigger: "decision_confirmed", expectedRevision: 1, decisionId: "decision-1" },
    });
    const data = response.body.split("\n").find((line) => line.startsWith("data:"));
    expect(JSON.parse(data!.slice(5)).type).toBe("stream.failed");
    await app.close();
  });
});

function fakeModule(): CategoryInterviewModule {
  const view = interviewView();
  const confirmDecision = vi.fn(async () => ({
    ...view,
    session: { ...view.session, revision: 3 },
  }));
  const confirmBrief = vi.fn(async () => ({ interview: view })) as unknown as CategoryInterviewModule["confirmBrief"];
  return {
    list: async () => [view.session],
    start: async () => view,
    get: async () => view,
    getConfirmedBriefForProject: async () => null,
    runTurn: vi.fn(async function* () {
      yield timeline({ type: "turn.started", sessionId: "session-fridge", turnId: "turn-1" });
      yield timeline({
        type: "assistant.delta",
        sessionId: "session-fridge",
        turnId: "turn-1",
        delta: "建议先聚焦中国大陆市场。",
      });
      yield timeline({ type: "turn.completed", sessionId: "session-fridge", turnId: "turn-1" });
    }),
    confirmDecision,
    confirmBrief,
  };
}

function timeline(event: InterviewTimelineEvent) {
  return event;
}

function interviewView(): CategoryInterviewView {
  return {
    session: {
      id: "session-fridge",
      categoryHint: "冰箱",
      phase: "active",
      turnState: "idle",
      revision: 1,
      createdAt: "2026-08-16T08:00:00.000Z",
      updatedAt: "2026-08-16T08:00:00.000Z",
    },
    messages: [],
    decisions: [],
    unresolvedItems: [],
    briefs: [],
  };
}
