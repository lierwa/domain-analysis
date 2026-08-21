import type { SourceProviderResourceReference } from "@domain-analysis/shared";
import * as cheerio from "cheerio";

export interface JdCatalogProductLink {
  externalKey: string;
  detailUrl: string;
}

export function parseJdCatalogHtml(html: string, baseUrl: string): JdCatalogProductLink[] {
  const $ = cheerio.load(html);
  const products = new Map<string, JdCatalogProductLink>();
  $("a[href]").each((_index, element) => {
    const observed = $(element).attr("href");
    if (!observed) return;
    const parsed = productLink(observed, baseUrl);
    if (parsed && !products.has(parsed.externalKey)) products.set(parsed.externalKey, parsed);
  });
  return [...products.values()];
}

export function parseJdCatalogImageReferences(
  html: string,
  baseUrl: string,
): SourceProviderResourceReference[] {
  const $ = cheerio.load(html);
  const references: SourceProviderResourceReference[] = [];
  $("#J_goodsList li.gl-item[data-sku]").each((_productIndex, productElement) => {
    const product = $(productElement);
    const sku = product.attr("data-sku")?.trim();
    if (!sku) return;
    let ordinal = 0;
    for (const region of [{ selector: ".p-img", locator: ".p-img" },
      { selector: ".p-scroll", locator: ".p-scroll" }]) {
      product.find(`${region.selector} img`).each((imageIndex, imageElement) => {
        const candidate = imageCandidate($(imageElement));
        if (!candidate) return;
        const sourceUrl = absoluteImageUrl(candidate.url, baseUrl);
        if (!sourceUrl) return;
        references.push({ kind: "image", sourceUrl, observedValue: candidate.observedValue,
          locator: `#J_goodsList li[data-sku="${sku}"] ${region.locator} img:nth-of-type(${imageIndex + 1})@${candidate.attribute}`,
          role: "primary", section: `product:${sku}`, ordinal });
        ordinal += 1;
      });
    }
  });
  return references;
}

function productLink(observed: string, baseUrl: string): JdCatalogProductLink | null {
  try {
    const url = new URL(observed, baseUrl);
    const match = /^\/(\d+)\.html$/.exec(url.pathname);
    if (url.protocol !== "https:" || url.hostname !== "item.jd.com" || !match) return null;
    url.hash = "";
    return { externalKey: match[1]!, detailUrl: url.href };
  } catch {
    return null;
  }
}

function imageCandidate(image: { attr(name: string): string | undefined }) {
  for (const attribute of ["data-lazy-img", "data-src", "src"] as const) {
    const observedValue = image.attr(attribute)?.trim();
    // WHY：目录卡可能同时带占位 src 与真实懒加载地址；只保留优先级最高的源站观察值，
    // 避免把透明占位图伪装成商品图片，同时不发起任何图片请求。
    if (observedValue) return { url: observedValue, observedValue, attribute };
  }
  return undefined;
}

function absoluteImageUrl(observed: string, baseUrl: string) {
  try {
    const url = new URL(observed, baseUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
