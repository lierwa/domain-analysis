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

export function createRedditBrowserAdapter(
  runtime = new BrowserCrawlerRuntime(),
  contextOverrides: Partial<BrowserCollectionContext> = {}
): CollectionAdapter & {
  collectPaginated(query: CollectionQuery): Promise<PaginatedCollectionResult>;
} {
  async function collectPaginated(query: CollectionQuery): Promise<PaginatedCollectionResult> {
    const items: CollectedRawContent[] = [];
    const url = buildRedditSearchUrl(query);
    const context = resolveBrowserContext(query, contextOverrides);
    const crawler = runtime.createCrawler(
      context,
      async ({ page }) => {
        await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
        await prepareBrowserPage(page, context);
        await scrollPage(page, context.maxScrolls);
        items.push(...extractRedditItemsFromHtml(await page.content(), query.includeKeywords, query.excludeKeywords));
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

export function extractRedditItemsFromHtml(
  html: string,
  includeKeywords: string[],
  excludeKeywords: string[]
): CollectedRawContent[] {
  const $ = createHtmlParser(html);
  const rows = $("article, shreddit-post, [data-testid='post-container']").toArray();
  return rows
    .map((row) => {
      const titleNode = $(row).find("[data-testid='post-title'], a[slot='title'], a[href*='/comments/']").first();
      const title = titleNode.text().replace(/\s+/g, " ").trim() || $(row).attr("post-title") || "";
      const href = titleNode.attr("href") || $(row).attr("permalink");
      const text = [title, textOf($, row, "[data-testid='post-content'], [slot='text-body']")].filter(Boolean).join("\n\n");
      const authorHref = $(row).find("a[href*='/user/']").first().attr("href") ?? "";
      const subredditHref = $(row)
        .find("a[href^='/r/']:not([href*='/comments/']), a[href*='reddit.com/r/']:not([href*='/comments/'])")
        .first()
        .attr("href") ?? "";
      return {
        platform: "reddit" as const,
        externalId: href?.match(/comments\/([^/]+)/)?.[1],
        url: absoluteUrl(href, "https://www.reddit.com"),
        authorHandle: authorHref.match(/\/user\/([^/]+)/)?.[1],
        text,
        metricsJson: {
          score: numberFromText($(row).find("shreddit-score-number, [data-testid='vote-arrows']").first().text()),
          comments: numberFromText($(row).text().match(/(\d[\d,.KkMm]*)\s+comments?/)?.[1] ?? ""),
          subreddit: subredditHref.match(/\/r\/([^/]+)/)?.[1]
        },
        publishedAt: $(row).find("time").first().attr("datetime")
      };
    })
    .filter((item) => item.text && item.url !== "https://www.reddit.com")
    .filter((item) => hasAnyKeyword(item.text, includeKeywords) && !hasExcludedKeyword(item.text, excludeKeywords));
}

function buildRedditSearchUrl(query: CollectionQuery) {
  const url = new URL("https://www.reddit.com/search/");
  url.searchParams.set("q", query.includeKeywords.join(" OR "));
  url.searchParams.set("sort", "new");
  url.searchParams.set("type", "link");
  return url;
}

async function scrollPage(page: { evaluate(fn: () => void): Promise<unknown>; waitForTimeout(ms: number): Promise<void> }, maxScrolls: number) {
  for (let index = 0; index < maxScrolls; index += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
  }
}
