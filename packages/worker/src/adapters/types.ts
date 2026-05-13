import type { Platform } from "@domain-analysis/shared";

export type CollectionMode =
  | "official_api"
  | "public_json_fallback"
  | "yt_dlp"
  | "transcript"
  | "twscrape"
  | "twikit"
  | "playwright_search";

export interface CollectionQuery {
  name: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  language: string;
  limitPerRun: number;
  targetUrls?: string[];
  accountHandles?: string[];
  channelUrls?: string[];
  since?: string;
  until?: string;
}

export interface CollectedRawContent {
  platform: Platform;
  externalId?: string;
  url: string;
  authorName?: string;
  authorHandle?: string;
  text: string;
  mediaUrls?: string[];
  metricsJson?: Record<string, unknown>;
  publishedAt?: string;
  rawJson?: Record<string, unknown>;
}

export type CollectionStopReason =
  | "target_reached"
  | "scroll_exhausted"
  | "blocked_or_login";

export interface CollectionMetadata {
  pagesCollected?: number;
  stopReason?: CollectionStopReason | string;
}

export interface CollectionResult {
  items: CollectedRawContent[];
  metadata?: CollectionMetadata;
}

export interface CollectionAdapter {
  collect(query: CollectionQuery): Promise<CollectedRawContent[] | CollectionResult>;
}

export interface ConservativeCrawlerOptions {
  maxConcurrency: number;
  maxRequestsPerMinute: number;
  sameDomainDelaySecs: number;
  maxRequestRetries: number;
}

export type BrowserMode = "none" | "headless" | "local_profile";

export interface SourceCollectionPolicy {
  browserMode: BrowserMode;
  respectRobotsTxt: boolean;
  maxConcurrency: number;
  maxRequestsPerMinute: number;
  maxRequestRetries: number;
  sameDomainDelaySecs: number;
}

export const defaultConservativeSourcePolicy: SourceCollectionPolicy = {
  browserMode: "local_profile",
  respectRobotsTxt: true,
  maxConcurrency: 1,
  maxRequestsPerMinute: 6,
  maxRequestRetries: 1,
  sameDomainDelaySecs: 10
};

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
