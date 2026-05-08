import { HttpCrawler } from "crawlee";
import {
  buildKeywordQuery,
  conservativeHttpCrawlerOptions,
  hasExcludedKeyword,
  type CollectedRawContent,
  type CollectionAdapter
} from "./types";

interface RedditListingResponse {
  data?: {
    children?: Array<{
      data?: RedditPost;
    }>;
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

export function createRedditAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  return createRedditPublicJsonAdapter(env);
}

export function createRedditPublicJsonAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  return {
    async collect(query) {
      const items: CollectedRawContent[] = [];
      let crawlError: Error | null = null;
      const url = buildPublicSearchUrl(query.includeKeywords, query.excludeKeywords, query.limitPerRun);
      const crawler = new HttpCrawler({
        ...conservativeHttpCrawlerOptions,
        maxRequestsPerCrawl: 1,
        requestHandlerTimeoutSecs: 30,
        preNavigationHooks: [
          async (_context, gotOptions) => {
            gotOptions.headers = {
              ...gotOptions.headers,
              "User-Agent": getRedditUserAgent(env)
            };
          }
        ],
        requestHandler: async ({ body }) => {
          const payload = parseRedditJsonBody(body);
          items.push(...normalizeRedditListing(payload, query.excludeKeywords, query.limitPerRun));
        },
        failedRequestHandler: async ({ response, request }, error) => {
          const status = response?.statusCode;
          if (status === 403 || status === 429) {
            crawlError = new Error(`reddit_public_rate_limited_${status}`);
            return;
          }
          crawlError = new Error(
            `reddit_public_search_failed_${status ?? request.errorMessages.at(-1) ?? error.message}`
          );
        }
      });

      // WHY: Reddit 公开 JSON 不需要 secret，Crawlee 负责限速/重试；MVP 牺牲速度换取低成本和低封禁风险。
      // TRADE-OFF: 公开端点可能被 Reddit 策略调整，失败时需要清楚降级而不是切回高频浏览器抓取。
      await crawler.run([url.toString()]);
      if (crawlError) throw crawlError;
      return items.slice(0, query.limitPerRun);
    }
  };
}

function buildPublicSearchUrl(includeKeywords: string[], excludeKeywords: string[], limitPerRun: number) {
  const url = new URL("https://www.reddit.com/search.json");
  url.searchParams.set("q", buildKeywordQuery(includeKeywords, excludeKeywords));
  url.searchParams.set("limit", String(Math.min(limitPerRun, 100)));
  url.searchParams.set("sort", "new");
  url.searchParams.set("type", "link");
  return url;
}

function parseRedditJsonBody(body: unknown): RedditListingResponse {
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    return JSON.parse(body.toString()) as RedditListingResponse;
  }
  return body as RedditListingResponse;
}

function normalizeRedditListing(
  payload: RedditListingResponse,
  excludeKeywords: string[],
  limitPerRun: number
): CollectedRawContent[] {
  const rows = payload.data?.children ?? [];
  return rows
    .map((child) => child.data)
    .filter((item): item is RedditPost => Boolean(item?.id))
    .map((item) => {
      const text = [item.title, item.selftext].filter(Boolean).join("\n\n").trim();
      return { item, text };
    })
    .filter(({ text }) => text && !hasExcludedKeyword(text, excludeKeywords))
    .slice(0, limitPerRun)
    .map(({ item, text }) => ({
      platform: "reddit" as const,
      externalId: item.name ?? item.id,
      url: item.permalink ? `https://www.reddit.com${item.permalink}` : item.url ?? "https://www.reddit.com",
      authorName: item.author,
      text,
      metricsJson: {
        score: item.score ?? 0,
        comments: item.num_comments ?? 0,
        subreddit: item.subreddit
      },
      publishedAt: item.created_utc ? new Date(item.created_utc * 1000).toISOString() : undefined,
      rawJson: item as Record<string, unknown>
    }));
}

function getRedditUserAgent(env: NodeJS.ProcessEnv) {
  return env.REDDIT_USER_AGENT || "domain-analysis/0.1.0 public-json collector";
}
