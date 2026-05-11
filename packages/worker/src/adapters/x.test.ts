import { describe, expect, it, vi } from "vitest";
import { ExternalCollectorError } from "../collectors/externalCollector";
import { buildNitterSearchRssUrl, buildXSearchUrl, createXAdapter, createXExternalAdapter } from "./x";

vi.mock("playwright", () => ({
  chromium: {
    launchPersistentContext: vi.fn(async () => ({
      cookies: vi.fn(async () => []),
      close: vi.fn(async () => undefined),
      newPage: vi.fn(async () => ({
        goto: vi.fn(async () => undefined),
        waitForTimeout: vi.fn(async () => undefined)
      })),
      pages: vi.fn(() => [])
    }))
  }
}));

const query = {
  name: "tattoo",
  includeKeywords: ["tattoo design"],
  excludeKeywords: [],
  language: "en",
  limitPerRun: 10
};

describe("createXAdapter", () => {
  it("does not default to third-party Nitter instances", async () => {
    const adapter = createXAdapter({});

    await expect(adapter.collect(query)).rejects.toMatchObject({
      code: "login_required",
      message: expect.stringContaining("Open Settings")
    });
  });

  it("keeps Nitter RSS as explicit opt-in fallback only", () => {
    const url = buildNitterSearchRssUrl(
      { X_NITTER_BASE_URL: "https://nitter.example" },
      ["tattoo design"],
      ["spam"]
    );

    expect(url.origin).toBe("https://nitter.example");
    expect(url.pathname).toBe("/search/rss");
    expect(url.searchParams.get("q")).toContain('"tattoo design"');
  });

  it("uses stable collector error type for missing twscrape/twikit command", async () => {
    const adapter = createXExternalAdapter({ X_COLLECTION_MODE: "twscrape" });

    await expect(adapter.collect(query)).rejects.toBeInstanceOf(ExternalCollectorError);
    await expect(adapter.collect(query)).rejects.toMatchObject({ code: "login_required" });
  });

  it("builds the first-party X search URL for browser-profile collection", () => {
    const url = buildXSearchUrl(["tattoo design"], ["spam"]);

    expect(url.origin).toBe("https://x.com");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toContain('"tattoo design"');
  });
});
