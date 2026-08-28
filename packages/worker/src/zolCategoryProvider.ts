import type {
  CrawlPlanSource,
  SourceProviderCollectionContext,
  SourceProviderEvent,
  SourceRequestAdmissionPort,
} from "@domain-analysis/shared";
import { SourceProviderFailure } from "@domain-analysis/shared";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";

import { assertPublicHttpsUrl } from "./publicNetworkPolicy";
import {
  createPublicResourceTransport,
  preflightPublicResourceEnvironment,
  publicWebUserAgent,
  type PublicResourceTransportOptions,
  type RawPublicResponse,
} from "./publicResourceTransport";
import {
  requestPublicResourcePersistently as requestPersistently,
  type PublicResourceRequest,
} from "./publicResourceRetry";
import { captureEvent, decodeInlineText, inaccessible, supportingAssessment } from "./publicWebResourceContent";

const providerKey = "zol.category";
const providerVersion = "0.1.0";
const expectedPageCount = 7;
const expectedRequestBudget = 18;
const maximumBytes = 25_000_000;
const robotsUserAgent = publicWebUserAgent;
const expectedCategoryUrl = "https://detail.zol.com.cn/icebox/";
const expectedRankingUrl = "https://top.zol.com.cn/compositor/359/manu_attention.html";
const expectedCategoryId = "2115";

export interface ZolCategoryProviderOptions {
  request?: PublicResourceRequest;
  now?: () => Date;
  transportOptions?: PublicResourceTransportOptions;
  environmentPreflight?: () => Promise<void>;
}

export interface ZolBrandEntry {
  key: string;
  name: string;
  url: string;
}

export interface ZolRankingEntry extends ZolBrandEntry {
  rank: number;
  attentionPercent: number;
  score?: number;
  productCount?: number;
}

export interface ZolModelEntry {
  id: string;
  name: string;
  url: string;
}

export interface ZolCatalogFacts {
  page: number;
  totalCount?: number;
  pageCount?: number;
  models: ZolModelEntry[];
}

export interface ZolParameterFacts {
  modelId: string;
  sections: string[];
}

export function createZolCategoryProvider(options: ZolCategoryProviderOptions = {}) {
  const request = options.request ?? createPublicResourceTransport(options.transportOptions);
  const environmentPreflight = options.environmentPreflight
    ?? (() => preflightPublicResourceEnvironment(options.transportOptions));
  const now = options.now ?? (() => new Date());
  return {
    key: providerKey,
    version: providerVersion,
    validate: validateZolSource,
    async preflightEnvironment(sources: CrawlPlanSource[]) {
      for (const source of sources) validateZolSource(source);
      await environmentPreflight();
    },
    async preflight(source: CrawlPlanSource) { validateZolSource(source); },
    async *collect(source: CrawlPlanSource, runId: string, admission: SourceRequestAdmissionPort,
      signal?: AbortSignal, _context?: SourceProviderCollectionContext): AsyncIterable<SourceProviderEvent> {
      const configuration = zolConfiguration(source);
      const target = source.targets[0]!;
      const runSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(source.accessPolicy.maximumRunMs)])
        : AbortSignal.timeout(source.accessPolicy.maximumRunMs);
      const robots = new Map<string, ReturnType<typeof robotsParser> | "blocked">();
      for (const origin of new Set([
        new URL(configuration.categoryUrl).origin,
        new URL(configuration.rankingUrl).origin,
      ])) {
        const robotsUrl = new URL("/robots.txt", origin);
        const response = await requestPersistently({ source, runId, admission,
          targetKey: target.key, workKey: `robots:${origin}`, captureUnit: "robots_policy",
          url: robotsUrl, maximumBytes: configuration.maximumBytes, request, signal: runSignal });
        const event = captureEvent(source, target.key, robotsUrl, response, now(),
          supportingAssessment("robots_policy", "保存同源 robots 原文，不计入 V0 页面完成数"),
          { workKey: `robots:${origin}`, discoveryKind: "planned_entry", depth: 0 });
        yield event;
        if (event.snapshot.observation.state !== "accessible") return;
        robots.set(origin, parseRobots(robotsUrl, response));
      }

      const categoryUrl = assertPublicHttpsUrl(configuration.categoryUrl);
      const rankingUrl = assertPublicHttpsUrl(configuration.rankingUrl);
      if (!isAllowed(robots, categoryUrl) || !isAllowed(robots, rankingUrl)) {
        yield inaccessible(target.key, categoryUrl, now(), "access_denied", "robots.txt 不允许计划入口");
        return;
      }
      const categoryResponse = await requestPersistently({ source, runId, admission, targetKey: target.key,
        workKey: "page:category", captureUnit: "zol_category_roster", url: categoryUrl,
        maximumBytes: configuration.maximumBytes, request, signal: runSignal });
      let categoryFacts: ZolBrandEntry[];
      try {
        categoryFacts = parseZolCategoryPage(categoryResponse);
      } catch (error) {
        const failure = contentFailureFrom(error, "门类页结构无法识别");
        yield captureEvent(source, target.key, categoryUrl, categoryResponse, now(),
          rejected("category_structure", failure.message),
          { workKey: "page:category", discoveryKind: "planned_entry", depth: 0 });
        throw failure;
      }
      const categoryEvent = captureEvent(source, target.key, categoryUrl, categoryResponse, now(),
        categoryFacts.length > 0
          ? accepted("category_brand_links", `门类页识别 ${categoryFacts.length} 个品牌入口`)
          : rejected("category_structure", "门类页没有可识别的品牌入口"),
        { workKey: "page:category", discoveryKind: "planned_entry", depth: 0 });
      yield categoryEvent;
      if (categoryFacts.length === 0) throw contentFailure("门类页没有可识别的品牌入口");

      const rankingResponse = await requestPersistently({ source, runId, admission, targetKey: target.key,
        workKey: "page:ranking", captureUnit: "zol_brand_ranking", url: rankingUrl,
        maximumBytes: configuration.maximumBytes, request, signal: runSignal });
      let rankingFacts: ZolRankingEntry[];
      let p1: ReturnType<typeof calculateP1>;
      try {
        rankingFacts = parseZolRankingPage(rankingResponse);
        p1 = calculateP1(categoryFacts, rankingFacts);
      } catch (error) {
        const failure = contentFailureFrom(error, "品牌榜结构无法形成 P1");
        yield captureEvent(source, target.key, rankingUrl, rankingResponse, now(),
          rejected("ranking_structure", failure.message),
          { workKey: "page:ranking", discoveryKind: "planned_entry", depth: 0 });
        throw failure;
      }
      const rankingEvent = captureEvent(source, target.key, rankingUrl, rankingResponse, now(),
        accepted("attention_ranking", `品牌榜识别 ${rankingFacts.length} 行，P1 覆盖 ${(p1.coverage * 100).toFixed(1)}%`),
        { workKey: "page:ranking", discoveryKind: "planned_entry", depth: 0 });
      yield rankingEvent;
      if (p1.brands.length === 0) throw contentFailure("品牌榜与门类品牌入口无法对齐");

      const brand = p1.brands[0]!;
      const catalogUrl = assertPublicHttpsUrl(brand.url);
      if (!isAllowed(robots, catalogUrl)) {
        yield inaccessible(target.key, catalogUrl, now(), "access_denied", "robots.txt 不允许品牌目录");
        return;
      }
      const catalogs: Array<{ url: URL; facts: ZolCatalogFacts }> = [];
      for (const page of [1, 2]) {
        const url = page === 1 ? catalogUrl : pageUrl(catalogUrl, page);
        const response = await requestPersistently({ source, runId, admission, targetKey: target.key,
          workKey: `page:catalog:${page}`, captureUnit: "zol_brand_catalog_page", url,
          maximumBytes: configuration.maximumBytes, request, signal: runSignal });
        let facts: ZolCatalogFacts;
        try {
          facts = parseZolCatalogPage(response, url, page);
        } catch (error) {
          const failure = contentFailureFrom(error, `品牌目录第 ${page} 页结构无法识别`);
          yield captureEvent(source, target.key, url, response, now(),
            rejected(`catalog_page_${page}_structure`, failure.message),
            { workKey: `page:catalog:${page}`, discoveryKind: "html_link", depth: 1,
              parentUrl: page === 1 ? categoryUrl.href : catalogs[0]!.url.href });
          throw failure;
        }
        const event = captureEvent(source, target.key, url, response, now(), accepted(
          `catalog_page_${page}`, `${brand.name} 第 ${page} 页识别 ${facts.models.length} 个型号`),
        { workKey: `page:catalog:${page}`, discoveryKind: "html_link", depth: 1,
          parentUrl: page === 1 ? categoryUrl.href : catalogs[0]!.url.href });
        yield event;
        catalogs.push({ url, facts });
      }

      const models = uniqueModels(catalogs.flatMap((catalog) => catalog.facts.models));
      if (models.length < configuration.parameterPages) {
        throw contentFailure(`两页型号 ID 去重后只有 ${models.length} 个，少于 ${configuration.parameterPages} 个参数页`);
      }
      for (const model of models.slice(0, configuration.parameterPages)) {
        const catalog = catalogs.find((item) => item.facts.models.some((candidate) => candidate.id === model.id));
        if (!catalog) throw contentFailure(`型号 ${model.id} 缺少列表页血缘`);
        const url = parameterUrl(configuration.categoryId, model.id);
        if (!isAllowed(robots, url)) {
          yield inaccessible(target.key, url, now(), "access_denied", "robots.txt 不允许参数页");
          return;
        }
        const workKey = `page:param:${model.id}`;
        const response = await requestPersistently({ source, runId, admission, targetKey: target.key,
          workKey, captureUnit: "zol_model_parameters", url,
          maximumBytes: configuration.maximumBytes, request, signal: runSignal });
        let facts: ZolParameterFacts;
        try {
          facts = parseZolParameterPage(response, model.id);
        } catch (error) {
          const failure = contentFailureFrom(error, `型号 ${model.id} 参数页结构无法识别`);
          yield captureEvent(source, target.key, url, response, now(),
            rejected(`parameter_page_${model.id}_structure`, failure.message),
            { workKey, discoveryKind: "html_link", depth: 2, parentUrl: catalog.url.href });
          throw failure;
        }
        const event = captureEvent(source, target.key, url, response, now(), accepted(
          ...facts.sections.slice(0, 3), `型号 ${model.id} 的参数页识别 ${facts.sections.length} 个参数区块`),
        { workKey, discoveryKind: "html_link", depth: 2, parentUrl: catalog.url.href });
        yield event;
      }
      yield { type: "target.completed", targetKey: target.key };
    },
  };
}

function validateZolSource(source: CrawlPlanSource) {
  const configuration = zolConfiguration(source);
  if (source.provider.key !== providerKey || source.provider.version !== providerVersion) {
    throw new Error(`ZOL Provider 绑定必须是 ${providerKey}@${providerVersion}`);
  }
  if (source.targets.length !== 1 || source.targets[0]!.quantity.mode !== "target_count"
    || source.targets[0]!.quantity.targetCount !== expectedPageCount) {
    throw new Error("ZOL V0 必须只有一个 target，且 target_count=7");
  }
  const entryUrls = new Set(source.entryUrls.map((value) => assertPublicHttpsUrl(value).href));
  if (entryUrls.size !== 2 || !entryUrls.has(configuration.categoryUrl)
    || !entryUrls.has(configuration.rankingUrl)) {
    throw new Error("ZOL V0 入口必须恰好是门类页和品牌榜");
  }
  if (source.accessPolicy.maxRequestsPerMinute !== 2 || source.accessPolicy.minimumIntervalMs < 30_000) {
    throw new Error("ZOL V0 必须使用每分钟 2 次且最小间隔至少 30 秒");
  }
  if (source.stopPolicy.requestBudget !== expectedRequestBudget) {
    throw new Error("ZOL V0 请求预算必须覆盖 9 个逻辑请求各最多 2 次 Attempt");
  }
  if (!source.rawOutputPolicy.formats.includes("html") || !source.rawOutputPolicy.formats.includes("text")
    || source.rawOutputPolicy.retainAssets) {
    throw new Error("ZOL V0 只保存 HTML/文本原文，不保存图片附件");
  }
}

function zolConfiguration(source: CrawlPlanSource) {
  const values = Object.fromEntries(source.provider.configuration.map((item) => [item.key, item.value]));
  const keys = source.provider.configuration.map((item) => item.key).sort().join(",");
  if (keys !== "category_id,category_url,maximum_bytes,mode,parameter_pages,ranking_url"
    || values.mode !== "zol_v0" || typeof values.category_url !== "string"
    || typeof values.ranking_url !== "string") {
    throw new Error("ZOL Provider 配置必须包含 mode、category_id、category_url、ranking_url、parameter_pages 和 maximum_bytes");
  }
  const categoryUrl = assertPublicHttpsUrl(values.category_url);
  const rankingUrl = assertPublicHttpsUrl(values.ranking_url);
  const categoryId = String(values.category_id);
  const maximumBytesValue = Number(values.maximum_bytes);
  const parameterPages = Number(values.parameter_pages);
  if (!/^\d+$/.test(categoryId) || !Number.isInteger(maximumBytesValue)
    || maximumBytesValue < 100_000 || maximumBytesValue > maximumBytes
    || !Number.isInteger(parameterPages) || parameterPages !== 3) {
    throw new Error("ZOL V0 的 category_id、maximum_bytes 或 parameter_pages 无效");
  }
  if (categoryUrl.href !== expectedCategoryUrl || rankingUrl.href !== expectedRankingUrl
    || categoryId !== expectedCategoryId) {
    throw new Error("ZOL V0 只允许冰箱门类 2115 的公开门类页和品牌榜入口");
  }
  return { categoryUrl: categoryUrl.href, rankingUrl: rankingUrl.href, categoryId,
    maximumBytes: maximumBytesValue, parameterPages };
}

export function parseZolCategoryPage(response: RawPublicResponse): ZolBrandEntry[] {
  const $ = loadHtml(response);
  const entries = new Map<string, ZolBrandEntry>();
  $("#J_BrandAll a[data-link], #J_BrandAll a").each((_index, element) => {
    const href = $(element).attr("href");
    const url = href ? safeZolUrl(href, response.finalUrl) : undefined;
    const key = url ? brandKey(url) : undefined;
    const name = cleanText($(element).text());
    if (url && key && name && !entries.has(key)) entries.set(key, { key, name, url: url.href });
  });
  return [...entries.values()];
}

export function parseZolRankingPage(response: RawPublicResponse): ZolRankingEntry[] {
  const $ = loadHtml(response);
  return $(".rank-list__item").toArray().flatMap((element, index) => {
    const link = $(element).find(".cell-2 a.name").first();
    const href = link.attr("href");
    const url = href ? safeZolUrl(href, response.finalUrl) : undefined;
    const name = cleanText(link.text());
    const key = url ? brandKey(url) : undefined;
    const attentionText = $(element).find(".cell-5").text();
    const style = $(element).find(".cell-5 span").attr("style") ?? "";
    const attentionPercent = percentage(attentionText) ?? percentage(style);
    if (!url || !key || !name || attentionPercent == null) return [];
    const score = numberFrom($(element).find(".cell-3").text());
    const productCount = numberFrom($(element).find(".cell-7").text().replace(/,/g, ""));
    return [{ key, name, url: url.href, rank: index + 1, attentionPercent,
      ...(score == null ? {} : { score }), ...(productCount == null ? {} : { productCount }) }];
  });
}

export function parseZolCatalogPage(response: RawPublicResponse, url: URL, page: number): ZolCatalogFacts {
  const $ = loadHtml(response);
  const models = new Map<string, ZolModelEntry>();
  $("#J_PicMode > li, .pic-mode-box li").each((_index, element) => {
    const link = $(element).find("a.pic[href], h3 a[href]").filter((_i, item) => modelId($(item).attr("href")) != null).first();
    const href = link.attr("href");
    const id = modelId(href);
    const modelUrl = href ? safeZolUrl(href, url.href) : undefined;
    const name = cleanText($(element).find("h3 a").first().text() || $(element).find("img").first().attr("alt"));
    if (id && modelUrl && name && !models.has(id)) models.set(id, { id, name, url: modelUrl.href });
  });
  if (models.size === 0) throw contentFailure(`品牌目录第 ${page} 页没有可识别的型号 ID`);
  const totalCount = numberFrom($(".sort-box .total").first().text().replace(/,/g, ""));
  const pageCount = pageCountFrom($(".small-page-active").first().text());
  return { page, models: [...models.values()], ...(totalCount == null ? {} : { totalCount }),
    ...(pageCount == null ? {} : { pageCount }) };
}

export function parseZolParameterPage(response: RawPublicResponse, expectedModelId: string): ZolParameterFacts {
  const $ = loadHtml(response);
  const sections = [...new Set($("td.hd").toArray().map((element) => cleanText($(element).text())))]
    .filter((value) => ["基本参数", "技术参数", "功能特点", "其他尺寸与重量", "包装附件", "其他参数"]
      .some((label) => value.includes(label)));
  if (sections.length === 0) throw contentFailure(`型号 ${expectedModelId} 参数页没有可识别参数区块`);
  return { modelId: expectedModelId, sections };
}

export function calculateP1(category: ZolBrandEntry[], ranking: ZolRankingEntry[]) {
  const active = new Map(category.map((brand) => [brand.key, brand]));
  const brands: ZolRankingEntry[] = [];
  let coverage = 0;
  for (const entry of ranking) {
    if (!active.has(entry.key)) continue;
    brands.push(entry);
    coverage += entry.attentionPercent / 100;
    if (coverage >= 0.8) break;
  }
  if (brands.length === 0 || coverage < 0.8) throw contentFailure("品牌榜无法形成覆盖约 80% 的 P1 集合");
  return { brands, coverage };
}

function uniqueModels(models: ZolModelEntry[]) {
  return [...new Map(models.map((model) => [model.id, model])).values()];
}

function loadHtml(response: RawPublicResponse) {
  const mediaType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") {
    throw contentFailure(`ZOL 页面返回了非 HTML 类型：${mediaType || "unknown"}`);
  }
  return cheerio.load(decodeInlineText(response, mediaType).text);
}

function parseRobots(url: URL, response: RawPublicResponse) {
  if (response.statusCode === 404) return robotsParser(url.href, "");
  if (response.statusCode < 200 || response.statusCode >= 300) return "blocked" as const;
  return robotsParser(url.href, Buffer.from(response.body).toString("utf8"));
}

function isAllowed(robots: Map<string, ReturnType<typeof robotsParser> | "blocked">, url: URL) {
  const policy = robots.get(url.origin);
  return policy !== "blocked" && policy?.isAllowed(url.href, robotsUserAgent) !== false;
}

function accepted(...signals: string[]) {
  return { status: "accepted" as const, ruleVersion: "zol-v0-1", matchedSignals: signals.filter(Boolean).slice(0, 50),
    reason: signals.at(-1) ?? "ZOL 页面内容已识别" };
}

function rejected(signal: string, reason: string) {
  return { status: "rejected" as const, ruleVersion: "zol-v0-1", matchedSignals: [signal], reason };
}

function contentFailure(message: string) {
  return new SourceProviderFailure("content_not_accepted", message);
}

function contentFailureFrom(error: unknown, context: string) {
  if (error instanceof SourceProviderFailure) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return contentFailure(`${context}: ${detail}`);
}

function pageUrl(catalogUrl: URL, page: number) {
  const base = new URL(catalogUrl.href);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  base.pathname += `${page}.html`;
  return base;
}

function parameterUrl(categoryId: string, modelId: string) {
  return assertPublicHttpsUrl(`https://detail.zol.com.cn/${categoryId}/${modelId}/param.shtml`);
}

function safeZolUrl(value: string, base?: string) {
  try {
    const url = assertPublicHttpsUrl(new URL(value, base).href);
    if (url.origin !== "https://detail.zol.com.cn") return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function brandKey(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  const key = parts.at(-1) === "icebox" ? undefined : parts.at(-1);
  return key && /^[a-z0-9-]+$/i.test(key) ? key.toLowerCase() : undefined;
}

function modelId(value: string | undefined) {
  const match = value?.match(/\/icebox\/index(\d+)\.shtml(?:$|\?)/i);
  return match?.[1];
}

function cleanText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function percentage(value: string) {
  const match = value.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : undefined;
}

function numberFrom(value: string) {
  const match = value.match(/\d[\d,]*(?:\.\d+)?/);
  return match ? Number(match[0].replace(/,/g, "")) : undefined;
}

function pageCountFrom(value: string) {
  const match = value.match(/\/\s*(\d+)/);
  return match ? Number(match[1]) : undefined;
}
