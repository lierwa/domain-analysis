import { afterEach, describe, expect, it, vi } from "vitest";

import { createZolImageDownloadQueue } from "../src/zolImageDownloadQueue";

describe("ZOL 图片下载队列", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("独立按两秒启动任务，并保留任务携带的来源 ordinal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T00:00:00.000Z"));
    const starts: number[] = [];
    const queue = createZolImageDownloadQueue<{ ordinal: number }>({ concurrency: 2,
      queueCapacity: 10, minimumIntervalMs: 2_000, maxRequestsPerMinute: 30,
      signal: new AbortController().signal });

    for (const ordinal of [7, 3, 9]) {
      await queue.enqueue(async () => { starts.push(Date.now()); return { ordinal }; });
    }
    const draining = queue.drain();
    // 固定窗口内部使用递归 interval；只推进覆盖三项启动的时间，避免测试框架把周期 timer 当成无限任务。
    await vi.advanceTimersByTimeAsync(4_000);
    const results = await draining;
    await queue.close();

    expect(starts.slice(1).map((at, index) => at - starts[index]!)).toEqual([2_000, 2_000]);
    expect(results.filter((result) => result.status === "fulfilled")
      .map((result) => result.status === "fulfilled" ? result.value.ordinal : -1)).toEqual([7, 3, 9]);
  });

  it("生产者超过容量时持续背压并最终排空，不进入忙循环", async () => {
    const queue = createZolImageDownloadQueue<number>({ concurrency: 2,
      queueCapacity: 10, minimumIntervalMs: 1, maxRequestsPerMinute: 60_000,
      signal: new AbortController().signal });
    const observed: number[] = [];

    for (let ordinal = 0; ordinal < 120; ordinal += 1) {
      const ready = await queue.enqueue(async () => ordinal);
      observed.push(...ready.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
    }
    const remaining = await queue.drain();
    observed.push(...remaining.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
    await queue.close();

    expect(observed).toHaveLength(120);
    expect(new Set(observed).size).toBe(120);
  }, 10_000);

  it("关闭时中止并等待真实下载任务完成清理", async () => {
    const queue = createZolImageDownloadQueue<number>({ concurrency: 1,
      queueCapacity: 1, minimumIntervalMs: 1, maxRequestsPerMinute: 60_000,
      signal: new AbortController().signal });
    let started = false;
    let cleaned = false;
    const enqueued = queue.enqueue(async (signal) => {
      started = true;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      await Promise.resolve();
      cleaned = true;
      throw signal.reason;
    });
    while (!started) await Promise.resolve();

    await queue.close(new Error("测试关闭"));
    const queued = await enqueued;

    expect(cleaned).toBe(true);
    expect(queued).toEqual([]);
  });
});
