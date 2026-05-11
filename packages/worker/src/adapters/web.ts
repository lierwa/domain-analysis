import { chromium, type BrowserContext, type Page } from "playwright";
import { buildKeywordQuery, hasExcludedKeyword, type CollectedRawContent, type CollectionAdapter } from "./types";
import { createBrowserRuntimeConfig } from "../runtime/browserRuntime";

const MAX_SEARCH_RESULTS = 20;

export function createWebAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  return {
    async collect(query) {
      const browser = createBrowserRuntimeConfig(env);
      const context = await chromium.launchPersistentContext(browser.userDataDir, {
        channel: "chrome",
        headless: browser.mode === "headless"
      });

      try {
        const searchPage = await context.newPage();
        await searchPage.goto(buildBingSearchUrl(query.includeKeywords, query.excludeKeywords).toString(), {
          waitUntil: "domcontentloaded",
          timeout: 30000
        });

        const urls = await extractSearchResultUrls(searchPage, Math.min(query.limitPerRun, MAX_SEARCH_RESULTS));
        const items: CollectedRawContent[] = [];

        for (const url of urls) {
          if (items.length >= query.limitPerRun) break;
          const item = await collectPage(context, url, query.excludeKeywords).catch(() => null);
          if (item) items.push(item);
        }

        return items;
      } finally {
        await context.close();
      }
    }
  };
}

export function buildBingSearchUrl(includeKeywords: string[], excludeKeywords: string[]) {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", buildKeywordQuery(includeKeywords, excludeKeywords));
  return url;
}

export function extractReadableText(html: string) {
  return normalizeWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

async function collectPage(context: BrowserContext, url: string, excludeKeywords: string[]) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const title = await page.title().catch(() => "");
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const text = normalizeWhitespace([title, bodyText].filter(Boolean).join("\n\n"));
    if (isBlockedPage(page.url(), text)) return null;
    if (!text || hasExcludedKeyword(text, excludeKeywords)) return null;

    return {
      platform: "web" as const,
      externalId: page.url(),
      url: page.url(),
      text: text.slice(0, 12000),
      metricsJson: { source: "bing_playwright" },
      rawJson: { title, source: "bing_playwright" }
    };
  } finally {
    await page.close();
  }
}

async function extractSearchResultUrls(page: Page, limit: number) {
  const urls = await page.locator("li.b_algo h2 a[href], a[href]").evaluateAll((anchors) =>
    anchors
      .map((anchor) => anchor.getAttribute("href"))
      .filter((href): href is string => Boolean(href))
  );

  const unique = new Set<string>();
  for (const href of urls) {
    const normalized = normalizeSearchHref(href);
    if (!normalized) continue;
    unique.add(normalized);
    if (unique.size >= limit) break;
  }
  return [...unique];
}

export function isBlockedPage(url: string, text: string) {
  const haystack = `${url}\n${text}`.toLowerCase();
  // WHY: 免费采集只能读取公开页面；验证码/登录页代表访问被拦截，保存它们会污染分析数据。
  // TRADE-OFF: 关键词判断保守，可能跳过少量讨论 captcha/login 的文章，但避免把拦截页当内容。
  return ["captcha", "verify you are human", "sign in to continue", "login to continue"].some((keyword) =>
    haystack.includes(keyword)
  );
}

function normalizeSearchHref(href: string) {
  try {
    const url = new URL(href, "https://www.bing.com");
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.hostname.includes("bing.com") || url.hostname.includes("microsoft.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
