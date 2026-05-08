import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAnalysisProjectRepository,
  createAnalysisRunRepository,
  createRunReportRepository
} from "./analysisRepositories";
import { createDb, initializeDatabase } from "./client";
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
  await rm(tempDir, { recursive: true, force: true });
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

  it("adds collection plan columns to an existing local schema", async () => {
    const legacyUrl = `file:${join(tempDir, "legacy.sqlite")}`;
    const legacyClient = createClient({ url: legacyUrl });
    await legacyClient.executeMultiple(`
      CREATE TABLE analysis_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        goal TEXT NOT NULL,
        language TEXT NOT NULL,
        market TEXT NOT NULL,
        default_platform TEXT NOT NULL DEFAULT 'reddit',
        default_limit INTEGER NOT NULL DEFAULT 100,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE analysis_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES analysis_projects(id),
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        include_keywords TEXT NOT NULL,
        exclude_keywords TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'reddit',
        run_limit INTEGER NOT NULL DEFAULT 100,
        collected_count INTEGER NOT NULL DEFAULT 0,
        valid_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        analyzed_count INTEGER NOT NULL DEFAULT 0,
        report_id TEXT,
        error_message TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO analysis_projects (id, name, goal, language, market)
      VALUES ('proj_legacy', 'Legacy', 'g', 'en', 'US');
      INSERT INTO analysis_runs (
        id,
        project_id,
        name,
        include_keywords,
        exclude_keywords
      )
      VALUES ('run_legacy', 'proj_legacy', 'Legacy Run', '["kw"]', '[]');
    `);

    await initializeDatabase(legacyUrl);
    const runs = createAnalysisRunRepository(createDb(legacyUrl));
    const page = await runs.listPage({ page: 1, pageSize: 20 });

    expect(page.items[0]).toMatchObject({
      id: "run_legacy",
      collectionPlanId: undefined,
      runTrigger: "manual"
    });
  });

  it("adds crawl pagination columns to an existing local schema", async () => {
    const legacyUrl = `file:${join(tempDir, "legacy-crawl.sqlite")}`;
    const legacyClient = createClient({ url: legacyUrl });
    await legacyClient.executeMultiple(`
      CREATE TABLE analysis_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        goal TEXT NOT NULL,
        language TEXT NOT NULL,
        market TEXT NOT NULL,
        default_platform TEXT NOT NULL DEFAULT 'reddit',
        default_limit INTEGER NOT NULL DEFAULT 100,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE analysis_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES analysis_projects(id),
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        include_keywords TEXT NOT NULL,
        exclude_keywords TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'reddit',
        run_limit INTEGER NOT NULL DEFAULT 100,
        collected_count INTEGER NOT NULL DEFAULT 0,
        valid_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        analyzed_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        requires_login INTEGER NOT NULL DEFAULT 0,
        crawler_type TEXT NOT NULL DEFAULT 'cheerio',
        default_limit INTEGER NOT NULL DEFAULT 100,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE crawl_tasks (
        id TEXT PRIMARY KEY,
        analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id),
        source_id TEXT NOT NULL REFERENCES sources(id),
        status TEXT NOT NULL DEFAULT 'pending',
        target_count INTEGER NOT NULL DEFAULT 100,
        collected_count INTEGER NOT NULL DEFAULT 0,
        valid_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO analysis_projects (id, name, goal, language, market)
      VALUES ('proj_legacy', 'Legacy', 'g', 'en', 'US');
      INSERT INTO analysis_runs (id, project_id, name, include_keywords, exclude_keywords)
      VALUES ('run_legacy', 'proj_legacy', 'Legacy Run', '["kw"]', '[]');
      INSERT INTO sources (id, platform, name) VALUES ('source_reddit', 'reddit', 'Reddit');
      INSERT INTO crawl_tasks (id, analysis_run_id, source_id)
      VALUES ('task_legacy', 'run_legacy', 'source_reddit');
    `);

    await initializeDatabase(legacyUrl);
    const db = createDb(legacyUrl);
    const tasks = createCrawlTaskRepository(db);
    const updated = await tasks.update("task_legacy", {
      pagesCollected: 2,
      lastCursor: "t3_cursor",
      stopReason: "rate_limited",
      lastRequestAt: "2026-05-07T00:00:00.000Z",
      nextRequestAt: "2026-05-07T00:01:00.000Z"
    });

    expect(updated).toMatchObject({
      pagesCollected: 2,
      lastCursor: "t3_cursor",
      stopReason: "rate_limited",
      lastRequestAt: "2026-05-07T00:00:00.000Z",
      nextRequestAt: "2026-05-07T00:01:00.000Z"
    });
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
    expect(project.defaultPlatform).toBe("reddit");
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

  it("updates crawl task pagination progress", async () => {
    const db = createDb(databaseUrl);
    const projects = createAnalysisProjectRepository(db);
    const runs = createAnalysisRunRepository(db);
    const sources = createSourceRepository(db);
    const tasks = createCrawlTaskRepository(db);

    await sources.seedDefaults();
    const source = await sources.getByPlatform("reddit");
    if (!source) throw new Error("source not found");
    const project = await projects.create({ name: "P", goal: "g", language: "en", market: "US" });
    const run = await runs.create({
      projectId: project.id,
      name: "Run",
      goal: project.goal,
      includeKeywords: ["kw"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 500
    });
    const task = await tasks.create({ analysisRunId: run.id, sourceId: source.id, targetCount: 500 });

    const updated = await tasks.update(task.id, {
      status: "running",
      collectedCount: 100,
      pagesCollected: 1,
      lastCursor: "t3_after",
      stopReason: null,
      lastRequestAt: "2026-05-07T00:00:00.000Z",
      nextRequestAt: "2026-05-07T00:00:20.000Z"
    });

    expect(updated).toMatchObject({
      targetCount: 500,
      collectedCount: 100,
      pagesCollected: 1,
      lastCursor: "t3_after",
      stopReason: undefined,
      lastRequestAt: "2026-05-07T00:00:00.000Z",
      nextRequestAt: "2026-05-07T00:00:20.000Z"
    });
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
