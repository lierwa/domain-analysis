import type {
  ProductProjectModule,
  SourceCollectionPlannerModule,
} from "@domain-analysis/workbench";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { registerProductProjectRoutes } from "../src/routes/productProjectRoutes";

describe("source collection planner route", () => {
  it("生产启动入口只接受 projectId，不允许客户端注入 workItems", async () => {
    const start = vi.fn(async (projectId: string) => ({
      plan: { id: `plan-${projectId}` },
      executions: [],
    }));
    const app = Fastify({ logger: false });
    app.setErrorHandler((error, _request, reply) => {
      reply.status(error instanceof ZodError ? 400 : 500).send({ error: error.message });
    });
    await registerProductProjectRoutes(app, projectModule(), {
      sourceCollectionPlanner: { start } as unknown as SourceCollectionPlannerModule,
    });

    const started = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-television/source-collection-runs",
    });
    expect(started.statusCode).toBe(202);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith("project-television");

    const injected = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-television/source-collection-runs",
      payload: { workItems: [{ requestedUrl: "https://attacker.invalid" }] },
    });
    expect(injected.statusCode).toBe(400);
    expect(start).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

function projectModule(): ProductProjectModule {
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    saveDraft: vi.fn(),
    confirm: vi.fn(),
  } as ProductProjectModule;
}
