import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAnalysisProjectRepository,
  createAnalysisRunRepository,
  createCrawlTaskRepository,
  createDb,
  createRawContentRepository,
  createSourceRepository,
  initializeDatabase
} from "@domain-analysis/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processCrawlJob } from "./crawlWorker";

let tempDir: string;
let databaseUrl: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-worker-"));
  databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
  await initializeDatabase(databaseUrl);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("processCrawlJob", () => {
  it("persists each Reddit page and marks the run content_ready when target is reached", async () => {
    const db = createDb(databaseUrl);
    const projects = createAnalysisProjectRepository(db);
    const runs = createAnalysisRunRepository(db);
    const sources = createSourceRepository(db);
    const tasks = createCrawlTaskRepository(db);
    const contents = createRawContentRepository(db);

    await sources.seedDefaults();
    const source = await sources.getByPlatform("reddit");
    if (!source) throw new Error("source not found");
    const project = await projects.create({ name: "P", goal: "g", language: "en", market: "US" });
    const run = await runs.create({
      projectId: project.id,
      name: "Run",
      goal: project.goal,
      includeKeywords: ["AI search"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 150
    });
    const task = await tasks.create({ analysisRunId: run.id, sourceId: source.id, targetCount: 150 });
    const createAdapter = vi.fn(() => ({
      async collectPaginated() {
        return {
          items: [
            {
              platform: "reddit" as const,
              externalId: "post_1",
              url: "https://reddit.com/1",
              text: "AI search page 1"
            },
            {
              platform: "reddit" as const,
              externalId: "post_2",
              url: "https://reddit.com/2",
              text: "AI search page 2"
            }
          ],
          pagesCollected: 2,
          stopReason: "target_reached" as const
        };
      },
      async collect() {
        return [];
      }
    }));

    await processCrawlJob({
      db,
      runId: run.id,
      taskId: task.id,
      createAdapter
    });

    const updatedTask = (await runs.listCrawlTasks(run.id))[0];
    const updatedRun = await runs.getById(run.id);
    const page = await contents.listByRunPage(run.id, { page: 1, pageSize: 10 });

    expect(updatedTask).toMatchObject({
      status: "success",
      collectedCount: 2,
      validCount: 2,
      pagesCollected: 2,
      stopReason: "target_reached"
    });
    expect(updatedRun?.status).toBe("content_ready");
    expect(page.items).toHaveLength(2);
    expect(createAdapter).toHaveBeenCalledWith(
      "reddit",
      expect.objectContaining({
        browserMode: "local_profile",
        maxScrolls: 5,
        maxItems: 150
      })
    );
  });
});
