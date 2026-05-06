import { describe, expect, it } from "vitest";
import { querySchema, rawContentSchema, sourceSchema, topicSchema } from "./schemas";

describe("stage 1 domain schemas", () => {
  it("accepts a valid active topic", () => {
    const result = topicSchema.parse({
      id: "topic_1",
      name: "AI Search Trends",
      description: "Track customer questions about AI search tools",
      language: "en",
      market: "US",
      status: "active",
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });

    expect(result.name).toBe("AI Search Trends");
  });

  it("rejects an empty include keyword list", () => {
    const result = querySchema.safeParse({
      id: "query_1",
      topicId: "topic_1",
      name: "Empty query",
      includeKeywords: [],
      excludeKeywords: ["jobs"],
      platforms: ["reddit"],
      language: "en",
      frequency: "manual",
      limitPerRun: 50,
      status: "active",
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });

    expect(result.success).toBe(false);
  });

  it("accepts a source with crawler defaults", () => {
    const result = sourceSchema.parse({
      id: "source_1",
      platform: "web",
      name: "Web Pages",
      enabled: true,
      requiresLogin: false,
      crawlerType: "cheerio",
      defaultLimit: 100,
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z"
    });

    expect(result.defaultLimit).toBe(100);
  });

  it("accepts raw content collected from a platform adapter", () => {
    const result = rawContentSchema.parse({
      id: "raw_1",
      platform: "reddit",
      sourceId: "source_1",
      queryId: "query_1",
      topicId: "topic_1",
      externalId: "t3_1",
      url: "https://www.reddit.com/r/search/comments/1",
      authorName: "author",
      text: "AI search discussion",
      metricsJson: { score: 10 },
      publishedAt: "2026-05-06T00:00:00.000Z",
      capturedAt: "2026-05-06 00:00:00",
      rawJson: { id: "1" },
      createdAt: "2026-05-06 00:00:00"
    });

    expect(result.platform).toBe("reddit");
  });
});
