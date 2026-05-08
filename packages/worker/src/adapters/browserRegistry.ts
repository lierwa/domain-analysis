import type { Platform } from "@domain-analysis/shared";
import type {
  BrowserCollectionContext,
  CollectionAdapter,
  CollectionQuery,
  PaginatedCollectionResult
} from "./types";
import { createRedditBrowserAdapter } from "./browser/redditBrowser";
import { createXBrowserAdapter } from "./browser/xBrowser";
import { createYouTubeBrowserAdapter } from "./browser/youtubeBrowser";

export type BrowserCollectionAdapter = CollectionAdapter & {
  collectPaginated(query: CollectionQuery): Promise<PaginatedCollectionResult>;
};

export const supportedBrowserPlatforms = ["reddit", "youtube", "x"] as const;

export function createBrowserCollectionAdapter(
  platform: Platform,
  context?: Partial<BrowserCollectionContext>
): BrowserCollectionAdapter {
  if (platform === "reddit") return createRedditBrowserAdapter(undefined, context);
  if (platform === "youtube") return createYouTubeBrowserAdapter(undefined, context);
  if (platform === "x") return createXBrowserAdapter(undefined, context);
  throw new Error(`unsupported_browser_platform_${platform}`);
}
