import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupDatabaseTempDir,
  createAnalysisRunRepository,
  createCrawlTaskRepository,
  createDb,
  createSourceRepository,
  initializeDatabase
} from "@domain-analysis/db";
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

  it("stops collecting child runs before allowing batch deletion", async () => {
    const db = createDb(databaseUrl);
    const app = await buildServer({ logger: false, db });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-batches",
      payload: {
        goal: "Stop batch",
        includeKeywords: ["tattoo design"],
        language: "en",
        market: "US",
        platformLimits: [{ platform: "reddit", limit: 50 }]
      }
    });
    const batch = created.json().item;
    const runId: string = batch.runs[0].id;
    await seedCollectingChildRun(db, runId);

    const deleted = await app.inject({ method: "POST", url: `/api/analysis-batches/${batch.id}/delete` });
    const stopped = await app.inject({ method: "POST", url: `/api/analysis-batches/${batch.id}/stop` });
    const deletedAfterStop = await app.inject({ method: "POST", url: `/api/analysis-batches/${batch.id}/delete` });

    expect(deleted.statusCode).toBe(400);
    expect(stopped.statusCode).toBe(202);
    expect(stopped.json().item).toMatchObject({ id: batch.id, status: "cancelled" });
    expect(stopped.json().item.runs[0]).toMatchObject({ id: runId, status: "cancelled" });
    expect(deletedAfterStop.statusCode).toBe(200);

    await app.close();
  });
});

async function seedCollectingChildRun(db: ReturnType<typeof createDb>, runId: string) {
  const runs = createAnalysisRunRepository(db);
  const tasks = createCrawlTaskRepository(db);
  const sources = createSourceRepository(db);
  await sources.seedDefaults();
  const source = await sources.getByPlatform("reddit");
  if (!source) throw new Error("reddit source missing");
  const task = await tasks.create({ analysisRunId: runId, sourceId: source.id, targetCount: 50 });
  await tasks.update(task.id, { status: "running", startedAt: new Date().toISOString() });
  await runs.update(runId, { status: "collecting", startedAt: new Date().toISOString() });
}
