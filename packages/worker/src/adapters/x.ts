import { CheerioCrawler } from "crawlee";
import type { BrowserContext } from "playwright";
import { createExternalCollectorError, runExternalCollectorCommand } from "../collectors/externalCollector";
import {
  acquireXCollectionContext,
  hasXAuthCookie,
  openXLoginBrowser,
  XChromeDevToolsUnavailableError
} from "../runtime/xLoginRuntime";
import {
  buildKeywordQuery,
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
  if (env.X_COLLECTION_MODE === "nitter_rss") {
    return createXNitterRssAdapter(env);
  }
  if ((env.X_COLLECTION_MODE === "twscrape" || env.X_COLLECTION_MODE === "twikit") && env.X_COLLECTOR_COMMAND) {
    return createXExternalAdapter(env);
  }
  return createXBrowserProfileAdapter(env);
}

export function createXBrowserProfileAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  return {
    async collect(query) {
      let lease;
      try {
        lease = await acquireXCollectionContext(env);
      } catch (error) {
        if (error instanceof XChromeDevToolsUnavailableError) {
          throw createExternalCollectorError("login_required", error.message);
        }
        throw error;
      }
      try {
        if (!(await hasXAuthCookie(lease.context))) {
          await openXLoginBrowser(env);
          throw createExternalCollectorError(
            "login_required",
            "X login is required. Complete login in the opened browser, then continue this run."
          );
        }

        // WHY: browser_profile 使用用户手动登录的同一份本机 profile，避免默认访问第三方镜像站。
        // TRADE-OFF: X 前端 DOM 可能变化，第一版作为个人低频 best-effort；稳定重采集仍建议接 twscrape/twikit。
        const page = await lease.context.newPage();
        await page.goto(buildXSearchUrl(query.includeKeywords, query.excludeKeywords).toString(), {
          waitUntil: "domcontentloaded",
          timeout: 30000
        });
        await page.waitForTimeout(2500);
        return (await extractTweetsFromSearch(lease.context, query.excludeKeywords)).slice(0, query.limitPerRun);
      } finally {
        await lease.release();
      }
    }
  };
}

export function createXExternalAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  return {
    async collect(query) {
      const command = env.X_COLLECTOR_COMMAND;
      if (!command) {
        throw createExternalCollectorError(
          "login_required",
          "X collector is not configured. Set X_COLLECTION_MODE=twscrape or twikit with X_COLLECTOR_COMMAND after preparing the login session."
        );
      }

      // WHY: X 按计划依赖 twscrape/twikit 这类成熟登录态采集器；Node 只做薄封装和错误归一。
      // TRADE-OFF: 未配置时宁可明确失败，也不默认访问第三方 Nitter 实例，避免主流程打开不可控网站。
      const result = await runExternalCollectorCommand({
        command,
        args: splitCommandArgs(env.X_COLLECTOR_ARGS),
        input: {
          platform: "x",
          query,
          config: {
            mode: env.X_COLLECTION_MODE ?? "twscrape",
            sessionPath: env.X_SESSION_PATH
          }
        },
        timeoutMs: Number(env.X_COLLECTOR_TIMEOUT_MS ?? 120000)
      });
      return result.items.slice(0, query.limitPerRun);
    }
  };
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

export function buildNitterSearchRssUrl(env: NodeJS.ProcessEnv, includeKeywords: string[], excludeKeywords: string[]) {
  const baseUrl = env.X_NITTER_BASE_URL || "https://nitter.net";
  const url = new URL("/search/rss", baseUrl);
  const include = includeKeywords.map((keyword) => `"${keyword}"`).join(" OR ");
  const exclude = excludeKeywords.map((keyword) => `-"${keyword}"`).join(" ");
  url.searchParams.set("q", [include, exclude].filter(Boolean).join(" "));
  return url;
}

function splitCommandArgs(value: string | undefined) {
  if (!value) return [];
  return value.split(" ").map((item) => item.trim()).filter(Boolean);
}

export function buildXSearchUrl(includeKeywords: string[], excludeKeywords: string[]) {
  const url = new URL("https://x.com/search");
  url.searchParams.set("q", buildKeywordQuery(includeKeywords, excludeKeywords));
  url.searchParams.set("src", "typed_query");
  url.searchParams.set("f", "live");
  return url;
}

async function extractTweetsFromSearch(context: BrowserContext, excludeKeywords: string[]) {
  const page = context.pages().at(-1);
  if (!page) return [];
  const rows = await page.locator("article").evaluateAll((articles) =>
    articles.map((article) => {
      const text = (article.textContent ?? "").replace(/\s+/g, " ").trim();
      const link = article.querySelector('a[href*="/status/"]')?.getAttribute("href") ?? "";
      const time = article.querySelector("time")?.getAttribute("datetime") ?? "";
      const authorHandle = article.querySelector('a[href^="/"]')?.getAttribute("href")?.replace("/", "") ?? "";
      return { text, link, time, authorHandle };
    })
  );

  const seen = new Set<string>();
  return rows
    .filter((row) => row.text && row.link && !hasExcludedKeyword(row.text, excludeKeywords))
    .filter((row) => {
      if (seen.has(row.link)) return false;
      seen.add(row.link);
      return true;
    })
    .map((row) => ({
      platform: "x" as const,
      externalId: row.link.split("/status/").at(1)?.split("?")[0],
      url: new URL(row.link, "https://x.com").toString(),
      authorHandle: row.authorHandle,
      text: row.text,
      publishedAt: row.time || undefined,
      metricsJson: { source: "x_browser_profile" },
      rawJson: row
    }));
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
