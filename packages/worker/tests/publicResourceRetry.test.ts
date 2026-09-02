import type {
  CrawlPlanSource,
  SourceCaptureWorkItem,
  SourceRequestAdmission,
  SourceRequestAdmissionPort,
  SourceRequestAttempt,
} from "@domain-analysis/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RawPublicResponse } from "../src/publicResourceTransport";
import { requestPublicResourcePersistently } from "../src/publicResourceRetry";

describe("公开资源持久请求", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("显式启用时把首次 404 复核为成功，并分别记录两次尝试", async () => {
    vi.useFakeTimers();
    const admission = createAdmission();
    const request = vi.fn()
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200));

    const resultPromise = requestPublicResourcePersistently(requestInput(admission, request, {
      retryNotFoundOnce: true,
    }));
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toMatchObject({ statusCode: 200 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(admission.attempts.map((attempt) => attempt.httpStatus)).toEqual([404, 200]);
    expect(admission.finishedWorkItems.at(-1)).toMatchObject({ status: "completed", observedUnitCount: 1 });
  });

  it("持续 404 最多请求两次，并把最终响应交还 Provider", async () => {
    vi.useFakeTimers();
    const admission = createAdmission();
    const request = vi.fn().mockResolvedValue(response(404));

    const resultPromise = requestPublicResourcePersistently(requestInput(admission, request, {
      retryNotFoundOnce: true,
    }));
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toMatchObject({ statusCode: 404 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(admission.attempts.map((attempt) => attempt.httpStatus)).toEqual([404, 404]);
    expect(admission.finishedWorkItems.at(-1)).toMatchObject({ status: "completed", observedUnitCount: 1 });
  });

  it("普通公开来源未显式启用时不复核 404", async () => {
    const admission = createAdmission();
    const request = vi.fn().mockResolvedValue(response(404));

    await expect(requestPublicResourcePersistently(requestInput(admission, request)))
      .resolves.toMatchObject({ statusCode: 404 });

    expect(request).toHaveBeenCalledOnce();
    expect(admission.attempts).toHaveLength(1);
  });

  it("403 保持访问限制停止门且不参与 404 复核", async () => {
    const admission = createAdmission();
    const request = vi.fn().mockResolvedValue(response(403));

    await expect(requestPublicResourcePersistently(requestInput(admission, request, {
      retryNotFoundOnce: true,
    }))).resolves.toMatchObject({ statusCode: 403 });

    expect(request).toHaveBeenCalledOnce();
    expect(admission.finishedWorkItems.at(-1)).toMatchObject({
      status: "stopped", terminationReason: "access_denied",
    });
  });

  it("404 复核仍重新进入 gate，预算拒绝时不发出第二次 HTTP 请求", async () => {
    vi.useFakeTimers();
    const admission = createAdmission({ blockAfterReservations: 1 });
    const request = vi.fn().mockResolvedValue(response(404));

    const resultPromise = requestPublicResourcePersistently(requestInput(admission, request, {
      retryNotFoundOnce: true,
    }));
    const rejected = expect(resultPromise).rejects.toThrow("request_budget_exhausted");
    await vi.runAllTimersAsync();

    await rejected;
    expect(admission.reservationCount()).toBe(2);
    expect(request).toHaveBeenCalledOnce();
    expect(admission.finishedWorkItems.at(-1)).toMatchObject({ status: "failed", observedUnitCount: 0 });
  });

  it("等待复核期间收到取消信号时不发出第二次 HTTP 请求", async () => {
    vi.useFakeTimers();
    const admission = createAdmission();
    const request = vi.fn().mockResolvedValue(response(404));
    const controller = new AbortController();

    const resultPromise = requestPublicResourcePersistently(requestInput(admission, request, {
      retryNotFoundOnce: true,
      signal: controller.signal,
    }));
    const rejected = expect(resultPromise).rejects.toThrow("负责人取消");
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("负责人取消"));
    await vi.runAllTimersAsync();

    await rejected;
    expect(request).toHaveBeenCalledOnce();
  });
});

function requestInput(admission: ReturnType<typeof createAdmission>,
  request: (url: URL, maximumBytes: number, signal?: AbortSignal) => Promise<RawPublicResponse>,
  overrides: { retryNotFoundOnce?: boolean; signal?: AbortSignal } = {}) {
  return {
    source: source(),
    runId: "run-retry",
    admission,
    targetKey: "target-retry",
    workKey: "page:retry",
    captureUnit: "html_page",
    resourceKind: "page" as SourceCaptureWorkItem["resourceKind"],
    url: new URL("https://detail.zol.com.cn/101/100191/param.shtml"),
    maximumBytes: 1_000_000,
    request,
    ...overrides,
  };
}

function response(statusCode: number): RawPublicResponse {
  return { statusCode, headers: { "content-type": "text/html" },
    body: new TextEncoder().encode(`<html>${statusCode}</html>`),
    finalUrl: "https://detail.zol.com.cn/101/100191/param.shtml" };
}

function createAdmission(options: { blockAfterReservations?: number } = {}) {
  const attempts: SourceRequestAttempt[] = [];
  const finishedWorkItems: Array<{ status: string; observedUnitCount: number; terminationReason?: string }> = [];
  let reservations = 0;
  const admission: SourceRequestAdmissionPort & {
    attempts: SourceRequestAttempt[];
    finishedWorkItems: typeof finishedWorkItems;
    reservationCount(): number;
  } = {
    attempts,
    finishedWorkItems,
    reservationCount: () => reservations,
    async ensureCaptureWorkItem() { return undefined as never; },
    async startCaptureWorkItem() { return undefined as never; },
    async finishCaptureWorkItem(input) {
      finishedWorkItems.push({ status: input.status, observedUnitCount: input.observedUnitCount,
        ...(input.terminationReason ? { terminationReason: input.terminationReason } : {}) });
      return undefined as never;
    },
    async reserveRequest(input): Promise<SourceRequestAdmission> {
      reservations += 1;
      if (options.blockAfterReservations != null && reservations > options.blockAfterReservations) {
        return { status: "blocked", reason: "request_budget_exhausted", manualResumeRequired: false };
      }
      const attempt = { id: `attempt-${attempts.length + 1}`, runId: input.runId,
        targetKey: input.targetKey, workKey: input.workKey, gateKey: input.gateKey,
        requestedUrl: input.requestedUrl, origin: `${new URL(input.requestedUrl).origin}/`,
        startedAt: "2026-09-02T00:00:00.000Z", state: "started" as const } satisfies SourceRequestAttempt;
      attempts.push(attempt);
      return { status: "admitted", attempt };
    },
    async finishRequest(input) {
      const attempt = attempts.find((item) => item.id === input.attemptId)!;
      Object.assign(attempt, input);
      return attempt;
    },
    async getAccessGate() { return null; },
  };
  return admission;
}

function source(): CrawlPlanSource {
  return {
    key: "zol.retry-test",
    name: "ZOL 404 复核测试",
    publisher: "ZOL 中关村在线",
    sourceKind: "other",
    sourceCandidateIds: [],
    role: "来源复核",
    entryUrls: ["https://detail.zol.com.cn/101/100191/param.shtml"],
    provider: { key: "zol.catalog-gallery", version: "1.2.0", configuration: [] },
    accessPolicy: { kind: "paced_http", version: "zol-catalog-gallery-v2",
      maxRequestsPerMinute: 12, minimumIntervalMs: 5_000, maximumRunMs: 60_000,
      assetPolicy: { maxRequestsPerMinute: 30, minimumIntervalMs: 2_000,
        concurrency: 2, queueCapacity: 10 } },
    stopPolicy: { requestBudget: 10, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
    rawOutputPolicy: { formats: ["html"], retainAssets: false },
    observationLevel: "search_discovered",
    accessState: "public",
    observedAt: "2026-09-02T00:00:00.000Z",
    targets: [{ key: "target-retry", name: "HTML 页面", taskTopics: ["参数"],
      captureUnit: "一个 HTML 页面", rawFormats: ["HTML"],
      quantity: { mode: "target_count", targetCount: 1, unit: "页面",
        denominator: "一个 exact URL", rationale: "验证一次有界复核" },
      uniqueKey: "exact URL", traversal: "直接请求", stopCondition: "限制或预算耗尽停止",
      providerConfiguration: [] }],
    executionBlockers: [],
  };
}
