import { CheerioCrawler } from "crawlee";
import {
  conservativeHttpCrawlerOptions,
  hasExcludedKeyword,
  type CollectedRawContent,
  type CollectionAdapter
} from "./types";

interface XRecentSearchResponse {
  data?: Array<{
    id: string;
    text: string;
    author_id?: string;
    created_at?: string;
    public_metrics?: Record<string, number>;
  }>;
  includes?: {
    users?: Array<{
      id: string;
      name?: string;
      username?: string;
    }>;
  };
}

export function createXAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  if (env.X_COLLECTION_MODE === "official_api") {
    return createXOfficialApiAdapter(env);
  }
  return createXNitterRssAdapter(env);
}

export function createXNitterRssAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  return {
    async collect(query) {
      const items: CollectedRawContent[] = [];
      let crawlError: Error | null = null;
      const url = buildNitterSearchRssUrl(env, query.includeKeywords, query.excludeKeywords);
      const crawler = new CheerioCrawler({
        ...conservativeHttpCrawlerOptions,
        maxRequestsPerCrawl: 1,
        requestHandlerTimeoutSecs: 45,
        requestHandler: async ({ $, request }) => {
          $("item").each((_index, element) => {
            const title = cleanRssText($(element).find("title").first().text());
            const description = cleanRssText($(element).find("description").first().text());
            const link = $(element).find("link").first().text().trim();
            const guid = $(element).find("guid").first().text().trim() || link;
            const publishedAt = parseRssDate($(element).find("pubDate").first().text());
            const text = [title, description].filter(Boolean).join("\n\n").trim();

            if (!text || hasExcludedKeyword(text, query.excludeKeywords)) return;
            items.push({
              platform: "x",
              externalId: guid || undefined,
              url: link || (request.loadedUrl ?? request.url),
              text,
              publishedAt,
              metricsJson: { source: "nitter_rss" },
              rawJson: {
                title,
                description,
                link,
                guid,
                pubDate: $(element).find("pubDate").first().text()
              }
            });
          });
        },
        failedRequestHandler: async ({ response, request }, error) => {
          const status = response?.statusCode;
          if (status === 403 || status === 429) {
            crawlError = new Error(`x_nitter_rate_limited_${status}`);
            return;
          }
          crawlError = new Error(`x_nitter_rss_failed_${status ?? request.errorMessages.at(-1) ?? error.message}`);
        }
      });

      // WHY: X 官方 API 有成本和权限门槛，MVP 默认走 Nitter RSS 这类开源公开前端，且强制单并发低频。
      // TRADE-OFF: Nitter 实例稳定性不可控，失败时明确暴露任务状态，后续再接 Playwright 兜底。
      await crawler.run([url.toString()]);
      if (crawlError) throw crawlError;
      return items.slice(0, query.limitPerRun);
    }
  };
}

export function createXOfficialApiAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  return {
    async collect(query) {
      const url = new URL("https://api.x.com/2/tweets/search/recent");
      url.searchParams.set("query", buildXQuery(query.includeKeywords, query.excludeKeywords, query.language));
      url.searchParams.set("max_results", String(Math.min(Math.max(query.limitPerRun, 10), 100)));
      url.searchParams.set("tweet.fields", "created_at,public_metrics,author_id");
      url.searchParams.set("expansions", "author_id");
      url.searchParams.set("user.fields", "name,username");

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${getRequiredEnv(env, "X_BEARER_TOKEN")}`
        }
      });

      if (!response.ok) {
        throw new Error(`x_recent_search_failed_${response.status}`);
      }

      const payload = (await response.json()) as XRecentSearchResponse;
      const users = new Map((payload.includes?.users ?? []).map((user) => [user.id, user]));

      return (payload.data ?? [])
        .filter((tweet) => !hasExcludedKeyword(tweet.text, query.excludeKeywords))
        .slice(0, query.limitPerRun)
        .map((tweet) => {
          const user = tweet.author_id ? users.get(tweet.author_id) : undefined;
          return {
            platform: "x" as const,
            externalId: tweet.id,
            url: user?.username
              ? `https://x.com/${user.username}/status/${tweet.id}`
              : `https://api.x.com/2/tweets/${tweet.id}`,
            authorName: user?.name,
            authorHandle: user?.username,
            text: tweet.text,
            metricsJson: tweet.public_metrics,
            publishedAt: tweet.created_at,
            rawJson: tweet as Record<string, unknown>
          };
        });
    }
  };
}

function buildNitterSearchRssUrl(env: NodeJS.ProcessEnv, includeKeywords: string[], excludeKeywords: string[]) {
  const baseUrl = env.X_NITTER_BASE_URL || "https://nitter.net";
  const url = new URL("/search/rss", baseUrl);
  const include = includeKeywords.map((keyword) => `"${keyword}"`).join(" OR ");
  const exclude = excludeKeywords.map((keyword) => `-"${keyword}"`).join(" ");
  url.searchParams.set("q", [include, exclude].filter(Boolean).join(" "));
  return url;
}

function cleanRssText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseRssDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function buildXQuery(includeKeywords: string[], excludeKeywords: string[], language: string) {
  const include = includeKeywords.map((keyword) => `"${keyword}"`).join(" OR ");
  const exclude = excludeKeywords.map((keyword) => `-"${keyword}"`).join(" ");
  const lang = language ? `lang:${language.slice(0, 2).toLowerCase()}` : "";
  const query = [include, exclude, lang, "-is:retweet"].filter(Boolean).join(" ");

  // WHY: X recent search query length有限，MVP 先硬性截断保护任务不因配置过长整体失败。
  // TRADE-OFF: 极长关键词组会被截断；后续应在 Query Builder 中做长度校验和分批执行。
  return query.slice(0, 512);
}

function getRequiredEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key];
  if (!value) {
    throw new Error(`missing_${key}`);
  }
  return value;
}
