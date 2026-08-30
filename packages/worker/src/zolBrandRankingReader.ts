import * as cheerio from "cheerio";
import pRetry from "p-retry";

import { assertPublicHttpsUrl } from "./publicNetworkPolicy";
import {
  isTransientPublicResourceFailure,
  type PublicResourceRequest,
} from "./publicResourceRetry";
import {
  createPublicResourceTransport,
  type PublicResourceTransportOptions,
  type RawPublicResponse,
} from "./publicResourceTransport";
import { decodeInlineText } from "./publicWebResourceContent";

const maximumRankingBytes = 5_000_000;
const keyPattern = /^[a-z][a-z0-9_-]+$/;

export interface ZolBrandRankingRow {
  rank: number;
  name: string;
  comprehensiveScore: number;
  key: string;
  catalogUrl: string;
}

export interface ZolBrandRankingResult {
  rankingUrl: string;
  title: string;
  rows: ZolBrandRankingRow[];
}

export interface ZolCategoryBrandRankingResult extends ZolBrandRankingResult {
  categoryUrl: string;
  categorySlug: string;
  evidenceUrls: string[];
}

export interface ZolBrandRankingReaderOptions {
  request?: PublicResourceRequest;
  transportOptions?: PublicResourceTransportOptions;
}

export function createZolBrandRankingReader(options: ZolBrandRankingReaderOptions = {}) {
  const request = options.request ?? createPublicResourceTransport(options.transportOptions);
  return {
    async read(input: { rankingUrl: string; categorySlug: string; signal?: AbortSignal }) {
      const rankingUrl = validateRankingUrl(input.rankingUrl);
      validateCategorySlug(input.categorySlug);
      const response = await requestWithTransientRetry(request, rankingUrl, input.signal);
      return parseZolBrandRanking(response, rankingUrl, input.categorySlug);
    },
    async discoverAndRead(input: { categorySlug?: string; rankingUrl?: string; signal?: AbortSignal }) {
      if (!input.categorySlug && !input.rankingUrl) throw new Error("ZOL 榜单发现缺少门类或排行榜候选入口");
      const candidateRankingUrl = input.rankingUrl ? validateRankingUrl(input.rankingUrl) : undefined;
      const candidateResponse = candidateRankingUrl
        ? await requestWithTransientRetry(request, candidateRankingUrl, input.signal) : undefined;
      const categorySlug = input.categorySlug
        ?? inferZolBrandRankingCategorySlug(candidateResponse!, candidateRankingUrl!);
      validateCategorySlug(categorySlug);
      const categoryUrl = new URL(`https://detail.zol.com.cn/${categorySlug}/`);
      const categoryResponse = await requestWithTransientRetry(request, categoryUrl, input.signal);
      const rankingHubUrl = parseZolCategoryRankingHub(categoryResponse, categoryUrl, categorySlug);
      const hubResponse = await requestWithTransientRetry(request, rankingHubUrl, input.signal);
      const rankingUrl = parseZolBrandRankingEntry(hubResponse, rankingHubUrl);
      if (candidateRankingUrl && candidateRankingUrl.href !== rankingUrl.href) {
        throw new Error("Capture Task 排行榜候选与当前门类官方品牌榜入口不一致");
      }
      const rankingResponse = candidateResponse
        ?? await requestWithTransientRetry(request, rankingUrl, input.signal);
      const ranking = parseZolBrandRanking(rankingResponse, rankingUrl, categorySlug);
      return { ...ranking, categoryUrl: categoryUrl.href,
        categorySlug, evidenceUrls: [categoryUrl.href, rankingHubUrl.href, rankingUrl.href] };
    },
  };
}

async function requestWithTransientRetry(request: PublicResourceRequest, url: URL, signal?: AbortSignal) {
  return pRetry(async () => {
    const response = await request(url, maximumRankingBytes, signal);
    if (response.statusCode === 502 || response.statusCode === 503 || response.statusCode === 504) {
      throw new Error(`${response.statusCode} - ZOL 临时网关错误`);
    }
    return response;
  }, {
    retries: 1,
    minTimeout: 1_000,
    maxTimeout: 1_000,
    factor: 1,
    randomize: false,
    ...(signal ? { signal } : {}),
    shouldRetry: ({ error }) => isTransientPublicResourceFailure(error),
  });
}

function inferZolBrandRankingCategorySlug(response: RawPublicResponse, rankingUrl: URL) {
  const $ = loadExactHtml(response, rankingUrl, "ZOL 品牌排行榜");
  const slugs = new Set($(".brand-rank-list .rank-list__item .cell-2 a.name[href]").toArray()
    .flatMap((element) => {
      const href = $(element).attr("href");
      if (!href) return [];
      try {
        const url = assertPublicHttpsUrl(new URL(href, rankingUrl).href);
        const match = url.origin === "https://detail.zol.com.cn"
          ? url.pathname.match(/^\/([a-z][a-z0-9_-]*)\/[a-z][a-z0-9_-]*\/$/) : null;
        return match?.[1] ? [match[1]] : [];
      } catch { return []; }
    }));
  if (slugs.size !== 1) throw new Error("ZOL 品牌排行榜无法确定唯一门类 slug");
  return [...slugs][0]!;
}

export function parseZolCategoryRankingHub(
  response: RawPublicResponse,
  categoryUrl: URL,
  categorySlug: string,
) {
  validateCategorySlug(categorySlug);
  if (categoryUrl.href !== `https://detail.zol.com.cn/${categorySlug}/`) {
    throw new Error("ZOL 门类入口与门类 slug 不一致");
  }
  const $ = loadExactHtml(response, categoryUrl, "ZOL 门类入口");
  const expected = `https://top.zol.com.cn/compositor/${categorySlug}.html`;
  const matches = uniqueUrls($, categoryUrl).filter((url) => url.href === expected);
  if (matches.length !== 1) throw new Error("ZOL 门类页没有唯一的同门类排行榜入口");
  return matches[0]!;
}

export function parseZolBrandRankingEntry(response: RawPublicResponse, rankingHubUrl: URL) {
  if (rankingHubUrl.origin !== "https://top.zol.com.cn"
    || !/^\/compositor\/[a-z][a-z0-9_-]*\.html$/.test(rankingHubUrl.pathname)
    || rankingHubUrl.search || rankingHubUrl.hash) {
    throw new Error("ZOL 排行榜聚合页入口无效");
  }
  const $ = loadExactHtml(response, rankingHubUrl, "ZOL 排行榜聚合页");
  const matches = uniqueUrls($, rankingHubUrl).filter((url) => url.origin === "https://top.zol.com.cn"
    && /^\/compositor\/\d+\/manu_attention\.html$/.test(url.pathname)
    && !url.search && !url.hash);
  if (matches.length !== 1) throw new Error("ZOL 排行榜聚合页没有唯一品牌排行榜入口");
  return matches[0]!;
}

export function parseZolBrandRanking(
  response: RawPublicResponse,
  rankingUrl: URL,
  categorySlug: string,
): ZolBrandRankingResult {
  validateRankingUrl(rankingUrl.href);
  validateCategorySlug(categorySlug);
  if (response.statusCode !== 200) throw new Error(`ZOL 品牌排行榜返回 HTTP ${response.statusCode}`);
  if (response.finalUrl && new URL(response.finalUrl).href !== rankingUrl.href) {
    throw new Error("ZOL 品牌排行榜最终 URL 与计划入口不一致");
  }
  const mediaType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") {
    throw new Error(`ZOL 品牌排行榜返回了非 HTML 类型：${mediaType || "unknown"}`);
  }
  const $ = cheerio.load(decodeInlineText(response, mediaType).text);
  const list = $(".brand-rank-list").first();
  if (list.length === 0) throw new Error("ZOL 页面没有品牌排行榜列表");
  const headers = list.find(".rank-list__head .rank-list__cell").toArray()
    .map((element) => cleanText($(element).text()));
  if (!headers.includes("排名") || !headers.includes("品牌") || !headers.includes("品牌综合评分")) {
    throw new Error("ZOL 品牌排行榜缺少名次、品牌或品牌综合评分列");
  }
  const title = cleanText(list.closest(".section").find(".section__head h3").first().text());
  if (!title.endsWith("品牌排行榜")) throw new Error("ZOL 品牌排行榜缺少门类标题");
  const rows = list.find(".rank-list__item").toArray().map((element, index) => {
    const rank = index + 1;
    validateDisplayedRank($, element, rank);
    const name = cleanText($(element).find(".cell-2 a.name").first().text());
    const href = $(element).find(".cell-2 a.name").first().attr("href");
    const scoreText = cleanText($(element).find(".cell-3 .score span").first().text());
    if (!name || !href) throw new Error(`ZOL 品牌排行榜第 ${rank} 行缺少品牌名称或目录`);
    const scoreMatch = scoreText.match(/^(-?\d+(?:\.\d+)?)分$/);
    if (!scoreMatch) throw new Error(`ZOL 品牌排行榜第 ${rank} 行缺少可验证综合评分`);
    const catalog = validateCatalogUrl(href, rankingUrl, categorySlug);
    return { rank, name, comprehensiveScore: Number(scoreMatch[1]),
      key: catalog.key, catalogUrl: catalog.url.href };
  });
  if (rows.length === 0 || rows.length > 500) throw new Error("ZOL 品牌排行榜行数不在协议范围内");
  const keys = rows.map((row) => row.key);
  const urls = rows.map((row) => row.catalogUrl);
  if (new Set(keys).size !== keys.length || new Set(urls).size !== urls.length) {
    throw new Error("ZOL 品牌排行榜包含重复品牌 key 或目录 URL");
  }
  return { rankingUrl: rankingUrl.href, title, rows };
}

function validateDisplayedRank(
  $: cheerio.CheerioAPI,
  element: Parameters<cheerio.CheerioAPI>[0],
  expectedRank: number,
) {
  const cell = $(element).find(".cell-1").first();
  const displayed = cleanText(cell.text());
  if (displayed) {
    if (Number(displayed) !== expectedRank) throw new Error(`ZOL 品牌排行榜第 ${expectedRank} 行名次不一致`);
    return;
  }
  if (expectedRank !== 1 || !cell.find(".rank__number.number-n1").length) {
    throw new Error(`ZOL 品牌排行榜第 ${expectedRank} 行缺少名次`);
  }
}

function validateRankingUrl(raw: string) {
  const url = assertPublicHttpsUrl(raw);
  if (url.origin !== "https://top.zol.com.cn"
    || !/^\/compositor\/\d+\/manu_[a-z0-9_]+\.html$/.test(url.pathname)
    || url.search || url.hash) {
    throw new Error("ZOL 品牌排行榜必须使用官方 compositor HTTPS 入口");
  }
  return url;
}

function validateCategorySlug(categorySlug: string) {
  if (!/^[a-z][a-z0-9_-]+$/.test(categorySlug)) throw new Error("ZOL 门类 slug 无效");
}

function validateCatalogUrl(value: string, rankingUrl: URL, categorySlug: string) {
  const url = assertPublicHttpsUrl(new URL(value, rankingUrl).href);
  const match = url.pathname.match(new RegExp(`^/${escapeRegex(categorySlug)}/([a-z][a-z0-9_-]*)/$`));
  const key = match?.[1];
  if (url.origin !== "https://detail.zol.com.cn" || url.search || url.hash || !key || !keyPattern.test(key)) {
    throw new Error("ZOL 榜单品牌目录与当前门类不一致");
  }
  return { key, url };
}

function loadExactHtml(response: RawPublicResponse, expectedUrl: URL, label: string) {
  if (response.statusCode !== 200) throw new Error(`${label}返回 HTTP ${response.statusCode}`);
  if (response.finalUrl && new URL(response.finalUrl).href !== expectedUrl.href) {
    throw new Error(`${label}最终 URL 与计划入口不一致`);
  }
  const mediaType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") {
    throw new Error(`${label}返回了非 HTML 类型：${mediaType || "unknown"}`);
  }
  return cheerio.load(decodeInlineText(response, mediaType).text);
}

function uniqueUrls($: cheerio.CheerioAPI, baseUrl: URL) {
  const urls = $("a[href]").toArray().flatMap((element) => {
    const href = $(element).attr("href");
    if (!href) return [];
    try { return [assertPublicHttpsUrl(new URL(href, baseUrl).href)]; } catch { return []; }
  });
  return [...new Map(urls.map((url) => [url.href, url])).values()];
}

function cleanText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
