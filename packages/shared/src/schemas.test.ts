import { describe, expect, it } from "vitest";
import {
  analysisProjectSchema,
  analysisRunSchema,
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
});
