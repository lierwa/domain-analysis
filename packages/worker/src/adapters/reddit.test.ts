import { beforeEach, describe, expect, it, vi } from "vitest";
import got from "got";
import { PlaywrightCrawler, playwrightUtils } from "crawlee";
import {
  createRedditAdapter,
  createRedditPublicJsonAdapter,
  normalizeRedditBrowserRows
} from "./reddit";

const gotMock = vi.hoisted(() => vi.fn());
const crawleeMock = vi.hoisted(() => {
  const browserRows = [
    {
      id: "post_1",
      title: "Tattoo styles inspiration",
      body: "Fine line ideas",
      href: "/r/tattoo/comments/post_1/tattoo_styles_inspiration/",
      authorName: "u/artist",
      subreddit: "r/tattoo",
      scoreText: "12",
      commentsText: "3 comments",
      publishedAt: "2026-05-01T00:00:00.000Z"
    }
  ];
  const crawlerOptions: any[] = [];
  const runUrls: string[][] = [];
  let bodyText = "reddit search results";

  function createPage(index = 0) {
    const rows = browserRows.map((row) => ({
      ...row,
      id: index === 0 ? row.id : `${row.id}_${index}`,
      href: index === 0 ? row.href : `/r/tattoo/comments/${row.id}_${index}/tattoo_styles_inspiration/`
    }));
    return {
      evaluate: vi.fn(async (script: unknown) => typeof script === "string" ? rows : undefined),
      locator: vi.fn(() => ({
        innerText: vi.fn(async () => bodyText)
      }))
    };
  }

  return {
    crawlerOptions,
    runUrls,
    ProxyConfiguration: vi.fn(function MockProxyConfiguration(options: any) {
      return { options };
    }),
    PlaywrightCrawler: vi.fn(function MockPlaywrightCrawler(options: any) {
      crawlerOptions.push(options);
      return {
        run: vi.fn(async (urls: string[]) => {
          runUrls.push(urls);
          for (const [index, url] of urls.entries()) {
            await options.requestHandler({
              page: createPage(index),
              request: { url, errorMessages: [] },
              response: { status: () => 200 }
            });
          }
        })
      };
    }),
    infiniteScroll: vi.fn(async () => undefined),
    setBodyText(value: string) {
      bodyText = value;
    },
    reset() {
      crawlerOptions.length = 0;
      runUrls.length = 0;
      bodyText = "reddit search results";
      this.PlaywrightCrawler.mockClear();
      this.ProxyConfiguration.mockClear();
      this.infiniteScroll.mockClear();
    }
  };
});

vi.mock("got", () => ({
  default: gotMock
}));

vi.mock("crawlee", () => ({
  PlaywrightCrawler: crawleeMock.PlaywrightCrawler,
  ProxyConfiguration: crawleeMock.ProxyConfiguration,
  playwrightUtils: {
    infiniteScroll: crawleeMock.infiniteScroll
  }
}));

const query = {
  name: "tattoo",
  includeKeywords: ["tattoo styles"],
  excludeKeywords: [],
  language: "en",
  limitPerRun: 10
};

const redditBody = JSON.stringify({
  data: {
    children: [
      {
        data: {
          id: "post_1",
          name: "t3_post_1",
          title: "Tattoo styles inspiration",
          selftext: "Fine line ideas",
          permalink: "/r/tattoo/comments/post_1",
          author: "artist",
          subreddit: "tattoo",
          score: 12,
          num_comments: 3,
          created_utc: 1710000000
        }
      }
    ]
  }
});

beforeEach(() => {
  gotMock.mockReset();
  gotMock.mockResolvedValue({ statusCode: 200, body: redditBody });
  crawleeMock.reset();
});

describe("createRedditAdapter", () => {
  it("defaults to Crawlee PlaywrightCrawler instead of Reddit JSON endpoints", async () => {
    const adapter = createRedditAdapter({});

    const result = await adapter.collect({ ...query, limitPerRun: 1 });

    expect(result).toMatchObject({
      items: [expect.objectContaining({
        metricsJson: expect.objectContaining({ source: "reddit_browser_profile" })
      })],
      metadata: { pagesCollected: 1, stopReason: "target_reached" }
    });
    expect(got).not.toHaveBeenCalled();
    expect(PlaywrightCrawler).toHaveBeenCalled();
    expect(crawleeMock.crawlerOptions[0]).toMatchObject({
      maxConcurrency: 1,
      maxRequestsPerCrawl: 1,
      maxRequestsPerMinute: 4,
      sameDomainDelaySecs: 10,
      navigationTimeoutSecs: 60,
      requestHandlerTimeoutSecs: 300,
      retryOnBlocked: false
    });
    expect(playwrightUtils.infiniteScroll).toHaveBeenCalledWith(expect.any(Object), {
      timeoutSecs: 240,
      waitForSecs: 5
    });
  });

  it("expands narrow phrase searches into additional Reddit search pages", async () => {
    const adapter = createRedditAdapter({});

    await expect(adapter.collect({
      ...query,
      includeKeywords: ["tattoo design", "tattoo styles"],
      limitPerRun: 200
    })).resolves.toMatchObject({ metadata: { stopReason: "scroll_exhausted" } });

    const urls = crawleeMock.runUrls[0]?.map((value) => new URL(value));
    expect(urls?.map((url) => url.searchParams.get("q"))).toEqual([
      "\"tattoo design\" OR \"tattoo styles\"",
      "tattoo design OR tattoo styles",
      "tattoo OR design OR styles",
      "tattoo design",
      "tattoo styles"
    ]);
    expect(crawleeMock.crawlerOptions[0]?.maxRequestsPerCrawl).toBe(5);
  });

  it("passes configured proxy URLs into Crawlee launch context", async () => {
    const adapter = createRedditAdapter({ https_proxy: "http://127.0.0.1:7890" });

    await expect(adapter.collect(query)).resolves.toMatchObject({ metadata: { pagesCollected: 1 } });

    expect(crawleeMock.crawlerOptions[0]).toMatchObject({
      proxyConfiguration: expect.objectContaining({
        options: { proxyUrls: ["http://127.0.0.1:7890"] }
      })
    });
    expect(got).not.toHaveBeenCalled();
  });

  it("returns a blocked stop reason when Reddit shows a login or challenge page", async () => {
    crawleeMock.setBodyText("Sign in to continue");
    const adapter = createRedditAdapter({});

    await expect(adapter.collect(query)).resolves.toMatchObject({
      items: [],
      metadata: { pagesCollected: 1, stopReason: "blocked_or_login" }
    });

    expect(playwrightUtils.infiniteScroll).not.toHaveBeenCalled();
  });
});

describe("normalizeRedditBrowserRows", () => {
  it("normalizes DOM-extracted Reddit posts into raw content rows", () => {
    const items = normalizeRedditBrowserRows([
      {
        id: "post_1",
        title: "Tattoo styles inspiration",
        body: "Fine line ideas",
        href: "/r/tattoo/comments/post_1/tattoo_styles_inspiration/",
        authorName: "u/artist",
        subreddit: "r/tattoo",
        scoreText: "12",
        commentsText: "3 comments",
        publishedAt: "2026-05-01T00:00:00.000Z"
      }
    ], [], 10);

    expect(items).toEqual([
      {
        platform: "reddit",
        externalId: "post_1",
        url: "https://www.reddit.com/r/tattoo/comments/post_1/tattoo_styles_inspiration/",
        authorName: "artist",
        text: "Tattoo styles inspiration\n\nFine line ideas",
        metricsJson: {
          source: "reddit_browser_profile",
          score: 12,
          comments: 3,
          subreddit: "tattoo"
        },
        publishedAt: "2026-05-01T00:00:00.000Z",
        rawJson: {
          id: "post_1",
          title: "Tattoo styles inspiration",
          body: "Fine line ideas",
          href: "/r/tattoo/comments/post_1/tattoo_styles_inspiration/",
          authorName: "u/artist",
          subreddit: "r/tattoo",
          scoreText: "12",
          commentsText: "3 comments",
          publishedAt: "2026-05-01T00:00:00.000Z"
        }
      }
    ]);
  });

  it("deduplicates repeated DOM nodes by Reddit external id", () => {
    const items = normalizeRedditBrowserRows([
      { id: "t3_post_1", title: "Same post", href: "/r/test/comments/post_1/a/" },
      { id: "post_1", title: "Same post duplicate", href: "/r/test/comments/post_1/a/" }
    ], [], 10);

    expect(items).toHaveLength(1);
    expect(items[0]?.externalId).toBe("post_1");
  });
});

describe("createRedditPublicJsonAdapter", () => {
  it("passes configured proxy URLs into got's HTTPS agent", async () => {
    const adapter = createRedditPublicJsonAdapter({ https_proxy: "http://127.0.0.1:7890" });

    await expect(adapter.collect(query)).resolves.toHaveLength(1);

    expect(got).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      agent: expect.objectContaining({ https: expect.any(Object) })
    }));
  });

  it("keeps direct Reddit collection when no proxy is configured", async () => {
    const adapter = createRedditPublicJsonAdapter({});

    await expect(adapter.collect(query)).resolves.toHaveLength(1);

    expect(got).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      agent: undefined
    }));
  });

  it("maps Reddit public blocking status to a clear rate-limit error", async () => {
    gotMock.mockResolvedValueOnce({ statusCode: 403, body: "" });
    const adapter = createRedditPublicJsonAdapter({ https_proxy: "http://127.0.0.1:7890" });

    await expect(adapter.collect(query)).rejects.toThrow("reddit_public_rate_limited_403");
  });
});
