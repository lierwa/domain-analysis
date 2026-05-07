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
});
