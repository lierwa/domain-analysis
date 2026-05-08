import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("bullmq", () => ({
  Queue: vi.fn(),
  Worker: vi.fn()
}));

import { Queue, Worker } from "bullmq";
import { BullMqCrawlQueue, CRAWL_QUEUE_NAME, createCrawlWorker } from "./bullmqQueue";

const MockQueue = Queue as unknown as ReturnType<typeof vi.fn>;
const MockWorker = Worker as unknown as ReturnType<typeof vi.fn>;

describe("BullMqCrawlQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a BullMQ-compatible queue name", () => {
    // WHY: BullMQ uses ':' internally for Redis key prefixes, so queue names themselves cannot contain ':'.
    expect(CRAWL_QUEUE_NAME).toBe("domain-analysis-crawl");
    expect(CRAWL_QUEUE_NAME).not.toContain(":");
  });

  it("enqueues only lightweight crawl identifiers and cleans completed jobs", async () => {
    const add = vi.fn().mockResolvedValue({ id: "task_1" });
    MockQueue.mockImplementation(() => ({ add }));

    const queue = new BullMqCrawlQueue({ redisUrl: "redis://127.0.0.1:6379" });
    await queue.enqueueCrawlJob({ runId: "run_1", taskId: "task_1" });

    expect(add).toHaveBeenCalledWith(
      "crawl",
      { runId: "run_1", taskId: "task_1" },
      {
        jobId: "task_1",
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: 20
      }
    );
  });

  it("creates a single-concurrency worker for 2C2G servers", () => {
    MockWorker.mockImplementation(() => ({ close: vi.fn() }));
    const processor = vi.fn();

    createCrawlWorker({
      redisUrl: "redis://127.0.0.1:6379",
      processor
    });

    expect(MockWorker).toHaveBeenCalledWith(
      "domain-analysis-crawl",
      expect.any(Function),
      {
        connection: expect.objectContaining({ host: "127.0.0.1", port: 6379 }),
        concurrency: 1
      }
    );
  });
});
