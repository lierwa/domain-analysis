import { setTimeout as delay } from "node:timers/promises";

import type { SourceAccessPolicy } from "@domain-analysis/shared";
import {
  circuitBreaker,
  ConsecutiveBreaker,
  handleWhen,
} from "cockatiel";
import PQueue from "p-queue";

type PacedPolicy = Extract<SourceAccessPolicy, { kind: "paced_http" }>;
export type PacedAccessGateState = "idle" | "running" | "open" | "cancelled" | "expired";

export interface PacedAccessGate {
  schedule<T>(id: string, task: (signal: AbortSignal) => Promise<T>): Promise<T>;
  cancel(reason: string): void;
  onIdle(): Promise<void>;
  readonly state: PacedAccessGateState;
  readonly queued: number;
  readonly pending: number;
}

export interface PacedAccessGateOptions {
  shouldBreak?: (error: unknown) => boolean;
  random?: () => number;
  rateWindowMs?: number;
  testOnlyAllowScaledMinute?: boolean;
}

export class PacedAccessGateError extends Error {
  constructor(
    readonly code: "cancelled" | "maximum_run_exceeded" | "circuit_open",
    message: string,
  ) {
    super(message);
    this.name = "PacedAccessGateError";
  }
}

export function createPacedAccessGate(
  policy: PacedPolicy,
  options: PacedAccessGateOptions = {},
): PacedAccessGate {
  const rateWindowMs = options.rateWindowMs ?? 60_000;
  if (rateWindowMs !== 60_000 && !options.testOnlyAllowScaledMinute) {
    throw new Error("非一分钟频控窗口只允许本地测试夹具使用");
  }
  const controller = new AbortController();
  const queue = new PQueue({
    concurrency: 1,
    intervalCap: policy.maxRequestsPerMinute,
    // WHY：服务端到达时间会晚于客户端 dispatch；把最小间隔和最大抖动作为窗口安全余量，
    // 避免客户端刚好合规却在来源端形成边界突发。
    interval: rateWindowMs + policy.minimumIntervalMs + policy.jitterMs.max,
    strict: true,
  });
  const breaker = circuitBreaker(handleWhen(options.shouldBreak ?? (() => false)), {
    breaker: new ConsecutiveBreaker(1),
    // WHY：同一 gate 不做自动恢复；该时间覆盖整个运行窗口，恢复必须创建新的运行和 gate。
    halfOpenAfter: policy.maximumRunMs + policy.batchCooldownMs + 1,
  });
  const clock = createPaceClock(policy, options.random ?? Math.random);
  let state: PacedAccessGateState = "idle";
  let expiry: NodeJS.Timeout | undefined;

  breaker.onBreak(() => {
    state = "open";
    queue.pause();
  });
  queue.on("active", () => { if (!isTerminal(state)) state = "running"; });

  return {
    schedule<T>(id: string, task: (signal: AbortSignal) => Promise<T>) {
      if (isTerminal(state)) return Promise.reject(terminalError(state));
      if (!expiry) {
        expiry = setTimeout(() => {
          state = "expired";
          controller.abort(new PacedAccessGateError("maximum_run_exceeded", "来源运行超过最长窗口"));
        }, policy.maximumRunMs);
        expiry.unref();
      }
      const operation = queue.add(async ({ signal }) => {
        const taskSignal = signal ?? controller.signal;
        await clock.beforeStart(taskSignal);
        try {
          return await breaker.execute(({ signal: policySignal }) => task(policySignal), taskSignal);
        } finally {
          clock.afterFinish();
        }
      }, { id, signal: controller.signal });
      return operation.catch((error) => {
        // WHY：先让触发熔断的当前调用保留原始 typed error，再取消其余排队调用。
        if (state === "open" && !controller.signal.aborted) {
          controller.abort(new PacedAccessGateError("circuit_open", "来源访问已熔断"));
        }
        throw error;
      });
    },
    cancel(reason: string) {
      if (isTerminal(state)) return;
      state = "cancelled";
      controller.abort(new PacedAccessGateError("cancelled", reason));
    },
    async onIdle() {
      await queue.onIdle();
      if (expiry) clearTimeout(expiry);
      if (!isTerminal(state)) state = "idle";
    },
    get state() { return state; },
    get queued() { return queue.size; },
    get pending() { return queue.pending; },
  };
}

function createPaceClock(policy: PacedPolicy, random: () => number) {
  let lastFinishedAt: number | undefined;
  let finishedCount = 0;
  return {
    async beforeStart(signal: AbortSignal) {
      const now = Date.now();
      const jitter = randomInteger(policy.jitterMs.min, policy.jitterMs.max, random);
      // WHY：从上一请求完成后再计同域间隔，比仅按客户端 dispatch 起点更保守，
      // 也避免连接建立时间吞掉服务端实际观察到的安全间隔。
      const intervalDue = lastFinishedAt === undefined
        ? now
        : lastFinishedAt + policy.minimumIntervalMs + jitter;
      const cooldownDue = finishedCount > 0 && finishedCount % policy.batchSize === 0
        ? (lastFinishedAt ?? now) + policy.batchCooldownMs
        : now;
      const waitMs = Math.max(0, intervalDue - now, cooldownDue - now);
      if (waitMs > 0) await delay(waitMs, undefined, { signal });
    },
    afterFinish() {
      lastFinishedAt = Date.now();
      finishedCount += 1;
    },
  };
}

function randomInteger(minimum: number, maximum: number, random: () => number) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("随机源必须返回 [0, 1) 的有限数值");
  }
  return minimum + Math.floor(value * (maximum - minimum + 1));
}

function isTerminal(state: PacedAccessGateState) {
  return state === "open" || state === "cancelled" || state === "expired";
}

function terminalError(state: PacedAccessGateState) {
  if (state === "open") return new PacedAccessGateError("circuit_open", "来源访问已熔断");
  if (state === "expired") {
    return new PacedAccessGateError("maximum_run_exceeded", "来源运行超过最长窗口");
  }
  return new PacedAccessGateError("cancelled", "来源访问已取消");
}
