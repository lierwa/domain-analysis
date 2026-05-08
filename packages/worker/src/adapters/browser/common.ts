import { load } from "cheerio";
import type { AnyNode, CheerioAPI } from "cheerio";
import type { BrowserCollectionContext, CollectedRawContent } from "../types";

interface BrowserPageViewport {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  keyboard?: {
    press(key: string): Promise<void>;
  };
}

export function createHtmlParser(html: string) {
  return load(html);
}

export function absoluteUrl(href: string | undefined, baseUrl: string) {
  if (!href) return baseUrl;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

export function hasAnyKeyword(text: string, keywords: string[]) {
  const lower = text.toLowerCase();
  return keywords.length === 0 || keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

export function hasExcludedKeyword(text: string, excludeKeywords: string[]) {
  const lower = text.toLowerCase();
  return excludeKeywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

export function numberFromText(text: string) {
  const value = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)([KkMm])?/);
  if (!value) return 0;
  const base = Number(value[1] ?? 0);
  const suffix = value[2]?.toLowerCase();
  if (suffix === "k") return Math.round(base * 1_000);
  if (suffix === "m") return Math.round(base * 1_000_000);
  return Math.round(base);
}

export function uniqueByUrl(items: CollectedRawContent[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.externalId ? `${item.platform}:${item.externalId}` : `${item.platform}:${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function textOf($: CheerioAPI, node: AnyNode, selector: string) {
  return $(node).find(selector).first().text().replace(/\s+/g, " ").trim();
}

export async function prepareBrowserPage(page: BrowserPageViewport, context: BrowserCollectionContext) {
  if (context.browserMode === "headless") {
    await page.setViewportSize({ width: 1600, height: 1100 });
    return;
  }

  // WHY: local_profile 复用用户浏览器状态，也可能复用旧缩放比例；重置缩放优先保证人工登录可操作。
  const zoomResetShortcut = process.platform === "darwin" ? "Meta+0" : "Control+0";
  await page.keyboard?.press(zoomResetShortcut).catch(() => undefined);
}
