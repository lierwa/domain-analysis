import { describe, expect, it } from "vitest";
import { createYoutubeAdapter, normalizeYoutubeCollectorItems } from "./youtube";

describe("normalizeYoutubeCollectorItems", () => {
  it("normalizes external collector rows into CollectedRawContent", () => {
    const items = normalizeYoutubeCollectorItems([
      {
        videoId: "abc123",
        url: "https://www.youtube.com/watch?v=abc123",
        title: "Vertical market research",
        channel: "Research Channel",
        channelHandle: "@research",
        transcript: "A transcript about vertical market analysis.",
        metrics: { view_count: 1200 },
        publishedAt: "2026-05-01T00:00:00.000Z",
        raw: { source: "yt_dlp" }
      }
    ]);

    expect(items).toEqual([
      {
        platform: "youtube",
        externalId: "abc123",
        url: "https://www.youtube.com/watch?v=abc123",
        authorName: "Research Channel",
        authorHandle: "@research",
        text: "Vertical market research\n\nA transcript about vertical market analysis.",
        metricsJson: { view_count: 1200 },
        publishedAt: "2026-05-01T00:00:00.000Z",
        rawJson: { source: "yt_dlp" }
      }
    ]);
  });

  it("drops login and error pages with no useful transcript or title text", () => {
    const items = normalizeYoutubeCollectorItems([
      { videoId: "blocked", url: "https://youtube.com/signin", title: "Sign in to confirm", transcript: "" }
    ]);

    expect(items).toEqual([]);
  });
});

describe("createYoutubeAdapter", () => {
  it("delegates collection to the configured external collector command", async () => {
    const adapter = createYoutubeAdapter(
      {
        YOUTUBE_COLLECTOR_COMMAND: process.execPath,
        YOUTUBE_COLLECTOR_ARGS:
          "-e \"process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({items:[{videoId:'v1',url:'https://youtu.be/v1',title:'AI agents',transcript:'buyer research'}]})))\""
      },
      5000
    );

    const result = await adapter.collect({
      name: "AI agents",
      includeKeywords: ["AI agents"],
      excludeKeywords: [],
      language: "en",
      limitPerRun: 1
    });
    const items = Array.isArray(result) ? result : result.items;

    expect(items).toHaveLength(1);
    expect(items[0]?.platform).toBe("youtube");
    expect(items[0]?.text).toContain("buyer research");
  });
});
