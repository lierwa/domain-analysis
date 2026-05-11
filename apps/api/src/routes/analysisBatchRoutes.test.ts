import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupDatabaseTempDir, createDb, initializeDatabase } from "@domain-analysis/db";
import { buildServer } from "../server";

let tempDir: string;
let databaseUrl: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-batch-api-"));
  databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
  await initializeDatabase(databaseUrl);
});

afterEach(async () => {
  await cleanupDatabaseTempDir(tempDir);
});

describe("analysis batch routes", () => {
  it("creates a batch with per-platform child runs", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const response = await app.inject({
      method: "POST",
      url: "/api/analysis-batches",
      payload: {
        projectName: "Tattoo research",
        goal: "Understand tattoo design demand",
        includeKeywords: ["tattoo design"],
        excludeKeywords: [],
        language: "en",
        market: "US",
        platformLimits: [
          { platform: "reddit", limit: 200 },
          { platform: "x", limit: 200 }
        ]
      }
    });

    expect(response.statusCode).toBe(201);
    const batch = response.json().item;
    expect(batch.runs).toMatchObject([
      { platform: "reddit", limit: 200 },
      { platform: "x", limit: 200 }
    ]);

    const list = await app.inject({ method: "GET", url: "/api/analysis-batches?page=1&pageSize=20" });
    expect(list.json().items[0]).toMatchObject({ id: batch.id, runCount: 2 });

    await app.close();
  });

  it("rejects duplicate platforms in a batch request", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const response = await app.inject({
      method: "POST",
      url: "/api/analysis-batches",
      payload: {
        goal: "Bad batch",
        includeKeywords: ["tattoo design"],
        language: "en",
        market: "US",
        platformLimits: [
          { platform: "reddit", limit: 200 },
          { platform: "reddit", limit: 100 }
        ]
      }
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("deletes a batch and all generated runs", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-batches",
      payload: {
        goal: "Delete batch",
        includeKeywords: ["tattoo design"],
        language: "en",
        market: "US",
        platformLimits: [{ platform: "reddit", limit: 50 }]
      }
    });
    const batchId = created.json().item.id;

    const deleted = await app.inject({ method: "POST", url: `/api/analysis-batches/${batchId}/delete` });
    const fetched = await app.inject({ method: "GET", url: `/api/analysis-batches/${batchId}` });

    expect(deleted.statusCode).toBe(200);
    expect(fetched.statusCode).toBe(404);

    await app.close();
  });
});
