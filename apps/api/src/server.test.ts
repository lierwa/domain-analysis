import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildServer } from "./server";

describe("api server", () => {
  it("returns health metadata", async () => {
    const app = await buildServer({ logger: false });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "domain-analysis-api"
    });

    await app.close();
  });

  it("preserves client error status codes", async () => {
    const app = await buildServer({ logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      headers: { "content-type": "application/json" },
      payload: { goal: "missing keywords" }
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("disables Fastify per-request logs while keeping application logs available", async () => {
    const logs = createLogCapture();
    const app = await buildServer({ logger: { level: "info", stream: logs.stream } });

    await app.inject({ method: "GET", url: "/health" });
    app.log.info({ check: "business-log" }, "business.visible");

    expect(logs.text()).not.toContain("incoming request");
    expect(logs.text()).not.toContain("request completed");
    expect(logs.text()).toContain("business.visible");

    await app.close();
  });

  it("summarizes repeated successful GET requests instead of logging each one", async () => {
    const logs = createLogCapture();
    const app = await buildServer({
      logger: { level: "info", stream: logs.stream },
      requestLogSummaryIntervalMs: 10,
      requestLogSummaryMinCount: 3
    });

    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health" });
    await sleep(30);

    expect(logs.text()).toContain("request.summary");
    expect(logs.text()).toContain("GET");
    expect(logs.text()).toContain("/health");
    expect(logs.text()).toContain("\"count\":3");
    expect(logs.text()).not.toContain("incoming request");
    expect(logs.text()).not.toContain("request completed");

    await app.close();
  });

  it("logs slow and failed requests individually", async () => {
    const logs = createLogCapture();
    const app = await buildServer({
      logger: { level: "info", stream: logs.stream },
      requestLogSlowThresholdMs: 1
    });
    app.get("/test-slow", async () => {
      await sleep(5);
      return { ok: true };
    });

    await app.inject({ method: "GET", url: "/test-slow" });
    await app.inject({ method: "GET", url: "/missing-route" });

    expect(logs.text()).toContain("request.slow");
    expect(logs.text()).toContain("/test-slow");
    expect(logs.text()).toContain("request.error");
    expect(logs.text()).toContain("/missing-route");
    expect(logs.text()).toContain("\"status\":404");
    expect(logs.text()).not.toContain("Route GET:/missing-route not found");

    await app.close();
  });
});

function createLogCapture() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    }
  });
  return {
    stream,
    text: () => chunks.join("")
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
