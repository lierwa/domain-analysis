import * as cheerio from "cheerio";

import { assertPublicHttpsUrl } from "./publicNetworkPolicy";
import type { RawPublicResponse } from "./publicResourceTransport";
import { decodeInlineText } from "./publicWebResourceContent";

export interface ZolGallerySection {
  key: string;
  title: string;
  detailUrl: string;
  declaredCount?: number;
  ordinal: number;
}

export interface ZolGalleryImage {
  url: string;
  locator: string;
  section: string;
  ordinal: number;
}

export function parseZolGallerySections(response: RawPublicResponse, modelId: string): ZolGallerySection[] {
  const $ = cheerio.load(htmlText(response));
  const sections = $(".section").toArray().flatMap((element, ordinal) => {
    const list = $(element).find(".picture-list").first();
    if (list.length === 0) return [];
    const title = cleanText($(element).find(".section-header h3").first().text()) || `图集分区 ${ordinal + 1}`;
    const href = list.find("a.more[href]").first().attr("href")
      ?? list.find("a.imgwrap[href]").first().attr("href");
    const detailUrl = href ? safePictureDetailUrl(href, response.finalUrl, modelId) : undefined;
    if (!detailUrl) return [];
    const declared = title.match(/\((\d+)\s*张\)/)?.[1];
    return [{ key: `section-${ordinal}`, title, detailUrl: detailUrl.href,
      ...(declared ? { declaredCount: Number(declared) } : {}), ordinal }];
  });
  const unique = [...new Map(sections.map((section) => [section.detailUrl, section])).values()];
  if (unique.length === 0) throw new Error(`型号 ${modelId} 图集没有明确的大图分区入口`);
  return unique;
}

export function parseZolPictureImages(response: RawPublicResponse, modelId: string): ZolGalleryImage[] {
  const html = htmlText(response);
  const match = html.match(/\bvar\s+picList\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!match?.[1]) throw new Error(`型号 ${modelId} 大图页没有 picList`);
  const raw: unknown = JSON.parse(match[1]);
  if (!Array.isArray(raw)) throw new Error(`型号 ${modelId} 大图页 picList 不是数组`);
  const candidates = raw.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (String(value.proId) !== modelId || typeof value.picSrc !== "string"
      || typeof value.hash !== "string" || !/^[a-z0-9_-]+$/i.test(value.hash)
      || typeof value.extName !== "string" || !/^(?:jpe?g|png|webp|gif|avif)$/i.test(value.extName)) return [];
    const size = (value.sizeInfo as { source?: unknown } | undefined)?.source;
    if (!Array.isArray(size) || size.length !== 2 || size.some((part) => !/^\d+$/.test(String(part)))) return [];
    const url = originalImageUrl(value.picSrc);
    return [{ url, locator: `script:picList[${index}]`, section: cleanText(String(value.className ?? value.name ?? "商品图")) }];
  });
  const images = [...new Map(candidates.map((item) => [item.url.href, item])).values()]
    .map((item, ordinal) => ({ url: item.url.href, locator: item.locator, section: item.section, ordinal }));
  if (images.length === 0) throw new Error(`型号 ${modelId} 大图页没有可验证的源站原图字段`);
  return images;
}

export function assertZolImageUrl(value: string) {
  const url = assertPublicHttpsUrl(value);
  if (!/(^|\.)zol-img\.com\.cn$/i.test(url.hostname)
    || !url.pathname.includes("/product/")
    || !/\.(?:jpe?g|png|webp|gif|avif)$/i.test(url.pathname)) {
    throw new Error(`不是 ZOL 商品图片 URL：${url.href}`);
  }
  return url;
}

function safePictureDetailUrl(value: string, base: string | undefined, modelId: string) {
  try {
    const url = assertPublicHttpsUrl(new URL(value, base).href);
    return url.origin === "https://detail.zol.com.cn"
      && new RegExp(`/picture_index_\\d+/index\\d+_\\d+_p${modelId}\\.shtml$`, "i").test(url.pathname)
      ? url : undefined;
  } catch { return undefined; }
}

function originalImageUrl(value: string) {
  const thumbnail = assertZolImageUrl(value);
  const pathname = thumbnail.pathname.replace(/(\/product\/\d+)_\d+x\d+(\/)/i, "$1$2");
  if (pathname === thumbnail.pathname) throw new Error(`ZOL picList 缩略图 URL 无法形成原图 URL：${value}`);
  // WHY：picList 同时声明 source 尺寸、图片哈希和变体 URL；去掉尺寸段是 ZOL 图片协议的原图地址。
  return assertZolImageUrl(new URL(pathname + thumbnail.search, thumbnail.origin).href);
}

function htmlText(response: RawPublicResponse) {
  const mediaType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") {
    throw new Error(`ZOL 页面返回了非 HTML 类型：${mediaType || "unknown"}`);
  }
  return decodeInlineText(response, mediaType).text;
}

function cleanText(value: string) { return value.replace(/\s+/g, " ").trim(); }
