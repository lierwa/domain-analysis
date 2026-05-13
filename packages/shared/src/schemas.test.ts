import { describe, expect, it } from "vitest";
import {
  analysisProjectSchema,
  analysisBatchSchema,
  analysisRunSchema,
  crawlTaskSchema,
  createAnalysisBatchInputSchema,
  createCollectionPlanInputSchema,
  createAnalysisRunInputSchema,
  runContentSchema,
  sourceSchema
} from "./schemas";

describe("analysis domain schemas", () => {
  it("accepts an analysis batch with aggregate counters", () => {
    const result = analysisBatchSchema.parse({
      id: "batch_1",
      projectId: "proj_1",
      name: "Tattoo research",
      status: "partial_ready",
      goal: "Understand tattoo design demand",
      includeKeywords: ["tattoo design"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      collectedCount: 250,
      validCount: 180,
      duplicateCount: 70,
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });

    expect(result.status).toBe("partial_ready");
  });

  it("validates unique platform limits for a batch", () => {
    const valid = createAnalysisBatchInputSchema.parse({
      goal: "Compare platform demand",
      includeKeywords: ["tattoo design"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      platformLimits: [
        { platform: "reddit", limit: 200 },
        { platform: "x", limit: 200 }
      ]
    });

    expect(valid.platformLimits).toHaveLength(2);

    const duplicate = createAnalysisBatchInputSchema.safeParse({
      goal: "Compare platform demand",
      includeKeywords: ["tattoo design"],
      language: "en",
      market: "US",
      platformLimits: [
        { platform: "reddit", limit: 200 },
        { platform: "reddit", limit: 50 }
      ]
    });

    expect(duplicate.success).toBe(false);
  });

  it("accepts an analysis project", () => {
    const result = analysisProjectSchema.parse({
      id: "proj_1",
      name: "AI Search Study",
      goal: "Understand customer questions about AI search tools",
      language: "en",
      market: "US",
      defaultPlatform: "web",
      defaultLimit: 100,
      status: "active",
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });

    expect(result.defaultPlatform).toBe("web");
  });

  it("requires users to choose an analysis run platform", () => {
    const result = createAnalysisRunInputSchema.safeParse({
      goal: "Collect public tattoo design pages",
      includeKeywords: ["tattoo design"],
      language: "en",
      market: "US",
      limit: 50
    });

    expect(result.success).toBe(false);
  });

  it("accepts no_content as a finished run state", () => {
    const result = analysisRunSchema.parse({
      id: "run_1",
      projectId: "proj_1",
      name: "Run 1",
      status: "no_content",
      includeKeywords: ["AI search"],
      excludeKeywords: [],
      platform: "reddit",
      limit: 50,
      collectedCount: 10,
      validCount: 0,
      duplicateCount: 10,
      analyzedCount: 0,
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });

    expect(result.status).toBe("no_content");
  });

  it("rejects an analysis run create input with empty include keywords", () => {
    const result = createAnalysisRunInputSchema.safeParse({
      goal: "Empty query",
      includeKeywords: [],
      excludeKeywords: ["jobs"],
      language: "en",
      market: "US",
      limit: 50
    });

    expect(result.success).toBe(false);
  });

  it("accepts a source with crawler defaults", () => {
    const result = sourceSchema.parse({
      id: "source_1",
      platform: "tiktok",
      name: "TikTok",
      enabled: true,
      requiresLogin: true,
      crawlerType: "playwright",
      defaultLimit: 50,
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });

    expect(result.platform).toBe("tiktok");
  });

  it("accepts crawl task observability fields", () => {
    const result = crawlTaskSchema.parse({
      id: "task_1",
      analysisRunId: "run_1",
      sourceId: "source_1",
      status: "success",
      targetCount: 200,
      collectedCount: 35,
      validCount: 30,
      duplicateCount: 5,
      pagesCollected: 1,
      stopReason: "scroll_exhausted",
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });

    expect(result.stopReason).toBe("scroll_exhausted");
    expect(result.pagesCollected).toBe(1);
  });

  it("accepts an analysis run dto", () => {
    const result = analysisRunSchema.parse({
      id: "run_1",
      projectId: "proj_1",
      name: "Run 1",
      status: "content_ready",
      includeKeywords: ["AI search"],
      excludeKeywords: [],
      platform: "web",
      limit: 50,
      collectedCount: 10,
      validCount: 8,
      duplicateCount: 2,
      analyzedCount: 0,
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });

    expect(result.status).toBe("content_ready");
  });

  it("accepts run content with required project/run/task context", () => {
    const result = runContentSchema.parse({
      id: "raw_1",
      platform: "reddit",
      analysisProjectId: "proj_1",
      analysisRunId: "run_1",
      crawlTaskId: "task_1",
      sourceId: "source_1",
      url: "https://www.reddit.com/r/search/comments/1",
      authorName: "author",
      text: "AI search discussion",
      matchedKeywords: ["AI search"],
      metricsJson: { score: 10 },
      publishedAt: "2026-05-06T00:00:00.000Z",
      capturedAt: "2026-05-06 00:00:00"
    });

    expect(result.analysisRunId).toBe("run_1");
  });
});

describe("createCollectionPlanInputSchema", () => {
  it("defaults conservative collection options", () => {
    const input = createCollectionPlanInputSchema.parse({
      projectId: "proj_1",
      name: "AI search monitoring",
      includeKeywords: ["AI search"],
      language: "en",
      market: "US"
    });

    expect(input.platform).toBe("web");
    expect(input.excludeKeywords).toEqual([]);
    expect(input.cadence).toBe("daily");
    expect(input.batchLimit).toBe(100);
    expect(input.maxRunsPerDay).toBe(4);
  });

  it("rejects unsupported cadence", () => {
    expect(() =>
      createCollectionPlanInputSchema.parse({
        projectId: "proj_1",
        name: "Bad cadence",
        includeKeywords: ["AI search"],
        language: "en",
        market: "US",
        cadence: "every_second"
      })
    ).toThrow();
  });
});
