import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, initializeDatabase } from "@domain-analysis/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server";

let tempDir: string;
let databaseUrl: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-api-"));
  databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
  await initializeDatabase(databaseUrl);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("collection plan routes", () => {
  it("creates and lists collection plans for a project", async () => {
    const db = createDb(databaseUrl);
    const app = await buildServer({ logger: false, db });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: {
        projectName: "AI search",
        goal: "Track AI search product pain points",
        includeKeywords: ["AI search"],
        excludeKeywords: [],
        language: "en",
        market: "US",
        limit: 100
      }
    });
    const run = runResponse.json().item;

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/collection-plans",
      payload: {
        projectId: run.projectId,
        name: "Daily Reddit monitor",
        includeKeywords: ["AI search"],
        excludeKeywords: ["jobs"],
        language: "en",
        market: "US",
        cadence: "daily",
        batchLimit: 100,
        maxRunsPerDay: 4
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().status).toBe("active");

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${run.projectId}/collection-plans`
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toHaveLength(1);

    await app.close();
  });
});
