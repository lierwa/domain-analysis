import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAnalysisProjectRepository,
  createAnalysisRunRepository,
  createCrawlTaskRepository,
  createDb,
  createSourceRepository,
  initializeDatabase
} from "@domain-analysis/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recoverStaleCollectionRuns } from "./recovery";

let tempDir: string;
let databaseUrl: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-recovery-"));
  databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
  await initializeDatabase(databaseUrl);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("recoverStaleCollectionRuns", () => {
  it("marks stale collecting runs and running tasks as failed", async () => {
    const db = createDb(databaseUrl);
    const projects = createAnalysisProjectRepository(db);
    const runs = createAnalysisRunRepository(db);
    const sources = createSourceRepository(db);
    const tasks = createCrawlTaskRepository(db);

    await sources.seedDefaults();
    const source = await sources.getByPlatform("reddit");
    if (!source) throw new Error("source_not_found");
    const project = await projects.create({ name: "P", goal: "g", language: "en", market: "US" });
    const run = await runs.create({
      projectId: project.id,
      name: "Run",
      goal: project.goal,
      includeKeywords: ["perfume"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 50
    });
    const task = await tasks.create({
      analysisRunId: run.id,
      sourceId: source.id,
      platform: "reddit",
      targetCount: 50
    });
    await runs.update(run.id, {
      status: "collecting",
      startedAt: "2026-05-07T08:00:00.000Z",
      finishedAt: "2026-05-07T07:59:00.000Z"
    });
    await tasks.update(task.id, {
      status: "running",
      startedAt: "2026-05-07T08:00:00.000Z"
    });

    const result = await recoverStaleCollectionRuns(db, {
      now: new Date("2026-05-07T09:30:00.000Z"),
      staleAfterMs: 30 * 60 * 1000
    });

    const updatedRun = await runs.getById(run.id);
    const updatedTask = (await runs.listCrawlTasks(run.id))[0];

    expect(result).toEqual({ recoveredRuns: 1, recoveredTasks: 1 });
    expect(updatedRun).toMatchObject({
      status: "collection_failed",
      errorMessage: "stale_collection_recovered"
    });
    expect(updatedRun?.finishedAt).toBe("2026-05-07T09:30:00.000Z");
    expect(updatedTask).toMatchObject({
      status: "failed",
      errorMessage: "stale_collection_recovered"
    });
  });
});
