import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RequestQueue } from "@crawlee/core";
import { MemoryStorage } from "@crawlee/memory-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  createEphemeralCrawleeConfiguration,
  createPersistentCrawleeConfiguration,
  openPersistentRequestQueue,
} from "../src/ephemeralCrawleeConfiguration";

describe("ephemeral Crawlee configuration", () => {
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  });

  it("为每次来源访问分配独立内存存储，不复用默认持久请求队列", async () => {
    const first = createEphemeralCrawleeConfiguration();
    const second = createEphemeralCrawleeConfiguration();

    expect(first.getStorageClient()).toBeInstanceOf(MemoryStorage);
    expect(second.getStorageClient()).toBeInstanceOf(MemoryStorage);
    expect(first.getStorageClient()).not.toBe(second.getStorageClient());

    await first.getStorageClient().teardown?.();
    await second.getStorageClient().teardown?.();
  });

  it("命名队列跨 storage 实例保留成功 uniqueKey 与未完成工作", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "domain-analysis-crawlee-"));
    const first = createPersistentCrawleeConfiguration(temporaryDirectory);
    const firstQueue = await openPersistentRequestQueue("catalog-run-1", first, 1);
    await firstQueue.addRequest({ url: "https://fixture.invalid/catalog", uniqueKey: "catalog:1" });
    await firstQueue.addRequest({ url: "https://fixture.invalid/detail/1", uniqueKey: "detail:1" });
    const completed = await firstQueue.fetchNextRequest();
    if (!completed) throw new Error("缺少首个工作项");
    await firstQueue.markRequestHandled(completed);
    await first.getStorageClient().teardown?.();

    const restarted = createPersistentCrawleeConfiguration(temporaryDirectory);
    const restartedQueue = await openPersistentRequestQueue("catalog-run-1", restarted, 1);
    const duplicate = await restartedQueue.addRequest({
      url: "https://fixture.invalid/catalog", uniqueKey: "catalog:1",
    });
    expect(await restartedQueue.fetchNextRequest()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const remaining = await fetchNextEventually(restartedQueue);

    expect(duplicate.wasAlreadyHandled).toBe(true);
    expect(remaining?.uniqueKey).toBe("detail:1");
    await restarted.getStorageClient().teardown?.();
  });
});

async function fetchNextEventually(queue: RequestQueue) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const request = await queue.fetchNextRequest();
    if (request) return request;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}
