import type { Platform } from "@domain-analysis/shared";

export type CollectionMode = "official_api" | "public_json" | "nitter_rss";

export interface CollectionQuery {
  name: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  language: string;
  limitPerRun: number;
}

export interface CollectedRawContent {
  platform: Platform;
  externalId?: string;
  url: string;
  authorName?: string;
  authorHandle?: string;
  text: string;
  metricsJson?: Record<string, unknown>;
  publishedAt?: string;
  rawJson?: Record<string, unknown>;
}

export interface CollectionAdapter {
  collect(query: CollectionQuery): Promise<CollectedRawContent[]>;
}

export interface ConservativeCrawlerOptions {
  maxConcurrency: number;
  maxRequestsPerMinute: number;
  sameDomainDelaySecs: number;
  maxRequestRetries: number;
}

export const conservativeHttpCrawlerOptions: ConservativeCrawlerOptions = {
  maxConcurrency: 1,
  maxRequestsPerMinute: 6,
  sameDomainDelaySecs: 10,
  maxRequestRetries: 1
};

export function hasExcludedKeyword(text: string, excludeKeywords: string[]) {
  const lowerText = text.toLowerCase();
  return excludeKeywords.some((keyword) => lowerText.includes(keyword.toLowerCase()));
}

export function buildKeywordQuery(includeKeywords: string[], excludeKeywords: string[]) {
  const include = includeKeywords.map((keyword) => `"${keyword}"`).join(" OR ");
  const exclude = excludeKeywords.map((keyword) => `-"${keyword}"`).join(" ");
  return [include, exclude].filter(Boolean).join(" ").trim();
}
