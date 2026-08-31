import { SourceProviderFailure } from "@domain-analysis/shared";
import * as cheerio from "cheerio";

import { assertPublicHttpsUrl } from "./publicNetworkPolicy";
import type { RawPublicResponse } from "./publicResourceTransport";
import { decodeInlineText } from "./publicWebResourceContent";

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

export function parseZolCatalogPage(
  response: RawPublicResponse,
  url: URL,
  page: number,
  categorySlug: string,
): ZolCatalogFacts {
  const $ = loadHtml(response);
  const models = new Map<string, ZolModelEntry>();
  $("#J_PicMode > li, .pic-mode-box li").each((_index, element) => {
    const link = $(element).find("a.pic[href], h3 a[href]")
      .filter((_i, item) => modelId($(item).attr("href"), categorySlug) != null)
      .first();
    const href = link.attr("href");
    const id = modelId(href, categorySlug);
    const modelUrl = href ? safeZolUrl(href, url.href) : undefined;
    const heading = $(element).find("h3 a").first();
    const name = cleanText(heading.attr("title") || $(element).find("img").first().attr("alt") || heading.text());
    if (id && modelUrl && name && !models.has(id)) models.set(id, { id, name, url: modelUrl.href });
  });
  if (models.size === 0) throw contentFailure(`品牌目录第 ${page} 页没有可识别的型号 ID`);
  const totalCount = numberFrom($(".sort-box .total").first().text().replace(/,/g, ""));
  const pageCount = pageCountFrom($(".small-page-active").first().text());
  return {
    page,
    models: [...models.values()],
    ...(totalCount == null ? {} : { totalCount }),
    ...(pageCount == null ? {} : { pageCount }),
  };
}

export function parseZolParameterPage(response: RawPublicResponse, expectedModelId: string): ZolParameterFacts {
  const $ = loadHtml(response);
  const sections = [...new Set($("td.hd").toArray().map((element) => cleanText($(element).text())))]
    .filter((value) => ["基本参数", "技术参数", "功能特点", "其他尺寸与重量", "包装附件", "其他参数"]
      .some((label) => value.includes(label)));
  if (sections.length === 0) throw contentFailure(`型号 ${expectedModelId} 参数页没有可识别参数区块`);
  return { modelId: expectedModelId, sections };
}

export function parseZolGalleryUrl(response: RawPublicResponse, modelIdValue: string) {
  const $ = loadHtml(response);
  const element = $("a[href]").toArray().find((item) => {
    const href = $(item).attr("href") ?? "";
    return new RegExp(`/${modelIdValue}/pic\\.shtml(?:$|[?#])`, "i").test(href);
  });
  const href = element ? $(element).attr("href") : undefined;
  const url = href ? safeZolUrl(href, response.finalUrl) : undefined;
  if (!url) throw new Error(`型号 ${modelIdValue} 参数页没有图集入口`);
  return url;
}

export function zolProductGroupId(modelId: string) {
  const value = Number(modelId);
  if (!/^\d+$/.test(modelId) || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`ZOL 产品 ID 无法形成参数页分片：${modelId}`);
  }
  // WHY：ZOL 参数页首段按每 1000 个产品 ID 分片，而不是品类 ID；同一门类的不同年代可能落在不同分片。
  return String(Math.ceil(value / 1_000));
}

function loadHtml(response: RawPublicResponse) {
  const mediaType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") {
    throw contentFailure(`ZOL 页面返回了非 HTML 类型：${mediaType || "unknown"}`);
  }
  return cheerio.load(decodeInlineText(response, mediaType).text);
}

function safeZolUrl(value: string, base?: string) {
  try {
    const url = assertPublicHttpsUrl(new URL(value, base).href);
    return url.origin === "https://detail.zol.com.cn" ? url : undefined;
  } catch {
    return undefined;
  }
}

function modelId(value: string | undefined, categorySlug: string) {
  const escapedSlug = categorySlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value?.match(new RegExp(`/${escapedSlug}/index(\\d+)\\.shtml(?:$|\\?)`, "i"))?.[1];
}

function cleanText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function numberFrom(value: string) {
  const match = value.match(/\d[\d,]*(?:\.\d+)?/);
  return match ? Number(match[0].replace(/,/g, "")) : undefined;
}

function pageCountFrom(value: string) {
  const match = value.match(/\/\s*(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function contentFailure(message: string) {
  return new SourceProviderFailure("content_not_accepted", message);
}
