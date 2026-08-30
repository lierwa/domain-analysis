import PQueue from "p-queue";

type Settled<T> = { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown };

export function createZolImageDownloadQueue<T>(input: {
  concurrency: number;
  queueCapacity: number;
  minimumIntervalMs: number;
  maxRequestsPerMinute: number;
  signal: AbortSignal;
}) {
  const stop = new AbortController();
  const signal = AbortSignal.any([input.signal, stop.signal]);
  const ready: Settled<T>[] = [];
  const waiters: Array<() => void> = [];
  const activeTasks = new Set<Promise<T>>();
  let outstanding = 0;
  const interval = Math.max(input.minimumIntervalMs, Math.ceil(60_000 / input.maxRequestsPerMinute));
  const queue = new PQueue({ concurrency: input.concurrency,
    intervalCap: 1, interval, strict: true });

  const takeReady = () => {
    const values = ready.splice(0);
    outstanding -= values.length;
    return values;
  };
  const waitForReady = async () => {
    if (ready.length > 0) return;
    await new Promise<void>((resolve) => waiters.push(resolve));
  };
  const settle = (result: Settled<T>) => {
    ready.push(result);
    waiters.splice(0).forEach((resolve) => resolve());
  };

  return {
    async enqueue(task: (signal: AbortSignal) => Promise<T>) {
      const completed: Settled<T>[] = [];
      // WHY：达到容量后必须在等待循环内消费 ready 并减少 outstanding；只等待不消费会同步忙循环。
      while (outstanding >= input.queueCapacity) {
        await waitForReady();
        completed.push(...takeReady());
      }
      completed.push(...takeReady());
      outstanding += 1;
      // WHY：下载完成顺序只决定事件何时落库；事件内冻结的 source ordinal 才决定来源顺序。
      void queue.add(() => {
        const running = task(signal);
        activeTasks.add(running);
        void running.finally(() => activeTasks.delete(running)).catch(() => undefined);
        return running;
      }, { signal }).then(
        (value) => settle({ status: "fulfilled", value: value! }),
        (reason) => settle({ status: "rejected", reason }),
      );
      return completed;
    },
    takeReady,
    async drain() {
      const values: Settled<T>[] = [];
      while (outstanding > 0) {
        await waitForReady();
        values.push(...takeReady());
      }
      return values;
    },
    async close(reason?: unknown) {
      if (!stop.signal.aborted) stop.abort(reason ?? new Error("ZOL 图片队列关闭"));
      await queue.onIdle();
      // WHY：p-queue 的 add promise 可在 abort 时先拒绝；必须继续等真正下载任务响应 abort，
      // 否则 Source Run 会先终态化，而请求账本和 work item 仍在后台写入。
      while (activeTasks.size > 0) await Promise.allSettled([...activeTasks]);
    },
  };
}
