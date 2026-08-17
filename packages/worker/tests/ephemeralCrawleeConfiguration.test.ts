import { MemoryStorage } from "@crawlee/memory-storage";
import { describe, expect, it } from "vitest";

import { createEphemeralCrawleeConfiguration } from "../src/ephemeralCrawleeConfiguration";

describe("ephemeral Crawlee configuration", () => {
  it("为每次来源访问分配独立内存存储，不复用默认持久请求队列", async () => {
    const first = createEphemeralCrawleeConfiguration();
    const second = createEphemeralCrawleeConfiguration();

    expect(first.getStorageClient()).toBeInstanceOf(MemoryStorage);
    expect(second.getStorageClient()).toBeInstanceOf(MemoryStorage);
    expect(first.getStorageClient()).not.toBe(second.getStorageClient());

    await first.getStorageClient().teardown?.();
    await second.getStorageClient().teardown?.();
  });
});
