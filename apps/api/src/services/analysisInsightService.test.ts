import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupDatabaseTempDir,
  createAnalysisProjectRepository,
  createAnalysisRunRepository,
  createCrawlTaskRepository,
  createDb,
  createRawContentRepository,
  createSourceRepository,
  initializeDatabase
} from "@domain-analysis/db";
import { createAnalysisInsightService, type AiInsightAnalyzer } from "./analysisInsightService";
import { createAnalysisRunService } from "./analysisRunService";

describe("analysis insight service", () => {
  it("rejects insight generation when no AI provider is configured", async () => {
    const { db, tempDir } = await createTempDb();
    try {
      const { runId } = await seedContentReadyRun(db);
      const insightService = createAnalysisInsightService(db, { env: {} });

      await expect(insightService.generateInsights(runId)).rejects.toMatchObject({
        message: "ai_provider_not_configured",
        statusCode: 400
      });

      const current = await createAnalysisRunRepository(db).getById(runId);
      expect(current?.status).toBe("content_ready");
    } finally {
      await cleanupDatabaseTempDir(tempDir);
    }
  });

  it("stores schema-backed AI insights and lets reports use evidence-backed opportunities", async () => {
    const { db, tempDir } = await createTempDb();
    try {
      const { runId } = await seedContentReadyRun(db);
      const analyzer: AiInsightAnalyzer = {
        analyzeRun: async ({ contents }) => ({
          items: contents.map((content) => ({
            rawContentId: content.id,
            problemStatement: "User needs confidence before committing to a tattoo placement.",
            userIntent: "Choose a placement and design direction before booking.",
            audienceSegment: "Tattoo planning user",
            needType: "placement decision",
            painPoints: ["uncertain fit", "needs examples"],
            desiredOutcome: "A confident placement decision",
            sentiment: "concerned",
            confidence: 0.86,
            evidence: [
              {
                source: "post_body",
                rawContentId: content.id,
                quote: content.text,
                url: content.url
              }
            ],
            recommendedAction: "Create a placement guide backed by real examples."
          })),
          summary: {
            themes: [
              {
                themeName: "Placement confidence",
                whyItMatters: "Users need help visualizing tattoo fit before booking.",
                opportunityType: "content",
                demandSignals: ["placement question", "design uncertainty"],
                contentIdeas: ["Arm placement checklist"],
                productServiceIdeas: ["Placement consultation"],
                representativePostIds: [contents[0]?.id ?? ""],
                riskOrLimitations: ["Only text evidence is available."]
              }
            ],
            opportunityTypes: ["content"],
            topDemandSignals: ["placement question"],
            recommendedNextActions: ["Collect more top comments"],
            dataLimitations: ["Images were collected as URLs only."]
          }
        })
      };
      const insightService = createAnalysisInsightService(db, { analyzer, env: {} });

      const insights = await insightService.generateInsights(runId);
      const current = await createAnalysisRunRepository(db).getById(runId);
      const report = await createAnalysisRunService(db).generateReport(runId);

      expect(current).toMatchObject({ status: "insight_ready", analyzedCount: 2 });
      expect(insights.summary).toMatchObject({
        totalContents: 2,
        totalInsights: 2,
        themes: [{ themeName: "Placement confidence" }]
      });
      const firstInsight = insights.items[0]!;
      expect(firstInsight).toMatchObject({
        problemStatement: "User needs confidence before committing to a tattoo placement.",
        confidence: 0.86
      });
      expect(firstInsight.evidence?.[0]).toMatchObject({ source: "post_body" });
      expect(report.contentMarkdown).toContain("## 业务机会摘要");
      expect(report.contentMarkdown).toContain("Placement confidence");
    } finally {
      await cleanupDatabaseTempDir(tempDir);
    }
  });

  it("uses configured candidate limits and runs extraction batches concurrently with diagnostics", async () => {
    const { db, tempDir } = await createTempDb();
    try {
      const { runId } = await seedContentReadyRun(db, { extraCount: 5 });
      let active = 0;
      let maxActive = 0;
      const batchSizes: number[] = [];
      const analyzer: AiInsightAnalyzer = {
        analyzeRun: async ({ contents }) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          batchSizes.push(contents.length);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active -= 1;
          return {
            items: contents.map((content) => ({
              rawContentId: content.id,
              problemStatement: `Need signal from ${content.id}`,
              userIntent: "Evaluate tattoo planning options.",
              audienceSegment: "Tattoo planning user",
              needType: "planning signal",
              painPoints: ["unclear next step"],
              desiredOutcome: "A clearer planning decision",
              sentiment: "concerned",
              confidence: 0.75,
              evidence: [{ source: "post_body", rawContentId: content.id, quote: content.text, url: content.url }],
              recommendedAction: "Create a planning guide."
            })),
            summary: {
              themes: [],
              opportunityTypes: ["content"],
              topDemandSignals: ["planning"],
              recommendedNextActions: ["Review selected evidence"],
              dataLimitations: []
            }
          };
        }
      };
      const insightService = createAnalysisInsightService(db, {
        analyzer,
        env: {
          AI_INSIGHTS_MAX_ITEMS_PER_BATCH: "2",
          AI_INSIGHTS_MAX_CANDIDATES: "4",
          AI_INSIGHTS_MAX_CONCURRENT_BATCHES: "2",
          AI_INSIGHTS_TEXT_CHAR_LIMIT: "40",
          AI_INSIGHTS_DETAIL_CHAR_LIMIT: "80",
          AI_INSIGHTS_MIN_TEXT_CHARS: "20"
        }
      });

      await insightService.generateInsights(runId);
      const latest = await insightService.getLatestInsightRun(runId);
      const candidates = await insightService.listInsightCandidates(runId, { page: 1, pageSize: 20 });
      const batches = await insightService.listInsightBatches(runId);

      expect(batchSizes).toEqual([2, 2]);
      expect(maxActive).toBe(2);
      expect(latest).toMatchObject({
        status: "completed",
        totalRawCount: 7,
        selectedCandidateCount: 4,
        batchCount: 2,
        configSnapshot: {
          maxItemsPerBatch: 2,
          maxCandidates: 4,
          maxConcurrentBatches: 2,
          textCharLimit: 40,
          detailCharLimit: 80
        }
      });
      expect(candidates.page.total).toBe(7);
      expect(candidates.items.filter((candidate) => candidate.selected)).toHaveLength(4);
      expect(candidates.items.some((candidate) => candidate.excludedReason === "budget_cap")).toBe(true);
      expect(batches.items).toHaveLength(2);
      expect(batches.items.every((batch) => batch.status === "completed" && batch.rawContentIds.length <= 2)).toBe(true);
    } finally {
      await cleanupDatabaseTempDir(tempDir);
    }
  });

  it("keeps previous official insights when a later batch fails", async () => {
    const { db, tempDir } = await createTempDb();
    try {
      const { runId } = await seedContentReadyRun(db, { extraCount: 3 });
      const successfulAnalyzer: AiInsightAnalyzer = {
        analyzeRun: async ({ contents }) => ({
          items: contents.map((content) => ({
            rawContentId: content.id,
            problemStatement: "Stable planning insight",
            userIntent: "Plan tattoo placement.",
            audienceSegment: "Tattoo planning user",
            needType: "planning signal",
            painPoints: ["uncertain placement"],
            desiredOutcome: "A confident plan",
            sentiment: "concerned",
            confidence: 0.8,
            evidence: [{ source: "post_body", rawContentId: content.id, quote: content.text, url: content.url }],
            recommendedAction: "Create planning content."
          })),
          summary: {
            themes: [],
            opportunityTypes: ["content"],
            topDemandSignals: ["planning"],
            recommendedNextActions: [],
            dataLimitations: []
          }
        })
      };
      const firstService = createAnalysisInsightService(db, {
        analyzer: successfulAnalyzer,
        env: { AI_INSIGHTS_MAX_CANDIDATES: "2", AI_INSIGHTS_MAX_ITEMS_PER_BATCH: "2" }
      });
      await firstService.generateInsights(runId);

      const failingService = createAnalysisInsightService(db, {
        analyzer: {
          analyzeRun: async () => {
            throw new Error("schema_mismatch_for_test");
          }
        },
        env: { AI_INSIGHTS_MAX_CANDIDATES: "2", AI_INSIGHTS_MAX_ITEMS_PER_BATCH: "2" }
      });

      await expect(failingService.generateInsights(runId)).rejects.toMatchObject({
        message: "schema_mismatch_for_test",
        statusCode: 502
      });
      const latest = await failingService.getLatestInsightRun(runId);
      const insights = await failingService.getRunInsights(runId, { page: 1, pageSize: 20 });

      expect(latest).toMatchObject({ status: "failed", errorMessage: "schema_mismatch_for_test" });
      expect(insights.summary.totalInsights).toBe(2);
      expect(insights.items[0]?.problemStatement).toBe("Stable planning insight");
    } finally {
      await cleanupDatabaseTempDir(tempDir);
    }
  });
});

async function createTempDb() {
  const tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-insights-"));
  const databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
  await initializeDatabase(databaseUrl);
  return { db: createDb(databaseUrl), tempDir };
}

async function seedContentReadyRun(db: ReturnType<typeof createDb>, options: { extraCount?: number } = {}) {
  const projects = createAnalysisProjectRepository(db);
  const runs = createAnalysisRunRepository(db);
  const sources = createSourceRepository(db);
  const tasks = createCrawlTaskRepository(db);
  const contents = createRawContentRepository(db);

  await sources.seedDefaults();
  const source = await sources.getByPlatform("reddit");
  if (!source) throw new Error("reddit source missing");

  const project = await projects.create({
    name: "Tattoo Study",
    goal: "Find tattoo business opportunities",
    language: "en",
    market: "US"
  });
  const run = await runs.create({
    projectId: project.id,
    name: "tattoo design - May 13",
    goal: project.goal,
    includeKeywords: ["tattoo design"],
    excludeKeywords: [],
    language: "en",
    market: "US",
    limit: 200
  });
  const task = await tasks.create({ analysisRunId: run.id, sourceId: source.id, targetCount: 200 });

  const baseContents = [
    {
      platform: "reddit" as const,
      analysisProjectId: project.id,
      analysisRunId: run.id,
      crawlTaskId: task.id,
      sourceId: source.id,
      matchedKeywords: ["tattoo design"],
      url: "https://www.reddit.com/r/tattooadvice/comments/1",
      text: "Advice on next tattoo design and placement on arm?\n\nI want this to fit my sleeve.",
      mediaUrls: ["https://i.redd.it/example.jpg"],
      metricsJson: { score: 4, comments: 9, subreddit: "tattooadvice" },
      rawJson: {
        detail: {
          fetchStatus: "success",
          topComments: [{ author: "helper", text: "Try upper arm placement.", score: 5 }]
        }
      }
    },
    {
      platform: "reddit" as const,
      analysisProjectId: project.id,
      analysisRunId: run.id,
      crawlTaskId: task.id,
      sourceId: source.id,
      matchedKeywords: ["tattoo design"],
      url: "https://www.reddit.com/r/artcommissions/comments/2",
      text: "[Hiring] Digital tattoo artist. Max budget $100 each",
      metricsJson: { score: 13, comments: 2, subreddit: "artcommissions" },
      rawJson: { detail: { fetchStatus: "failed", error: "timeout" } }
    }
  ];
  const extraContents = Array.from({ length: options.extraCount ?? 0 }, (_, index) => ({
    platform: "reddit" as const,
    analysisProjectId: project.id,
    analysisRunId: run.id,
    crawlTaskId: task.id,
    sourceId: source.id,
    matchedKeywords: ["tattoo design"],
    url: `https://www.reddit.com/r/tattooadvice/comments/extra-${index}`,
    text: `How should I plan tattoo design number ${index} with placement and long term care concerns?`,
    metricsJson: { score: 20 - index, comments: 5 - Math.min(index, 4), subreddit: "tattooadvice" },
    rawJson: {
      detail: {
        fetchStatus: "success",
        topComments: [{ author: "helper", text: `Detailed planning reply ${index}`, score: 3 }]
      }
    }
  }));

  await contents.createMany([...baseContents, ...extraContents]);
  const total = 2 + (options.extraCount ?? 0);
  await runs.update(run.id, { status: "content_ready", validCount: total, collectedCount: total });
  return { runId: run.id };
}
