import type { Platform } from "@domain-analysis/shared";
import type { CollectedRawContent, CollectionQuery } from "./adapters/types";
import { createBrowserCollectionAdapter } from "./adapters/browserRegistry";

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
  const adapter = createBrowserCollectionAdapter(payload.platform);
  const items = await adapter.collect(payload.query);

  return {
    jobId: job.id,
    status: "success",
    message: `${payload.platform} collection completed`,
    items
  };
}

function finishJob(job: WorkerJob, message: string): JobResult {
  return {
    jobId: job.id,
    status: "success",
    message
  };
}

function parseCrawlPayload(payload: Record<string, unknown>): CrawlJobPayload {
  if (payload.platform !== "reddit" && payload.platform !== "x" && payload.platform !== "youtube") {
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
