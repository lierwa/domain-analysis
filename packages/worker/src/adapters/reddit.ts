import got from "got";
import { HttpsProxyAgent } from "https-proxy-agent";
import { createRedditBrowserAdapter } from "./redditBrowser";
import {
  buildKeywordQuery,
  conservativeHttpCrawlerOptions,
  hasExcludedKeyword,
  type CollectedRawContent,
  type CollectionAdapter
} from "./types";
export { normalizeRedditBrowserRows } from "./redditBrowser";

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

export function createRedditAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  if (env.REDDIT_COLLECTION_MODE === "official_api") {
    return createRedditOfficialApiAdapter(env);
  }
  if (env.REDDIT_COLLECTION_MODE === "public_json" || env.REDDIT_COLLECTION_MODE === "public_json_fallback") {
    return createRedditPublicJsonAdapter(env);
  }
  return createRedditBrowserAdapter(env);
}

export function createRedditPublicJsonAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  return {
    async collect(query) {
      const url = buildPublicSearchUrl(query.includeKeywords, query.excludeKeywords, query.limitPerRun);
      const response = await got(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": getRedditUserAgent(env)
        },
        agent: createRedditProxyAgent(env),
        retry: { limit: conservativeHttpCrawlerOptions.maxRequestRetries },
        throwHttpErrors: false,
        timeout: { request: 30000 }
      });

      if (response.statusCode === 403 || response.statusCode === 429) {
        throw new Error(`reddit_public_rate_limited_${response.statusCode}`);
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`reddit_public_search_failed_${response.statusCode}`);
      }

      // WHY: Reddit search.json 是单个 JSON 端点；当前网络下 Crawlee+got-scraping 会被 Reddit 403，
      // 而 got+https-proxy-agent 与 curl 代理路径一致且更薄，避免把简单 JSON 请求升级成浏览器采集。
      // TRADE-OFF: 这里放弃 Crawlee 的队列能力；本 adapter 只发 1 个低频请求，重试和超时由 got 负责。
      return normalizeRedditListing(parseRedditJsonBody(response.body), query.excludeKeywords, query.limitPerRun);
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

      const response = await fetch(url, {
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

function createRedditProxyAgent(env: NodeJS.ProcessEnv) {
  const proxyUrl = getRedditProxyUrl(env);
  if (!proxyUrl) return undefined;

  // WHY: Node 不会自动使用 macOS 或 shell 的 http_proxy；Reddit 直连在当前网络会 reset/超时。
  // TRADE-OFF: 只把代理显式接入 Reddit JSON 请求，不改变其它平台采集路径。
  return { https: new HttpsProxyAgent(proxyUrl) };
}

function getRedditProxyUrl(env: NodeJS.ProcessEnv) {
  return env.REDDIT_PROXY_URL
    || env.HTTPS_PROXY
    || env.https_proxy
    || env.HTTP_PROXY
    || env.http_proxy;
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
  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
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
