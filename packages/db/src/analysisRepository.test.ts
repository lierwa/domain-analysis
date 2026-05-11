import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAnalysisProjectRepository,
  createAnalysisRunRepository,
  createRunReportRepository
} from "./analysisRepositories";
import { cleanupDatabaseTempDir, createDb, initializeDatabase } from "./client";
import {
  createCrawlTaskRepository,
  createRawContentRepository,
  createSourceRepository
} from "./repositories";

let tempDir: string;
let databaseUrl: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-db-"));
  databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
  await initializeDatabase(databaseUrl);
});

afterEach(async () => {
  await cleanupDatabaseTempDir(tempDir);
});

describe("initializeDatabase", () => {
  it("creates SQLite when parent directory does not exist", async () => {
    const nestedUrl = `file:${join(tempDir, "nested", "runtime.sqlite")}`;
    await expect(initializeDatabase(nestedUrl)).resolves.not.toThrow();
  });

  it("is idempotent for the current schema", async () => {
    await expect(initializeDatabase(databaseUrl)).resolves.not.toThrow();
    await expect(initializeDatabase(databaseUrl)).resolves.not.toThrow();
  });
});

describe("analysis repositories", () => {
  it("creates projects and runs", async () => {
    const db = createDb(databaseUrl);
    const projects = createAnalysisProjectRepository(db);
    const runs = createAnalysisRunRepository(db);

    const project = await projects.create({
      name: "AI Search Study",
      goal: "Understand user pain points",
      language: "en",
      market: "US"
    });
    const run = await runs.create({
      projectId: project.id,
      name: "Run 1",
      goal: project.goal,
      includeKeywords: ["AI"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 100
    });

    expect(project.id).toMatch(/^proj_/);
    expect(project.defaultPlatform).toBe("web");
    expect(run.id).toMatch(/^run_/);
    expect(run.projectId).toBe(project.id);
    expect(run.status).toBe("draft");
  });

  it("updates run status and archives project", async () => {
    const db = createDb(databaseUrl);
    const projects = createAnalysisProjectRepository(db);
    const runs = createAnalysisRunRepository(db);

    const project = await projects.create({ name: "P", goal: "g", language: "en", market: "US" });
    const run = await runs.create({
      projectId: project.id,
      name: "Run",
      goal: project.goal,
      includeKeywords: ["kw"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 50
    });

    const updated = await runs.update(run.id, { status: "content_ready", collectedCount: 42 });
    const archived = await projects.archive(project.id);

    expect(updated?.status).toBe("content_ready");
    expect(updated?.collectedCount).toBe(42);
    expect(archived?.status).toBe("archived");
  });
});

describe("platform sources", () => {
  it("seeds multi-platform metadata while the current flow can still choose reddit", async () => {
    const db = createDb(databaseUrl);
    const sources = createSourceRepository(db);

    await sources.seedDefaults();
    const list = await sources.list();
    const reddit = await sources.getByPlatform("reddit");
    const tiktok = await sources.getByPlatform("tiktok");

    expect(list.map((source) => source.platform)).toEqual(
      expect.arrayContaining(["reddit", "x", "youtube", "tiktok", "pinterest", "web"])
    );
    expect(reddit?.enabled).toBe(true);
    expect(tiktok?.requiresLogin).toBe(true);
  });
});

describe("run content isolation", () => {
  it("requires run/project/task context and only returns content from the requested run", async () => {
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
    const run1 = await runs.create({
      projectId: project.id,
      name: "R1",
      goal: project.goal,
      includeKeywords: ["kw1"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 50
    });
    const run2 = await runs.create({
      projectId: project.id,
      name: "R2",
      goal: project.goal,
      includeKeywords: ["kw2"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 50
    });
    const task1 = await tasks.create({ analysisRunId: run1.id, sourceId: source.id, targetCount: 50 });
    const task2 = await tasks.create({ analysisRunId: run2.id, sourceId: source.id, targetCount: 50 });

    await contents.createMany([
      {
        platform: "reddit",
        analysisProjectId: project.id,
        analysisRunId: run1.id,
        crawlTaskId: task1.id,
        sourceId: source.id,
        matchedKeywords: ["kw1"],
        url: "https://reddit.com/r/test/1",
        text: "run1 content"
      },
      {
        platform: "reddit",
        analysisProjectId: project.id,
        analysisRunId: run2.id,
        crawlTaskId: task2.id,
        sourceId: source.id,
        matchedKeywords: ["kw2"],
        url: "https://reddit.com/r/test/2",
        text: "run2 content"
      }
    ]);

    const result1 = await contents.listByRunPage(run1.id, { page: 1, pageSize: 10 });
    const result2 = await contents.listByRunPage(run2.id, { page: 1, pageSize: 10 });

    expect(result1.items).toHaveLength(1);
    expect(result1.items[0]?.text).toBe("run1 content");
    expect(result1.items[0]?.crawlTaskId).toBe(task1.id);
    expect(result2.items).toHaveLength(1);
    expect(result2.items[0]?.text).toBe("run2 content");
  });

  it("deduplicates content by platform + externalId", async () => {
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
      name: "R",
      goal: project.goal,
      includeKeywords: ["kw"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 50
    });
    const task = await tasks.create({ analysisRunId: run.id, sourceId: source.id, targetCount: 50 });

    const common = {
      platform: "reddit" as const,
      analysisProjectId: project.id,
      analysisRunId: run.id,
      crawlTaskId: task.id,
      sourceId: source.id,
      matchedKeywords: ["kw"],
      url: "https://reddit.com/1",
      externalId: "ext_1"
    };
    const inserted = await contents.createMany([
      { ...common, text: "first" },
      { ...common, text: "duplicate" }
    ]);

    expect(inserted.items).toHaveLength(1);
    expect(inserted.duplicates).toBe(1);
  });
});

describe("run report repository", () => {
  it("creates and retrieves a run-bound report", async () => {
    const db = createDb(databaseUrl);
    const projects = createAnalysisProjectRepository(db);
    const runs = createAnalysisRunRepository(db);
    const reports = createRunReportRepository(db);

    const project = await projects.create({ name: "P", goal: "g", language: "en", market: "US" });
    const run = await runs.create({
      projectId: project.id,
      name: "R",
      goal: project.goal,
      includeKeywords: ["kw"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 50
    });

    const report = await reports.create({
      projectId: project.id,
      analysisRunId: run.id,
      title: "Test Report",
      type: "run_summary",
      contentMarkdown: "# Report\n\nContent here."
    });

    expect(report.id).toMatch(/^report_/);
    expect(report.analysisRunId).toBe(run.id);
    expect(report.contentMarkdown).toContain("Content here");
  });
});
