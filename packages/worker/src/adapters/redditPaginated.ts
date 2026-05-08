// WHY: 分页 adapter 通过 Reddit public JSON 的 after cursor 串行抓取多页，
// 实现 targetCount > 100 的慢速批量采集，避免单批截断误导用户。
// TRADE-OFF: 串行逐页、页间强制 delay，速度慢但极大降低被 rate-limit 概率；适合后台调度，不适合实时查询。
import type { CollectedRawContent, CollectionAdapter, CollectionQuery } from "./types";
import {
  buildKeywordQuery,
  conservativeHttpCrawlerOptions,
  hasExcludedKeyword
} from "./types";
import { HttpCrawler } from "crawlee";

const PAGE_SIZE = 100; // Reddit public JSON 单页最大条数

export interface PaginatedCollectionResult {
  items: CollectedRawContent[];
  pagesCollected: number;
  stopReason: "target_reached" | "exhausted" | "rate_limited" | "error";
  lastCursor?: string;
  errorMessage?: string;
}

export interface RedditPaginatedAdapterOptions {
  // 每页之间的最小等待时间（ms），默认 10s
  pageDelayMs?: number;
  // 每页之间最大随机额外等待（ms），默认 20s；实际 delay = pageDelayMs + random(0, jitterMs)
  jitterMs?: number;
  env?: NodeJS.ProcessEnv;
  onPage?: (progress: {
    items: CollectedRawContent[];
    pagesCollected: number;
    nextCursor?: string;
    nextRequestAt?: string;
  }) => Promise<void>;
}

// WHY: 导出分页结果接口，供 service 层记录 cursor/stop reason，便于后续断点续采。
export function createRedditPaginatedAdapter(
  opts: RedditPaginatedAdapterOptions = {}
): CollectionAdapter & { collectPaginated(query: CollectionQuery): Promise<PaginatedCollectionResult> } {
  const {
    pageDelayMs = 10_000,
    jitterMs = 20_000,
    env = process.env
  } = opts;

  async function collectPaginated(query: CollectionQuery): Promise<PaginatedCollectionResult> {
    const allItems: CollectedRawContent[] = [];
    let afterCursor: string | undefined;
    let pagesCollected = 0;
    const maxPages = Math.ceil(query.limitPerRun / PAGE_SIZE);

    for (let page = 0; page < maxPages; page++) {
      if (page > 0) {
        // WHY: 页间强制 delay + 随机抖动，模拟人工浏览间隔，降低被 rate-limit 概率。
        const delay = pageDelayMs + Math.random() * jitterMs;
        await sleep(delay);
      }

      const pageResult = await fetchOnePage({
        includeKeywords: query.includeKeywords,
        excludeKeywords: query.excludeKeywords,
        after: afterCursor,
        env
      });

      if (pageResult.rateLimited) {
        return {
          items: allItems,
          pagesCollected,
          stopReason: "rate_limited",
          lastCursor: afterCursor,
          errorMessage: pageResult.errorMessage
        };
      }

      if (pageResult.error) {
        return {
          items: allItems,
          pagesCollected,
          stopReason: "error",
          lastCursor: afterCursor,
          errorMessage: pageResult.errorMessage
        };
      }

      pagesCollected++;
      allItems.push(...pageResult.items);
      afterCursor = pageResult.nextCursor;
      await opts.onPage?.({
        items: pageResult.items,
        pagesCollected,
        nextCursor: afterCursor,
        nextRequestAt: afterCursor ? new Date(Date.now() + pageDelayMs + jitterMs).toISOString() : undefined
      });

      if (allItems.length >= query.limitPerRun) {
        return {
          items: allItems.slice(0, query.limitPerRun),
          pagesCollected,
          stopReason: "target_reached",
          lastCursor: afterCursor
        };
      }

      // WHY: Reddit 返回空 nextCursor 表示已无更多数据，提前终止避免空请求。
      if (!afterCursor) {
        return {
          items: allItems,
          pagesCollected,
          stopReason: "exhausted"
        };
      }
    }

    return {
      items: allItems.slice(0, query.limitPerRun),
      pagesCollected,
      stopReason: "target_reached",
      lastCursor: afterCursor
    };
  }

  return {
    // WHY: 兼容现有 CollectionAdapter 接口，让现有 service 代码无需修改即可使用分页 adapter。
    async collect(query: CollectionQuery): Promise<CollectedRawContent[]> {
      const result = await collectPaginated(query);
      // rate_limited / error 时抛出，与现有 service 的 catch 错误处理对齐
      if (result.stopReason === "rate_limited") {
        throw new Error(result.errorMessage ?? "reddit_public_rate_limited");
      }
      if (result.stopReason === "error") {
        throw new Error(result.errorMessage ?? "unknown_crawl_error");
      }
      return result.items;
    },
    collectPaginated
  };
}

// ─── 单页抓取（私有）────────────────────────────────────────────────────────────

interface PageFetchOptions {
  includeKeywords: string[];
  excludeKeywords: string[];
  after?: string;
  env: NodeJS.ProcessEnv;
}

interface PageFetchResult {
  items: CollectedRawContent[];
  nextCursor?: string;
  rateLimited?: boolean;
  error?: boolean;
  errorMessage?: string;
}

async function fetchOnePage(opts: PageFetchOptions): Promise<PageFetchResult> {
  const { includeKeywords, excludeKeywords, after, env } = opts;
  const url = buildPageUrl(includeKeywords, excludeKeywords, after);

  const items: CollectedRawContent[] = [];
  let nextCursor: string | undefined;
  let rateLimited = false;
  let fetchError: string | undefined;

  const crawler = new HttpCrawler({
    ...conservativeHttpCrawlerOptions,
    maxRequestsPerCrawl: 1,
    requestHandlerTimeoutSecs: 30,
    preNavigationHooks: [
      async (_ctx, gotOptions) => {
        gotOptions.headers = {
          ...gotOptions.headers,
          "User-Agent": env.REDDIT_USER_AGENT || "domain-analysis/0.1.0 public-json collector"
        };
      }
    ],
    requestHandler: async ({ body }) => {
      const payload = parseBody(body);
      const listing = payload.data;
      nextCursor = listing?.after ?? undefined;
      const rows = listing?.children ?? [];
      for (const child of rows) {
        const post = child.data;
        if (!post?.id) continue;
        const text = [post.title, post.selftext].filter(Boolean).join("\n\n").trim();
        if (!text || hasExcludedKeyword(text, excludeKeywords)) continue;
        items.push({
          platform: "reddit",
          externalId: post.name ?? post.id,
          url: post.permalink ? `https://www.reddit.com${post.permalink}` : post.url ?? "https://www.reddit.com",
          authorName: post.author,
          text,
          metricsJson: { score: post.score ?? 0, comments: post.num_comments ?? 0, subreddit: post.subreddit },
          publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined,
          rawJson: post as Record<string, unknown>
        });
      }
    },
    failedRequestHandler: async ({ response, request }, error) => {
      const status = response?.statusCode;
      if (status === 403 || status === 429) {
        rateLimited = true;
        fetchError = `reddit_public_rate_limited_${status}`;
        return;
      }
      fetchError = `reddit_public_search_failed_${status ?? request.errorMessages.at(-1) ?? error.message}`;
    }
  });

  await crawler.run([url.toString()]);

  if (rateLimited) return { items: [], rateLimited: true, errorMessage: fetchError };
  if (fetchError) return { items: [], error: true, errorMessage: fetchError };
  return { items, nextCursor };
}

function buildPageUrl(includeKeywords: string[], excludeKeywords: string[], after?: string) {
  const url = new URL("https://www.reddit.com/search.json");
  url.searchParams.set("q", buildKeywordQuery(includeKeywords, excludeKeywords));
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("sort", "new");
  url.searchParams.set("type", "link");
  if (after) url.searchParams.set("after", after);
  return url;
}

function parseBody(body: unknown): RedditListingResponse {
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    return JSON.parse(body.toString()) as RedditListingResponse;
  }
  return body as RedditListingResponse;
}

function normalizePosts(payload: RedditListingResponse, excludeKeywords: string[]): CollectedRawContent[] {
  const rows = payload.data?.children ?? [];
  return rows
    .map((child) => child.data)
    .filter((post): post is RedditPost => Boolean(post?.id))
    .map((post) => {
      const text = [post.title, post.selftext].filter(Boolean).join("\n\n").trim();
      return { post, text };
    })
    .filter(({ text }) => text && !hasExcludedKeyword(text, excludeKeywords))
    .map(({ post, text }) => ({
      platform: "reddit" as const,
      externalId: post.name ?? post.id,
      url: post.permalink ? `https://www.reddit.com${post.permalink}` : post.url ?? "https://www.reddit.com",
      authorName: post.author,
      text,
      metricsJson: { score: post.score ?? 0, comments: post.num_comments ?? 0, subreddit: post.subreddit },
      publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined,
      rawJson: post as Record<string, unknown>
    }));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ─── Reddit API 响应类型（私有）─────────────────────────────────────────────────

interface RedditListingResponse {
  data?: {
    after?: string | null;
    children?: Array<{ data?: RedditPost }>;
  };
}

interface RedditPost {
  id?: string;
  name?: string;
  title?: string;
  selftext?: string;
  permalink?: string;
  url?: string;
  author?: string;
  subreddit?: string;
  score?: number;
  num_comments?: number;
  created_utc?: number;
}
