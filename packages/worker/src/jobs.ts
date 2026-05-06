import type { Platform } from "@domain-analysis/shared";
import { crawlCollectTimeoutMsOrNull } from "./envTimeouts";
import { createRedditAdapter } from "./adapters/reddit";
import type { CollectedRawContent, CollectionQuery } from "./adapters/types";
import { createXAdapter } from "./adapters/x";

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
  /** 来自 sources.crawlerType；Reddit 用于在 Playwright 与纯 HTTP 之间切换。 */
  sourceCrawlerType?: "cheerio" | "playwright";
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
    default:
      throw new Error(`unknown_job_kind:${(job as WorkerJob).kind}`);
  }
}

async function runCrawlJob(job: WorkerJob): Promise<JobResult> {
  const payload = parseCrawlPayload(job.payload);
  const adapter =
    payload.platform === "reddit"
      ? createRedditAdapter(process.env, payload.sourceCrawlerType)
      : createXAdapter();
  const collectCapMs = crawlCollectTimeoutMsOrNull();
  const items = await withCollectTimeout(adapter.collect(payload.query), collectCapMs, payload.platform);

  return {
    jobId: job.id,
    status: "success",
    message: `${payload.platform} collection completed`,
    items
  };
}

async function withCollectTimeout(
  work: Promise<CollectedRawContent[]>,
  msOrNull: number | null,
  platform: string
): Promise<CollectedRawContent[]> {
  if (msOrNull === null) {
    return work;
  }
  const ms = msOrNull;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`crawl_collect_timeout_after_${ms}ms:${platform}`)),
      ms
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function finishJob(job: WorkerJob, message: string): JobResult {
  return {
    jobId: job.id,
    status: "success",
    message
  };
}

function parseCrawlPayload(payload: Record<string, unknown>): CrawlJobPayload {
  if (payload.platform !== "reddit" && payload.platform !== "x") {
    throw new Error("unsupported_crawl_platform");
  }

  const query = payload.query as Partial<CollectionQuery> | undefined;
  if (!query || !Array.isArray(query.includeKeywords)) {
    throw new Error("invalid_crawl_query");
  }

  const sct = payload.sourceCrawlerType;
  const sourceCrawlerType =
    sct === "cheerio" || sct === "playwright" ? (sct as "cheerio" | "playwright") : undefined;

  return {
    platform: payload.platform,
    sourceCrawlerType,
    query: {
      name: String(query.name ?? ""),
      includeKeywords: query.includeKeywords,
      excludeKeywords: Array.isArray(query.excludeKeywords) ? query.excludeKeywords : [],
      language: String(query.language ?? "en"),
      limitPerRun: Number(query.limitPerRun ?? 50)
    }
  };
}
