import { PlaywrightCrawler, ProxyConfiguration, playwrightUtils } from "crawlee";
import type { Page } from "playwright";
import { createBrowserRuntimeConfig } from "../runtime/browserRuntime";
import {
  buildKeywordQuery,
  hasExcludedKeyword,
  type CollectedRawContent,
  type CollectionAdapter,
  type CollectionStopReason
} from "./types";

interface RedditBrowserRow {
  id?: string;
  title?: string;
  body?: string;
  href?: string;
  authorName?: string;
  subreddit?: string;
  scoreText?: string;
  commentsText?: string;
  publishedAt?: string;
}

const REDDIT_BROWSER_TARGETS_PER_SEARCH = 40;
const REDDIT_BROWSER_POST_SELECTOR = [
  "[data-testid='search-sdui-post']",
  "[data-testid='search-post-unit']",
  "shreddit-post",
  "[data-testid='post-container']",
  "article"
].join(", ");
const REDDIT_BROWSER_EXTRACT_SCRIPT = `
(() => {
  const selector = ${JSON.stringify(REDDIT_BROWSER_POST_SELECTOR)};
  return Array.from(document.querySelectorAll(selector)).map((element) => {
    const closestTracking = element.closest("search-telemetry-tracker");
    const trackingNode = closestTracking || element.querySelector("search-telemetry-tracker");
    const trackingRaw = trackingNode ? trackingNode.getAttribute("data-faceplate-tracking-context") : "";
    let tracking = {};
    try {
      tracking = trackingRaw ? JSON.parse(trackingRaw) : {};
    } catch {
      tracking = {};
    }
    const text = (query) => {
      const node = element.querySelector(query);
      return node && node.textContent ? node.textContent.replace(/\\s+/g, " ").trim() : "";
    };
    const attr = (name) => element.getAttribute(name) || "";
    const href = (query) => {
      const node = element.querySelector(query);
      return node ? (node.href || node.getAttribute("href") || "") : "";
    };
    const allText = element.textContent ? element.textContent.replace(/\\s+/g, " ").trim() : "";
    const titleLink = element.querySelector("a[data-testid='post-title'], a[slot='title'], a[href*='/comments/']");
    const scoreMatch = allText.match(/([\\d,.]+)\\s*(票|votes?|upvotes?)/i);
    const commentsMatch = allText.match(/([\\d,.]+)\\s*(条评论|comments?)/i);
    const title = (tracking.post && tracking.post.title)
      || attr("post-title")
      || (titleLink ? titleLink.getAttribute("aria-label") : "")
      || text("[slot='title']")
      || text("a[slot='title']")
      || text("a[data-testid='post-title']")
      || text("h3")
      || text("a[href*='/comments/']");
    const link = attr("permalink")
      || href("a[slot='full-post-link']")
      || href("a[slot='title']")
      || href("a[data-testid='post-title']")
      || href("a[href*='/comments/']");
    const id = attr("data-thingid")
      || attr("post-id")
      || attr("id")
      || (tracking.post && tracking.post.id)
      || (link.split("/comments/")[1] || "").split("/")[0]
      || "";

    return {
      id,
      title,
      body: text("[slot='text-body']") || text("[data-click-id='text']") || text("[data-testid='post-content']"),
      href: link,
      authorName: attr("author") || (tracking.profile && tracking.profile.name) || text("a[href^='/user/'], a[href^='/u/']"),
      subreddit: attr("subreddit-prefixed-name") || (tracking.subreddit && tracking.subreddit.name) || text("a[href^='/r/']"),
      scoreText: attr("score") || (scoreMatch ? scoreMatch[0] : "") || text("[slot='vote-arrows'], [data-testid='post-vote-count']"),
      commentsText: attr("comment-count") || (commentsMatch ? commentsMatch[0] : "") || text("a[href*='/comments/'] span, [data-testid='comment-count']"),
      publishedAt: attr("created-timestamp") || (element.querySelector("time") ? element.querySelector("time").getAttribute("datetime") : undefined)
    };
  });
})()
`;

export function createRedditBrowserAdapter(env: NodeJS.ProcessEnv = process.env): CollectionAdapter {
  return {
    async collect(query) {
      const browser = createBrowserRuntimeConfig(env);
      const proxyUrl = getRedditProxyUrl(env);
      const searchUrls = buildBrowserSearchUrls(query.includeKeywords, query.excludeKeywords, query.limitPerRun);
      const rows: RedditBrowserRow[] = [];
      let pagesCollected = 0;
      let stopReason: CollectionStopReason = "scroll_exhausted";
      let crawlError: Error | null = null;

      const crawler = new PlaywrightCrawler({
        maxConcurrency: 1,
        maxRequestsPerCrawl: searchUrls.length,
        maxRequestsPerMinute: 4,
        sameDomainDelaySecs: 10,
        navigationTimeoutSecs: 60,
        requestHandlerTimeoutSecs: 300,
        retryOnBlocked: false,
        launchContext: {
          useChrome: true,
          userDataDir: browser.userDataDir,
          launchOptions: {
            headless: browser.mode === "headless"
          }
        },
        ...(proxyUrl ? { proxyConfiguration: new ProxyConfiguration({ proxyUrls: [proxyUrl] }) } : {}),
        requestHandler: async ({ page }) => {
          const currentItems = normalizeRedditBrowserRows(rows, query.excludeKeywords, query.limitPerRun);
          if (currentItems.length >= query.limitPerRun) {
            stopReason = "target_reached";
            return;
          }

          pagesCollected += 1;
          if (await isRedditBlockedPage(page)) {
            stopReason = "blocked_or_login";
            return;
          }

          // WHY: Reddit 搜索结果是无限滚动页面；滚动生命周期交给 Crawlee 官方工具，
          // 避免在项目里继续手写 scrollBy/stableRounds 这类脆弱控制逻辑。
          // TRADE-OFF: infiniteScroll 按页面耗尽/超时停止，项目只负责结果归一化和低频配置。
          await playwrightUtils.infiniteScroll(page, {
            timeoutSecs: Number(env.REDDIT_INFINITE_SCROLL_TIMEOUT_SECS ?? 240),
            waitForSecs: Number(env.REDDIT_INFINITE_SCROLL_WAIT_SECS ?? 5)
          });
          rows.push(...await extractRedditBrowserRows(page));
          const items = normalizeRedditBrowserRows(rows, query.excludeKeywords, query.limitPerRun);
          stopReason = items.length >= query.limitPerRun ? "target_reached" : "scroll_exhausted";
        },
        failedRequestHandler: async ({ response, request }, error) => {
          const status = response?.status();
          crawlError = new Error(
            `reddit_browser_crawl_failed_${status ?? request.errorMessages.at(-1) ?? error.message}`
          );
        }
      });

      await crawler.run(searchUrls.map((url) => url.toString()));
      if (crawlError) throw crawlError;
      return {
        items: normalizeRedditBrowserRows(rows, query.excludeKeywords, query.limitPerRun),
        metadata: {
          pagesCollected,
          stopReason
        }
      };
    }
  };
}

function buildBrowserSearchUrls(includeKeywords: string[], excludeKeywords: string[], limitPerRun: number) {
  const queries = buildRedditBrowserSearchQueries(includeKeywords, excludeKeywords);
  const variantCount = Math.min(
    queries.length,
    Math.max(1, Math.ceil(limitPerRun / REDDIT_BROWSER_TARGETS_PER_SEARCH))
  );
  return queries
    .slice(0, variantCount)
    .map((searchQuery) => buildBrowserSearchUrl(searchQuery));
}

function buildBrowserSearchUrl(searchQuery: string) {
  const url = new URL("https://www.reddit.com/search/");
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("sort", "new");
  url.searchParams.set("type", "link");
  return url;
}

function buildRedditBrowserSearchQueries(includeKeywords: string[], excludeKeywords: string[]) {
  const queries = [
    buildKeywordQuery(includeKeywords, excludeKeywords),
    buildLooseRedditQuery(includeKeywords, excludeKeywords),
    buildTokenRedditQuery(includeKeywords, excludeKeywords),
    ...includeKeywords.map((keyword) => appendExcludeKeywords(keyword, excludeKeywords))
  ].filter(Boolean);

  // WHY: Reddit 官方搜索说明中，带引号/字段语法会强制更窄匹配；大目标采集需要先保留精准性，
  // 再补充普通 OR 与单关键词搜索页，把无限滚动交给 Crawlee，避免自研分页/滚动调度。
  // TRADE-OFF: 多跑几个低频搜索页会变慢，但比扩大单页滚动超时更可控，也不会默认放弃精准结果。
  return Array.from(new Set(queries));
}

function buildLooseRedditQuery(includeKeywords: string[], excludeKeywords: string[]) {
  const include = includeKeywords.map((keyword) => keyword.trim()).filter(Boolean).join(" OR ");
  return appendExcludeKeywords(include, excludeKeywords);
}

function buildTokenRedditQuery(includeKeywords: string[], excludeKeywords: string[]) {
  const tokens = Array.from(new Set(
    includeKeywords
      .flatMap((keyword) => keyword.split(/\s+/))
      .map((keyword) => keyword.trim())
      .filter(Boolean)
  ));
  return appendExcludeKeywords(tokens.join(" OR "), excludeKeywords);
}

function appendExcludeKeywords(searchQuery: string, excludeKeywords: string[]) {
  const query = searchQuery.trim();
  const exclude = excludeKeywords.map((keyword) => `-"${keyword}"`).join(" ");
  return [query, exclude].filter(Boolean).join(" ").trim();
}

async function extractRedditBrowserRows(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await readRedditBrowserRows(page);
    } catch (error) {
      if (!isTransientRedditDomError(error) || attempt === 2) throw error;
      // WHY: Reddit 首屏会在 hydration/路由切换时销毁 execution context；这属于页面生命周期抖动，
      // 不是采集选择器错误。短重试能跑通真实浏览器链路，同时不扩大为无限等待。
      // TRADE-OFF: 最多重试两次，避免网络/DOM 真失败时任务长时间卡住。
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(750);
    }
  }
  return [];
}

async function isRedditBlockedPage(page: Page) {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const haystack = bodyText.toLowerCase();
  return [
    "sign in to continue",
    "login to continue",
    "verify you are human",
    "captcha",
    "blocked"
  ].some((keyword) => haystack.includes(keyword));
}

function readRedditBrowserRows(page: Page) {
  // WHY: 这里用字符串脚本而不是传函数给 evaluate/evaluateAll；tsx/esbuild 会给函数注入 __name，
  // Playwright 序列化后浏览器上下文没有该 helper，真实运行会抛 ReferenceError。
  // TRADE-OFF: 字符串脚本缺少 TS 类型保护，所以后续归一化仍在 Node 侧完成并做空值过滤。
  return page.evaluate<RedditBrowserRow[]>(REDDIT_BROWSER_EXTRACT_SCRIPT);
}

function isTransientRedditDomError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Execution context was destroyed") || message.includes("Cannot find context with specified id");
}

export function normalizeRedditBrowserRows(
  rows: RedditBrowserRow[],
  excludeKeywords: string[],
  limitPerRun: number
): CollectedRawContent[] {
  const seen = new Set<string>();
  return rows
    .map((row) => {
      const text = [row.title, row.body].filter(Boolean).join("\n\n").trim();
      const url = normalizeRedditUrl(row.href);
      return { row, text, url, externalId: normalizeRedditExternalId(row, url) };
    })
    .filter(({ text, url, externalId }) => text && url && externalId && !hasExcludedKeyword(text, excludeKeywords))
    .filter(({ externalId }) => {
      if (!externalId || seen.has(externalId)) return false;
      seen.add(externalId);
      return true;
    })
    .slice(0, limitPerRun)
    .map(({ row, text, url, externalId }) => ({
      platform: "reddit" as const,
      externalId,
      url,
      authorName: normalizeRedditAuthor(row.authorName),
      text,
      metricsJson: {
        source: "reddit_browser_profile",
        score: parseCompactNumber(row.scoreText),
        comments: parseCompactNumber(row.commentsText),
        subreddit: normalizeSubreddit(row.subreddit)
      },
      publishedAt: normalizeRedditPublishedAt(row.publishedAt),
      rawJson: row as Record<string, unknown>
    }));
}

function normalizeRedditUrl(href: string | undefined) {
  if (!href) return "";
  try {
    return new URL(href, "https://www.reddit.com").toString();
  } catch {
    return "";
  }
}

function normalizeRedditExternalId(row: RedditBrowserRow, url: string) {
  if (row.id) return row.id.replace(/^t3_/, "");
  return url.split("/comments/").at(1)?.split("/")[0];
}

function normalizeRedditAuthor(value: string | undefined) {
  return value?.replace(/^u\//i, "").trim() || undefined;
}

function normalizeSubreddit(value: string | undefined) {
  return value?.replace(/^r\//i, "").trim() || undefined;
}

function normalizeRedditPublishedAt(value: string | undefined) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function parseCompactNumber(value: string | undefined) {
  if (!value) return 0;
  const match = value.toLowerCase().replace(/,/g, "").match(/([\d.]+)\s*([km]?)/);
  if (!match) return 0;
  const base = Number(match[1]);
  if (Number.isNaN(base)) return 0;
  const multiplier = match[2] === "k" ? 1000 : match[2] === "m" ? 1000000 : 1;
  return Math.round(base * multiplier);
}

function getRedditProxyUrl(env: NodeJS.ProcessEnv) {
  return env.REDDIT_PROXY_URL
    || env.HTTPS_PROXY
    || env.https_proxy
    || env.HTTP_PROXY
    || env.http_proxy;
}
