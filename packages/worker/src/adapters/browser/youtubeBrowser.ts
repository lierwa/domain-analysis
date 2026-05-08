import type {
  BrowserCollectionContext,
  CollectedRawContent,
  CollectionAdapter,
  CollectionQuery,
  PaginatedCollectionResult
} from "../types";
import { BrowserCrawlerRuntime } from "../../runtime/browserCrawlerRuntime";
import {
  absoluteUrl,
  createHtmlParser,
  hasAnyKeyword,
  hasExcludedKeyword,
  numberFromText,
  prepareBrowserPage,
  textOf,
  uniqueByUrl
} from "./common";

export function createYouTubeBrowserAdapter(
  runtime = new BrowserCrawlerRuntime(),
  contextOverrides: Partial<BrowserCollectionContext> = {}
): CollectionAdapter & {
  collectPaginated(query: CollectionQuery): Promise<PaginatedCollectionResult>;
} {
  async function collectPaginated(query: CollectionQuery): Promise<PaginatedCollectionResult> {
    const items: CollectedRawContent[] = [];
    const url = buildYouTubeSearchUrl(query);
    const context = resolveBrowserContext(query, contextOverrides);
    const crawler = runtime.createCrawler(
      context,
      async ({ page }) => {
        await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
        await prepareBrowserPage(page, context);
        await scrollPage(page, context.maxScrolls);
        items.push(...extractYouTubeItemsFromHtml(await page.content(), query.includeKeywords, query.excludeKeywords));
      }
    );
    await crawler.run([url.toString()]);
    const unique = uniqueByUrl(items).slice(0, query.limitPerRun);
    return {
      items: unique,
      pagesCollected: 1,
      stopReason: unique.length >= query.limitPerRun ? "target_reached" : "exhausted"
    };
  }

  return {
    async collect(query) {
      return (await collectPaginated(query)).items;
    },
    collectPaginated
  };
}

function resolveBrowserContext(
  query: CollectionQuery,
  overrides: Partial<BrowserCollectionContext>
): BrowserCollectionContext {
  return {
    browserMode:
      overrides.browserMode ??
      ((process.env.BROWSER_MODE as "headless" | "headful" | "local_profile" | undefined) ?? "local_profile"),
    browserProfilePath: overrides.browserProfilePath ?? process.env.BROWSER_PROFILE_PATH,
    maxScrolls: overrides.maxScrolls ?? Number(process.env.BROWSER_MAX_SCROLLS ?? 5),
    maxItems: overrides.maxItems ?? query.limitPerRun
  };
}

export function extractYouTubeItemsFromHtml(
  html: string,
  includeKeywords: string[],
  excludeKeywords: string[]
): CollectedRawContent[] {
  const $ = createHtmlParser(html);
  return $("ytd-video-renderer, ytd-rich-item-renderer").toArray()
    .map((row) => {
      const titleNode = $(row).find("a#video-title, a[href*='watch?v=']").first();
      const href = titleNode.attr("href");
      const title = titleNode.attr("title") || titleNode.text().replace(/\s+/g, " ").trim();
      const description = textOf($, row, "#description-text, yt-formatted-string.metadata-snippet-text");
      const channel = textOf($, row, "ytd-channel-name, a[href^='/@']");
      const meta = $(row).find(".inline-metadata-item").toArray().map((node) => $(node).text().trim());
      const url = absoluteUrl(href, "https://www.youtube.com");
      const videoId = new URL(url).searchParams.get("v") ?? undefined;
      return {
        platform: "youtube" as const,
        externalId: videoId,
        url,
        authorName: channel,
        text: [title, description].filter(Boolean).join("\n\n"),
        metricsJson: {
          views: numberFromText(meta.find((item) => item.toLowerCase().includes("view")) ?? ""),
          publishedLabel: meta.find((item) => !item.toLowerCase().includes("view"))
        }
      };
    })
    .filter((item) => item.text && item.externalId)
    .filter((item) => hasAnyKeyword(item.text, includeKeywords) && !hasExcludedKeyword(item.text, excludeKeywords));
}

function buildYouTubeSearchUrl(query: CollectionQuery) {
  const url = new URL("https://www.youtube.com/results");
  url.searchParams.set("search_query", query.includeKeywords.join(" "));
  return url;
}

async function scrollPage(page: { evaluate(fn: () => void): Promise<unknown>; waitForTimeout(ms: number): Promise<void> }, maxScrolls: number) {
  for (let index = 0; index < maxScrolls; index += 1) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1200);
  }
}
