import { HttpCrawler, PlaywrightCrawler, Request } from "crawlee";
import { officialApiFetchSignal } from "../envTimeouts";
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

interface RedditTokenResponse {
  access_token?: string;
}

/**
 * WHY: 无 API Key 时默认走真实浏览器上下文拉 JSON，降低机房出口被 Reddit 直接挡在 TLS/HTTP 层外的概率。
 * TRADE-OFF: 需安装浏览器二进制（`npx playwright install chromium`）；仍可用 REDDIT_COLLECTION_MODE=public_json 强制纯 HTTP。
 */
export function createRedditAdapter(
  env: NodeJS.ProcessEnv = process.env,
  sourceCrawlerType?: "cheerio" | "playwright"
): CollectionAdapter {
  if (env.REDDIT_COLLECTION_MODE === "official_api") {
    return createRedditOfficialApiAdapter(env);
  }
  if (env.REDDIT_COLLECTION_MODE === "public_json" || sourceCrawlerType === "cheerio") {
    return createRedditPublicJsonAdapter(env);
  }
  return createRedditPlaywrightInPageFetchAdapter(env);
}

/** 在已登录页面上下文中 fetch search.json，复用浏览器 TLS/指纹；比裸 got 更接近「用户打开网页」链路。 */
export function createRedditPlaywrightInPageFetchAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  return {
    async collect(query) {
      const items: CollectedRawContent[] = [];
      let crawlError: Error | null = null;
      const searchJsonUrl = buildPublicSearchUrl(query.includeKeywords, query.excludeKeywords, query.limitPerRun);

      const crawler = new PlaywrightCrawler({
        ...conservativeHttpCrawlerOptions,
        maxRequestsPerCrawl: 1,
        maxRequestRetries: 0,
        navigationTimeoutSecs: 60,
        requestHandlerTimeoutSecs: 120,
        launchContext: {
          launchOptions: {
            headless: env.REDDIT_PLAYWRIGHT_HEADLESS !== "false"
          }
        },
        requestHandler: async ({ page, request }) => {
          const targetUrl = (request.userData as { searchJsonUrl?: string }).searchJsonUrl;
          if (!targetUrl) {
            throw new Error("reddit_playwright_missing_search_url");
          }
          await page.goto("https://www.reddit.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
          const jsonText = await page.evaluate(async (u: string) => {
            const res = await fetch(u, { credentials: "include", cache: "no-store" });
            const text = await res.text();
            if (!res.ok) {
              throw new Error(`reddit_browser_fetch_${res.status}`);
            }
            return text;
          }, targetUrl);
          const payload = JSON.parse(jsonText) as RedditListingResponse;
          items.push(...normalizeRedditListing(payload, query.excludeKeywords, query.limitPerRun));
        },
        failedRequestHandler: async (_ctx, error) => {
          crawlError = error instanceof Error ? error : new Error(String(error));
        }
      });

      await crawler.run([
        new Request({
          url: "https://www.reddit.com/",
          uniqueKey: `reddit-pw-${searchJsonUrl}`,
          userData: { searchJsonUrl: searchJsonUrl.toString() }
        })
      ]);
      if (crawlError) throw crawlError;
      return items.slice(0, query.limitPerRun);
    }
  };
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
        // WHY: 官方文档约定 HTTP 须在 navigationTimeoutSecs 内完成；未设置时 Reddit 端易出现长时间无响应，任务永远 running。
        // 参考: https://crawlee.dev/js/api/http-crawler/interface/HttpCrawlerOptions#navigationTimeoutSecs
        navigationTimeoutSecs: 55,
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

export function createRedditOfficialApiAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  return {
    async collect(query) {
      const token = await getAccessToken(env);
      const searchQuery = buildKeywordQuery(query.includeKeywords, query.excludeKeywords);
      const url = new URL("https://oauth.reddit.com/search");
      url.searchParams.set("q", searchQuery);
      url.searchParams.set("limit", String(Math.min(query.limitPerRun, 100)));
      url.searchParams.set("sort", "new");
      url.searchParams.set("type", "link");

      const signal = officialApiFetchSignal(env);
      const response = await fetch(url, {
        ...(signal ? { signal } : {}),
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": getRequiredEnv(env, "REDDIT_USER_AGENT")
        }
      });

      if (!response.ok) {
        throw new Error(`reddit_search_failed_${response.status}`);
      }

      const payload = (await response.json()) as RedditListingResponse;
      return normalizeRedditListing(payload, query.excludeKeywords, query.limitPerRun);
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

async function getAccessToken(env: NodeJS.ProcessEnv) {
  const clientId = getRequiredEnv(env, "REDDIT_CLIENT_ID");
  const clientSecret = getRequiredEnv(env, "REDDIT_CLIENT_SECRET");
  const signal = officialApiFetchSignal(env);
  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": getRequiredEnv(env, "REDDIT_USER_AGENT")
    },
    body: new URLSearchParams({ grant_type: "client_credentials" })
  });

  if (!response.ok) {
    throw new Error(`reddit_oauth_failed_${response.status}`);
  }

  const payload = (await response.json()) as RedditTokenResponse;
  if (!payload.access_token) {
    throw new Error("reddit_oauth_missing_access_token");
  }
  return payload.access_token;
}

function getRedditUserAgent(env: NodeJS.ProcessEnv) {
  return env.REDDIT_USER_AGENT || "domain-analysis/0.1.0 public-json collector";
}

function getRequiredEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key];
  if (!value) {
    throw new Error(`missing_${key}`);
  }
  return value;
}
