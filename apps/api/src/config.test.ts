import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { loadWorkerConfig } from "@domain-analysis/worker";

describe("api config", () => {
  it("shares the same default SQLite database with the worker", () => {
    const api = loadConfig({});
    const worker = loadWorkerConfig({ REDIS_URL: "redis://127.0.0.1:6379" });

    expect(api.databaseUrl).toBe(worker.databaseUrl);
    expect(api.databaseUrl).toMatch(/\/data\/domain-analysis\.sqlite$/);
  });
});
