import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupDatabaseTempDir,
  createAnalysisRunRepository,
  createCrawlTaskRepository,
  createDb,
  createRawContentRepository,
  createSourceRepository,
  initializeDatabase
} from "@domain-analysis/db";
import { buildServer } from "../server";

let tempDir: string;
let databaseUrl: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-api-"));
  databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
  await initializeDatabase(databaseUrl);
});

afterEach(async () => {
  await cleanupDatabaseTempDir(tempDir);
});

describe("analysis project routes", () => {
  it("creates, fetches, and lists projects", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-projects",
      payload: {
        name: "AI Search Study",
        goal: "Understand user pain points",
        language: "en",
        market: "US"
      }
    });

    expect(created.statusCode).toBe(201);
    const project = created.json().item;
    expect(project).toMatchObject({ name: "AI Search Study", status: "active" });

    const fetched = await app.inject({
      method: "GET",
      url: `/api/analysis-projects/${project.id}`
    });
    const listed = await app.inject({
      method: "GET",
      url: "/api/analysis-projects?page=1&pageSize=20"
    });

    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().item.id).toBe(project.id);
    expect(listed.json()).toMatchObject({ items: [{ id: project.id }] });

    await app.close();
  });

  it("returns 404 for missing project", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const response = await app.inject({
      method: "GET",
      url: "/api/analysis-projects/proj_missing"
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("analysis run routes", () => {
  it("creates a run with auto project creation", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: {
        goal: "Understand AI search frustrations",
        platform: "reddit",
        includeKeywords: ["ChatGPT", "Perplexity"],
        excludeKeywords: [],
        language: "en",
        market: "US",
        limit: 50
      }
    });

    expect(created.statusCode).toBe(201);
    const run = created.json().item;
    expect(run.status).toBe("draft");
    expect(run.platform).toBe("reddit");
    expect(run.includeKeywords).toEqual(["ChatGPT", "Perplexity"]);
    expect(run.projectId).toBeTruthy();

    await app.close();
  });

  it("returns run by id and lists runs", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: {
        goal: "Test run",
        platform: "reddit",
        includeKeywords: ["test"],
        language: "en",
        market: "US",
        limit: 10
      }
    });
    const runId: string = created.json().item.id;

    const fetched = await app.inject({ method: "GET", url: `/api/analysis-runs/${runId}` });
    const listed = await app.inject({ method: "GET", url: "/api/analysis-runs?page=1&pageSize=20" });

    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().item.id).toBe(runId);
    expect(listed.json()).toMatchObject({ items: [{ id: runId }] });

    await app.close();
  });

  it("validates create run body", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const response = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: { goal: "no keywords" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("validation_error");

    await app.close();
  });

  it("rejects create run without an explicit platform", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const response = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: {
        goal: "No platform",
        includeKeywords: ["test"],
        language: "en",
        market: "US",
        limit: 10
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("validation_error");

    await app.close();
  });

  it("lists run crawl tasks and contents for a new run", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: {
        goal: "Empty run",
        platform: "reddit",
        includeKeywords: ["test"],
        language: "en",
        market: "US",
        limit: 10
      }
    });
    const runId: string = created.json().item.id;

    const tasks = await app.inject({ method: "GET", url: `/api/analysis-runs/${runId}/crawl-tasks` });
    const contents = await app.inject({
      method: "GET",
      url: `/api/analysis-runs/${runId}/contents?page=1&pageSize=20`
    });

    expect(tasks.statusCode).toBe(200);
    expect(tasks.json().items).toEqual([]);
    expect(contents.statusCode).toBe(200);
    expect(contents.json().items).toEqual([]);

    await app.close();
  });

  it("generates and reads AI-backed run insights", async () => {
    const db = createDb(databaseUrl);
    const app = await buildServer({
      logger: false,
      db,
      aiInsightAnalyzer: {
        analyzeRun: async ({ contents }) => ({
          items: contents.map((content) => ({
            rawContentId: content.id,
            problemStatement: "User needs placement confidence before booking.",
            userIntent: "Choose tattoo placement.",
            audienceSegment: "Tattoo planning user",
            needType: "placement decision",
            painPoints: ["uncertain placement"],
            desiredOutcome: "A clear next step",
            sentiment: "concerned",
            confidence: 0.8,
            evidence: [
              {
                source: "title",
                rawContentId: content.id,
                quote: content.text,
                url: content.url
              }
            ],
            recommendedAction: "Create a placement checklist."
          })),
          summary: {
            themes: [
              {
                themeName: "Placement confidence",
                whyItMatters: "Users need help deciding where a tattoo fits.",
                opportunityType: "content",
                demandSignals: ["placement question"],
                contentIdeas: ["Placement checklist"],
                productServiceIdeas: ["Consultation offer"],
                representativePostIds: [contents[0]?.id ?? ""],
                riskOrLimitations: ["Search result data may be incomplete."]
              }
            ],
            opportunityTypes: ["content"],
            topDemandSignals: ["placement question"],
            recommendedNextActions: ["Collect more comments"],
            dataLimitations: ["No visual model analysis."]
          }
        })
      }
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: {
        goal: "Tattoo opportunity study",
        platform: "reddit",
        includeKeywords: ["tattoo design"],
        language: "en",
        market: "US",
        limit: 10
      }
    });
    const runId: string = created.json().item.id;
    await seedRouteRunContent(db, runId, created.json().item.projectId);

    const generated = await app.inject({ method: "POST", url: `/api/analysis-runs/${runId}/insights` });
    const fetched = await app.inject({ method: "GET", url: `/api/analysis-runs/${runId}/insights?page=1&pageSize=20` });
    const latestRun = await app.inject({ method: "GET", url: `/api/analysis-runs/${runId}/insights/runs/latest` });
    const candidates = await app.inject({ method: "GET", url: `/api/analysis-runs/${runId}/insights/candidates?page=1&pageSize=20` });
    const batches = await app.inject({ method: "GET", url: `/api/analysis-runs/${runId}/insights/batches` });

    expect(generated.statusCode).toBe(201);
    expect(generated.json().summary.totalInsights).toBe(1);
    expect(generated.json().summary.themes[0]).toMatchObject({ themeName: "Placement confidence" });
    expect(generated.json().items[0]).toMatchObject({ needType: "placement decision", confidence: 0.8 });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().items[0].source).toMatchObject({ url: "https://www.reddit.com/r/tattooadvice/comments/route" });
    expect(latestRun.statusCode).toBe(200);
    expect(latestRun.json().item).toMatchObject({ status: "completed", totalRawCount: 1, selectedCandidateCount: 1 });
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json().items[0]).toMatchObject({ selected: true, batchIndex: 0 });
    expect(batches.statusCode).toBe(200);
    expect(batches.json().items[0]).toMatchObject({ status: "completed", candidateCount: 1, outputInsightCount: 1 });

    await app.close();
  });

  it("deletes a run", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: {
        goal: "Delete test",
        platform: "reddit",
        includeKeywords: ["test"],
        language: "en",
        market: "US",
        limit: 10
      }
    });
    const runId: string = created.json().item.id;

    const deleted = await app.inject({ method: "POST", url: `/api/analysis-runs/${runId}/delete` });
    const fetched = await app.inject({ method: "GET", url: `/api/analysis-runs/${runId}` });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().ok).toBe(true);
    expect(fetched.statusCode).toBe(404);

    await app.close();
  });

  it("does not delete a collecting run", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: {
        goal: "Collecting delete test",
        platform: "reddit",
        includeKeywords: ["test"],
        language: "en",
        market: "US",
        limit: 10
      }
    });
    const runId: string = created.json().item.id;
    await app.inject({ method: "POST", url: `/api/analysis-runs/${runId}/start` });

    const deleted = await app.inject({ method: "POST", url: `/api/analysis-runs/${runId}/delete` });

    expect(deleted.statusCode).toBe(400);
    expect(deleted.json().message).toContain("collecting");

    await app.close();
  });
});

async function seedRouteRunContent(db: ReturnType<typeof createDb>, runId: string, projectId: string) {
  const runs = createAnalysisRunRepository(db);
  const sources = createSourceRepository(db);
  const tasks = createCrawlTaskRepository(db);
  const contents = createRawContentRepository(db);
  await sources.seedDefaults();
  const source = await sources.getByPlatform("reddit");
  if (!source) throw new Error("reddit source missing");
  const task = await tasks.create({ analysisRunId: runId, sourceId: source.id, targetCount: 10 });
  await contents.createMany([
    {
      platform: "reddit",
      analysisProjectId: projectId,
      analysisRunId: runId,
      crawlTaskId: task.id,
      sourceId: source.id,
      matchedKeywords: ["tattoo design"],
      url: "https://www.reddit.com/r/tattooadvice/comments/route",
      text: "Advice on tattoo placement for my sleeve?",
      metricsJson: { score: 5, comments: 4, subreddit: "tattooadvice" },
      rawJson: { detail: { fetchStatus: "success", topComments: [{ text: "Upper arm works well." }] } }
    }
  ]);
  await runs.update(runId, { status: "content_ready", collectedCount: 1, validCount: 1 });
}

describe("reports routes", () => {
  it("lists reports and returns 404 for missing report", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const listed = await app.inject({ method: "GET", url: "/api/reports?page=1&pageSize=20" });
    const missing = await app.inject({ method: "GET", url: "/api/reports/report_missing" });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([]);
    expect(missing.statusCode).toBe(404);

    await app.close();
  });
});
