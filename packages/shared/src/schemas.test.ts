import { describe, expect, it } from "vitest";
import {
  analysisProjectSchema,
  analysisRunSchema,
  crawlTaskSchema,
  createCollectionPlanInputSchema,
  createAnalysisRunInputSchema,
  runContentSchema,
  sourceSchema
} from "./schemas";

describe("analysis domain schemas", () => {
  it("accepts an analysis project", () => {
    const result = analysisProjectSchema.parse({
      id: "proj_1",
      name: "AI Search Study",
      goal: "Understand customer questions about AI search tools",
      language: "en",
      market: "US",
      defaultPlatform: "reddit",
      defaultLimit: 100,
      status: "active",
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });

    expect(result.defaultPlatform).toBe("reddit");
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

  it("accepts a 500 item analysis run for paginated Reddit collection", () => {
    const result = createAnalysisRunInputSchema.parse({
      goal: "Deep Reddit crawl",
      includeKeywords: ["AI search"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 500
    });

    expect(result.limit).toBe(500);
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

  it("accepts an analysis run dto", () => {
    const result = analysisRunSchema.parse({
      id: "run_1",
      projectId: "proj_1",
      name: "Run 1",
      status: "content_ready",
      includeKeywords: ["AI search"],
      excludeKeywords: [],
      platform: "reddit",
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

  it("accepts crawl task pagination progress fields", () => {
    const result = crawlTaskSchema.parse({
      id: "task_1",
      analysisRunId: "run_1",
      sourceId: "source_1",
      status: "rate_limited",
      targetCount: 500,
      collectedCount: 200,
      validCount: 180,
      duplicateCount: 20,
      errorMessage: "reddit_public_rate_limited_429",
      pagesCollected: 2,
      lastCursor: "t3_after",
      stopReason: "rate_limited",
      lastRequestAt: "2026-05-06T00:00:00.000Z",
      nextRequestAt: "2026-05-06T00:01:00.000Z",
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });

    expect(result.pagesCollected).toBe(2);
    expect(result.stopReason).toBe("rate_limited");
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

    expect(input.platform).toBe("reddit");
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
