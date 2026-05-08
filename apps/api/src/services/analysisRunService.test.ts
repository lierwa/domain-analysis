import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, initializeDatabase } from "@domain-analysis/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalysisRunService } from "./analysisRunService";

let tempDir: string;
let databaseUrl: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-api-run-"));
  databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
  await initializeDatabase(databaseUrl);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tempDir, { recursive: true, force: true });
});

describe("analysis run service", () => {
  it("enqueues lightweight crawl jobs and leaves tasks pending until the worker consumes them", async () => {
    const db = createDb(databaseUrl);
    const enqueueCrawlJob = vi.fn().mockResolvedValue(undefined);
    const service = createAnalysisRunService(db, {
      crawlJobQueue: { enqueueCrawlJob }
    });

    const run = await service.createRun({
      projectName: "AI search",
      goal: "Track AI search product pain points",
      includeKeywords: ["AI search"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 100,
      platforms: ["reddit", "youtube", "x"],
      maxItemsPerPlatform: 25
    });
    const started = await service.startRun(run.id);
    const task = (await service.listRunCrawlTasks(run.id))[0];

    expect(started?.status).toBe("collecting");
    expect(task?.status).toBe("pending");
    expect(task?.targetCount).toBe(25);
    expect(await service.listRunCrawlTasks(run.id)).toHaveLength(3);
    expect(enqueueCrawlJob).toHaveBeenCalledTimes(3);
  });

  it("keeps a 500 target count for the v2 paginated crawler", async () => {
    const db = createDb(databaseUrl);
    const service = createAnalysisRunService(db, {
      crawlJobQueue: { enqueueCrawlJob: vi.fn().mockResolvedValue(undefined) }
    });

    const run = await service.createRun({
      projectName: "AI search",
      goal: "Track AI search product pain points",
      includeKeywords: ["AI search"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 500
    });
    await service.startRun(run.id);
    const task = (await service.listRunCrawlTasks(run.id))[0];

    expect(task?.targetCount).toBe(500);
  });

  it("does not mutate run state when Redis queue config is missing", async () => {
    vi.stubEnv("REDIS_URL", "");
    const db = createDb(databaseUrl);
    const service = createAnalysisRunService(db);

    const run = await service.createRun({
      projectName: "AI search",
      goal: "Track AI search product pain points",
      includeKeywords: ["AI search"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 100
    });

    await expect(service.startRun(run.id)).rejects.toThrow("missing_REDIS_URL_for_crawl_queue");
    const after = await service.getRunById(run.id);
    const tasks = await service.listRunCrawlTasks(run.id);

    expect(after?.status).toBe("draft");
    expect(tasks).toHaveLength(0);
  });
});
