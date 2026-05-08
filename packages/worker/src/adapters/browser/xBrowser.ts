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

export function createXBrowserAdapter(
  runtime = new BrowserCrawlerRuntime(),
  contextOverrides: Partial<BrowserCollectionContext> = {}
): CollectionAdapter & {
  collectPaginated(query: CollectionQuery): Promise<PaginatedCollectionResult>;
} {
  async function collectPaginated(query: CollectionQuery): Promise<PaginatedCollectionResult> {
    const items: CollectedRawContent[] = [];
    let loginRequired = false;
    const url = buildXSearchUrl(query);
    const context = resolveBrowserContext(query, contextOverrides);
    const crawler = runtime.createCrawler(
      context,
      async ({ page }) => {
        await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
        await prepareBrowserPage(page, context);
        let html = await page.content();
        loginRequired = isXLoginRequiredHtml(html);
        if (loginRequired && context.browserMode === "local_profile") {
          const loggedIn = await waitForXManualLogin(
            page,
            url.toString(),
            Number(process.env.X_MANUAL_LOGIN_TIMEOUT_MS ?? 600_000)
          );
          loginRequired = !loggedIn;
          html = await page.content();
        }
        if (!loginRequired) {
          await scrollPage(page, context.maxScrolls);
          html = await page.content();
        }
        if (!loginRequired) {
          items.push(...extractXItemsFromHtml(html, query.includeKeywords, query.excludeKeywords));
        }
      }
    );
    await crawler.run([url.toString()]);
    if (loginRequired) {
      return { items: [], pagesCollected: 1, stopReason: "login_required", errorMessage: "x_login_required" };
    }
    const unique = uniqueByUrl(items).slice(0, query.limitPerRun);
    return {
      items: unique,
      pagesCollected: 1,
      stopReason: unique.length >= query.limitPerRun ? "target_reached" : "exhausted"
    };
  }

  return {
    async collect(query) {
      const result = await collectPaginated(query);
      if (result.stopReason === "login_required") throw new Error(result.errorMessage);
      return result.items;
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

export function isXLoginRequiredHtml(html: string) {
  const lower = html.toLowerCase();
  return lower.includes("sign in to x") || lower.includes("log in to x") || lower.includes("登录 x");
}

export interface XManualLoginPage {
  content(): Promise<string>;
  waitForTimeout(ms: number): Promise<void>;
  goto(url: string, options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle" }): Promise<unknown>;
  url?: () => string;
}

export async function waitForXManualLogin(
  page: XManualLoginPage,
  searchUrl: string,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const html = await page.content();
    const currentUrl = page.url?.() ?? "";
    if (isXAuthenticatedPage(currentUrl, html)) {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
      return true;
    }
    await page.waitForTimeout(2_000);
  }
  return false;
}

function isXAuthenticatedPage(currentUrl: string, html: string) {
  const hostname = safeHostname(currentUrl);
  if (hostname !== "x.com" && hostname !== "twitter.com") return false;
  if (currentUrl.includes("/i/flow/login") || currentUrl.includes("/login")) return false;
  if (isXLoginRequiredHtml(html)) return false;
  return true;
}

function safeHostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function extractXItemsFromHtml(
  html: string,
  includeKeywords: string[],
  excludeKeywords: string[]
): CollectedRawContent[] {
  const $ = createHtmlParser(html);
  return $("article[data-testid='tweet']").toArray()
    .map((row) => {
      const text = textOf($, row, "[data-testid='tweetText']");
      const statusHref = $(row).find("a[href*='/status/']").first().attr("href");
      const url = absoluteUrl(statusHref, "https://x.com");
      const handle = $(row).text().match(/@([A-Za-z0-9_]+)/)?.[1];
      return {
        platform: "x" as const,
        externalId: statusHref?.match(/status\/(\d+)/)?.[1],
        url,
        authorHandle: handle,
        authorName: textOf($, row, "[data-testid='User-Name'] span"),
        text,
        metricsJson: {
          replies: numberFromText(textOf($, row, "[data-testid='reply']")),
          reposts: numberFromText(textOf($, row, "[data-testid='retweet']")),
          likes: numberFromText(textOf($, row, "[data-testid='like']"))
        },
        publishedAt: $(row).find("time").first().attr("datetime")
      };
    })
    .filter((item) => item.text && item.externalId)
    .filter((item) => hasAnyKeyword(item.text, includeKeywords) && !hasExcludedKeyword(item.text, excludeKeywords));
}

function buildXSearchUrl(query: CollectionQuery) {
  const url = new URL("https://x.com/search");
  url.searchParams.set("q", query.includeKeywords.join(" OR "));
  url.searchParams.set("src", "typed_query");
  url.searchParams.set("f", "live");
  return url;
}

async function scrollPage(page: { evaluate(fn: () => void): Promise<unknown>; waitForTimeout(ms: number): Promise<void> }, maxScrolls: number) {
  for (let index = 0; index < maxScrolls; index += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }
}
