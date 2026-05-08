import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRedditPaginatedAdapter } from "./redditPaginated";

// WHY: 用 mock 替换 crawlee HttpCrawler，隔离网络依赖，只测试分页逻辑本身。
vi.mock("crawlee", () => {
  return {
    HttpCrawler: vi.fn()
  };
});

import { HttpCrawler } from "crawlee";

const MockHttpCrawler = HttpCrawler as unknown as ReturnType<typeof vi.fn>;

function makeMockCrawler(pages: Array<{ items: string[]; nextCursor?: string; status?: number }>) {
  let callCount = 0;
  MockHttpCrawler.mockImplementation((options: {
    requestHandler: (ctx: { body: string }) => Promise<void>;
    failedRequestHandler?: (ctx: { response?: { statusCode: number }; request: { errorMessages: string[] } }, err: Error) => Promise<void>;
  }) => {
    return {
      run: vi.fn().mockImplementation(async () => {
        const page = pages[callCount];
        callCount++;
        if (page?.status && (page.status === 403 || page.status === 429)) {
          await options.failedRequestHandler?.(
            { response: { statusCode: page.status }, request: { errorMessages: [] } },
            new Error("http error")
          );
          return;
        }
        const body = JSON.stringify({
          data: {
            after: page?.nextCursor ?? null,
            children: (page?.items ?? []).map((text, i) => ({
              data: {
                id: `post_${callCount}_${i}`,
                name: `t3_post_${callCount}_${i}`,
                title: text,
                selftext: "",
                author: "testuser",
                permalink: `/r/test/comments/post_${callCount}_${i}`,
                score: 10,
                num_comments: 5,
                subreddit: "test",
                created_utc: Date.now() / 1000
              }
            }))
          }
        });
        await options.requestHandler({ body });
      })
    };
  });
}

describe("createRedditPaginatedAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("单页即满足 targetCount 时只发一次请求", async () => {
    // 准备 50 条数据的首页
    makeMockCrawler([
      { items: Array.from({ length: 50 }, (_, i) => `Post ${i}`), nextCursor: "cursor_page2" }
    ]);

    const adapter = createRedditPaginatedAdapter({ pageDelayMs: 0, jitterMs: 0 });
    const result = await adapter.collectPaginated({
      name: "test",
      includeKeywords: ["test"],
      excludeKeywords: [],
      language: "en",
      limitPerRun: 50
    });

    expect(result.stopReason).toBe("target_reached");
    expect(result.items).toHaveLength(50);
    expect(result.pagesCollected).toBe(1);
    expect(MockHttpCrawler).toHaveBeenCalledTimes(1);
  });

  it("跨两页采集 150 条数据", async () => {
    makeMockCrawler([
      { items: Array.from({ length: 100 }, (_, i) => `Page1 Post ${i}`), nextCursor: "cursor_p2" },
      { items: Array.from({ length: 100 }, (_, i) => `Page2 Post ${i}`), nextCursor: "cursor_p3" }
    ]);

    const adapter = createRedditPaginatedAdapter({ pageDelayMs: 0, jitterMs: 0 });
    const result = await adapter.collectPaginated({
      name: "test",
      includeKeywords: ["test"],
      excludeKeywords: [],
      language: "en",
      limitPerRun: 150
    });

    expect(result.stopReason).toBe("target_reached");
    expect(result.items).toHaveLength(150);
    expect(result.pagesCollected).toBe(2);
  });

  it("每页完成后上报分页进度", async () => {
    makeMockCrawler([
      { items: Array.from({ length: 100 }, (_, i) => `Page1 Post ${i}`), nextCursor: "cursor_p2" },
      { items: Array.from({ length: 50 }, (_, i) => `Page2 Post ${i}`), nextCursor: undefined }
    ]);
    const onPage = vi.fn().mockResolvedValue(undefined);

    const adapter = createRedditPaginatedAdapter({ pageDelayMs: 0, jitterMs: 0, onPage });
    await adapter.collectPaginated({
      name: "test",
      includeKeywords: ["test"],
      excludeKeywords: [],
      language: "en",
      limitPerRun: 150
    });

    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onPage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ items: expect.any(Array), pagesCollected: 1, nextCursor: "cursor_p2" })
    );
    expect(onPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ items: expect.any(Array), pagesCollected: 2, nextCursor: undefined })
    );
  });

  it("遇到 403 立即停止并返回 rate_limited", async () => {
    makeMockCrawler([
      { items: Array.from({ length: 100 }, (_, i) => `Post ${i}`), nextCursor: "cursor_p2" },
      { items: [], status: 403 }
    ]);

    const adapter = createRedditPaginatedAdapter({ pageDelayMs: 0, jitterMs: 0 });
    const result = await adapter.collectPaginated({
      name: "test",
      includeKeywords: ["test"],
      excludeKeywords: [],
      language: "en",
      limitPerRun: 200
    });

    expect(result.stopReason).toBe("rate_limited");
    // 第一页已成功收集
    expect(result.items).toHaveLength(100);
    expect(result.errorMessage).toContain("403");
  });

  it("collect() 在 rate_limited 时抛出错误，兼容旧 CollectionAdapter 接口", async () => {
    makeMockCrawler([{ items: [], status: 429 }]);

    const adapter = createRedditPaginatedAdapter({ pageDelayMs: 0, jitterMs: 0 });
    await expect(
      adapter.collect({
        name: "test",
        includeKeywords: ["test"],
        excludeKeywords: [],
        language: "en",
        limitPerRun: 100
      })
    ).rejects.toThrow(/rate_limited/);
  });

  it("即使配置 Reddit OAuth 凭证也不走官方 API", async () => {
    makeMockCrawler([{ items: ["Browser/public fallback post"], nextCursor: undefined }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createRedditPaginatedAdapter({
      pageDelayMs: 0,
      jitterMs: 0,
      env: {
        REDDIT_CLIENT_ID: "client_id",
        REDDIT_CLIENT_SECRET: "client_secret",
        REDDIT_USER_AGENT: "domain-analysis-test"
      } as NodeJS.ProcessEnv
    });
    const result = await adapter.collectPaginated({
      name: "test",
      includeKeywords: ["test"],
      excludeKeywords: [],
      language: "en",
      limitPerRun: 1
    });

    expect(result.items).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(MockHttpCrawler).toHaveBeenCalledTimes(1);
  });

  it("数据耗尽时返回 exhausted", async () => {
    makeMockCrawler([
      { items: Array.from({ length: 20 }, (_, i) => `Post ${i}`), nextCursor: undefined }
    ]);

    const adapter = createRedditPaginatedAdapter({ pageDelayMs: 0, jitterMs: 0 });
    const result = await adapter.collectPaginated({
      name: "test",
      includeKeywords: ["test"],
      excludeKeywords: [],
      language: "en",
      limitPerRun: 200
    });

    expect(result.stopReason).toBe("exhausted");
    expect(result.items).toHaveLength(20);
  });
});
