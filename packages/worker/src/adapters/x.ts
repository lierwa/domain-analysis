import { CheerioCrawler } from "crawlee";
import {
  conservativeHttpCrawlerOptions,
  hasExcludedKeyword,
  type CollectedRawContent,
  type CollectionAdapter
} from "./types";

export function createXAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  void env;
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

      // WHY: 这里保留免费公开前端兜底，不再接官方付费 API；主采集链路使用 Playwright 浏览器 adapter。
      // TRADE-OFF: Nitter 实例稳定性不可控，失败时明确暴露任务状态。
      await crawler.run([url.toString()]);
      if (crawlError) throw crawlError;
      return items.slice(0, query.limitPerRun);
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
