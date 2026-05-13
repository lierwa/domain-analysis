import type { Platform } from "@domain-analysis/shared";
import type { TaskStatus } from "@domain-analysis/shared";
import { createRedditAdapter } from "./adapters/reddit";
import type { CollectionAdapter, CollectedRawContent, CollectionMetadata, CollectionQuery } from "./adapters/types";
import { createWebAdapter } from "./adapters/web";
import { createXAdapter } from "./adapters/x";
import { createYoutubeAdapter } from "./adapters/youtube";
import { ExternalCollectorError } from "./collectors/externalCollector";

export type JobKind = "crawl" | "clean" | "analyze" | "report";

export interface WorkerJob {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
}

export interface JobResult {
  jobId: string;
  status: "success";
  message: string;
  items?: CollectedRawContent[];
  metadata?: CollectionMetadata;
}

export interface CrawlJobPayload extends Record<string, unknown> {
  platform: Platform;
  query: CollectionQuery;
}

export async function runJob(job: WorkerJob): Promise<JobResult> {
  switch (job.kind) {
    case "crawl":
      return runCrawlJob(job);
    case "clean":
      return finishJob(job, "Cleaning placeholder completed");
    case "analyze":
      return finishJob(job, "AI analysis placeholder completed");
    case "report":
      return finishJob(job, "Report generation placeholder completed");
  }
}

async function runCrawlJob(job: WorkerJob): Promise<JobResult> {
  const payload = parseCrawlPayload(job.payload);
  const adapter = createAdapterForPlatform(payload.platform);
  const collection = normalizeCollectionResult(await adapter.collect(payload.query));

  return {
    jobId: job.id,
    status: "success",
    message: `${payload.platform} collection completed`,
    items: collection.items,
    metadata: collection.metadata
  };
}

function normalizeCollectionResult(collection: Awaited<ReturnType<CollectionAdapter["collect"]>>) {
  if (Array.isArray(collection)) return { items: collection };
  return collection;
}

export function createAdapterForPlatform(platform: Platform) {
  if (platform === "reddit") return createRedditAdapter();
  if (platform === "youtube") return createYoutubeAdapter();
  if (platform === "x") return createXAdapter();
  if (platform === "web") return createWebAdapter();
  throw new Error("unsupported_crawl_platform");
}

export function mapCollectionErrorToTaskStatus(error: unknown): TaskStatus {
  if (error instanceof ExternalCollectorError) {
    return error.code;
  }
  return "failed";
}

function finishJob(job: WorkerJob, message: string): JobResult {
  return {
    jobId: job.id,
    status: "success",
    message
  };
}

function parseCrawlPayload(payload: Record<string, unknown>): CrawlJobPayload {
  if (payload.platform !== "reddit" && payload.platform !== "x" && payload.platform !== "youtube" && payload.platform !== "web") {
    throw new Error("unsupported_crawl_platform");
  }

  const query = payload.query as Partial<CollectionQuery> | undefined;
  if (!query || !Array.isArray(query.includeKeywords)) {
    throw new Error("invalid_crawl_query");
  }

  return {
    platform: payload.platform,
    query: {
      name: String(query.name ?? ""),
      includeKeywords: query.includeKeywords,
      excludeKeywords: Array.isArray(query.excludeKeywords) ? query.excludeKeywords : [],
      language: String(query.language ?? "en"),
      limitPerRun: Number(query.limitPerRun ?? 50)
    }
  };
}
