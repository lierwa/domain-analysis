import { Queue, Worker, type JobsOptions } from "bullmq";

export const CRAWL_QUEUE_NAME = "domain-analysis-crawl";

export interface CrawlQueueJobData {
  runId: string;
  taskId: string;
}

export interface BullMqQueueOptions {
  redisUrl: string;
}

export interface CrawlJobQueue {
  enqueueCrawlJob(data: CrawlQueueJobData): Promise<void>;
}

const crawlJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2_000 },
  // WHY: Redis 只承担轻量调度，不保存正文内容；完成即清理，适配 2C2G 服务器内存约束。
  removeOnComplete: true,
  removeOnFail: 20
};

export class BullMqCrawlQueue implements CrawlJobQueue {
  private readonly queue: Queue<CrawlQueueJobData>;

  constructor(options: BullMqQueueOptions) {
    this.queue = new Queue<CrawlQueueJobData>(CRAWL_QUEUE_NAME, {
      connection: parseRedisUrl(options.redisUrl)
    });
  }

  async enqueueCrawlJob(data: CrawlQueueJobData) {
    await this.queue.add("crawl", data, {
      jobId: data.taskId,
      ...crawlJobOptions
    });
  }
}

export function createCrawlWorker(options: {
  redisUrl: string;
  processor: (data: CrawlQueueJobData) => Promise<void>;
  concurrency?: number;
}) {
  return new Worker<CrawlQueueJobData>(
    CRAWL_QUEUE_NAME,
    async (job) => options.processor(job.data),
    {
      connection: parseRedisUrl(options.redisUrl),
      // WHY: 默认单并发是当前 2C2G 部署边界，避免多个分页抓取同时打爆内存和目标站点。
      concurrency: options.concurrency ?? 1
    }
  );
}

export function parseRedisUrl(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname ? Number(url.pathname.slice(1) || 0) : 0
  };
}
