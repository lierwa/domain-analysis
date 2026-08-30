import { setTimeout as delay } from "node:timers/promises";

import {
  SourceProviderFailure,
  type CrawlPlanSource,
  type SourceRequestAdmissionPort,
} from "@domain-analysis/shared";
import pRetry from "p-retry";

import type { PublicRedirectEvent, RawPublicResponse } from "./publicResourceTransport";

export type PublicResourceRequest = (url: URL, maximumBytes: number, signal?: AbortSignal,
  onRedirect?: (event: PublicRedirectEvent) => Promise<void>) => Promise<RawPublicResponse>;

export async function requestPublicResourcePersistently(input: {
  source: CrawlPlanSource;
  runId: string;
  admission: SourceRequestAdmissionPort;
  targetKey: string;
  workKey: string;
  captureUnit: string;
  url: URL;
  maximumBytes: number;
  request: PublicResourceRequest;
  requestLane?: "asset";
  robotsPolicyRequest?: boolean;
  signal?: AbortSignal;
}) {
  const { source, runId, admission, targetKey, workKey } = input;
  await admission.ensureCaptureWorkItem({ runId, targetKey, workKey,
    captureUnit: input.captureUnit, expectedUnitCount: 1 });
  await admission.startCaptureWorkItem({ runId, workKey });
  try {
    // WHY：每次重试仍重新进入持久 admission，共享计划预算、频控与取消，不让库级 retry 绕开业务账本。
    const response = await pRetry(() => requestOneAttempt(input), {
      retries: 1,
      minTimeout: Math.max(10_000, requestPolicy(input).minimumIntervalMs),
      maxTimeout: Math.max(10_000, requestPolicy(input).minimumIntervalMs),
      factor: 1,
      randomize: false,
      ...(input.signal ? { signal: input.signal } : {}),
      shouldRetry: ({ error }) => isTransientPublicResourceFailure(error),
    });
    const restricted = restrictionReason(response.statusCode, input.robotsPolicyRequest);
    await admission.finishCaptureWorkItem({ runId, workKey,
      status: restricted ? "stopped" : response.statusCode >= 500 ? "failed" : "completed",
      observedUnitCount: restricted || response.statusCode >= 500 ? 0 : 1,
      ...(restricted ? { terminationReason: restricted } : response.statusCode >= 500
        ? { terminationReason: `HTTP ${response.statusCode}` } : {}) });
    return response;
  } catch (error) {
    await admission.finishCaptureWorkItem({ runId, workKey, status: "failed", observedUnitCount: 0,
      terminationReason: boundedFailure(error) }).catch(() => undefined);
    throw error;
  }
}

async function requestOneAttempt(input: Parameters<typeof requestPublicResourcePersistently>[0]) {
  const { source, runId, admission, targetKey, workKey, url } = input;
  let currentUrl = url;
  let attempt: Awaited<ReturnType<typeof reserveWhenEligible>> | undefined = await reserveWhenEligible(
    source, runId, admission, targetKey, workKey, currentUrl, input.signal, undefined, input.requestLane);
  let redirectParentAttemptId: string | undefined;
  try {
    const response = await input.request(url, input.maximumBytes, input.signal, async (event) => {
      if (event.type === "response") {
        if (!attempt) throw new Error("重定向响应找不到当前请求尝试");
        await admission.finishRequest({ attemptId: attempt.id, state: "completed",
          finalUrl: event.hop.fromUrl.href, httpStatus: event.hop.statusCode });
        redirectParentAttemptId = attempt.id;
        attempt = undefined;
        return;
      }
      currentUrl = event.toUrl;
      attempt = await reserveWhenEligible(source, runId, admission, targetKey, workKey,
        currentUrl, input.signal, redirectParentAttemptId, input.requestLane);
    });
    if (!attempt) throw new Error("重定向后没有预留最终请求尝试");
    const restricted = restrictionReason(response.statusCode, input.robotsPolicyRequest);
    await admission.finishRequest({ attemptId: attempt.id,
      state: restricted ? "restricted" : response.statusCode >= 500 ? "failed" : "completed",
      finalUrl: response.finalUrl ?? currentUrl.href,
      httpStatus: response.statusCode, bytes: response.body.byteLength,
      ...(restricted ? { restrictionReason: restricted } : {}) });
    attempt = undefined;
    if (isTransientStatus(response.statusCode)) {
      throw new TransientPublicResourceError(`来源暂时返回 HTTP ${response.statusCode}`);
    }
    return response;
  } catch (error) {
    if (attempt) await admission.finishRequest({ attemptId: attempt.id, state: "failed" })
      .catch(() => undefined);
    throw error;
  }
}

async function reserveWhenEligible(source: CrawlPlanSource, runId: string,
  admission: SourceRequestAdmissionPort, targetKey: string, workKey: string, url: URL,
  signal?: AbortSignal, redirectParentAttemptId?: string, requestLane?: "asset") {
  const policy = requestLane === "asset" ? source.accessPolicy.assetPolicy : source.accessPolicy;
  if (!policy) throw new Error("来源计划没有冻结图片请求策略");
  while (true) {
    const result = await admission.reserveRequest({ runId, targetKey, workKey,
      // WHY：来源特有 adapter 仍共享同一 origin gate，但 gate 身份必须跟随冻结的
      // Provider，避免 ZOL 请求被错误归入通用 Provider 的审计空间。
      gateKey: requestLane === "asset"
        ? `${source.provider.key}@${source.provider.version}:asset:${url.origin}`
        : `${source.provider.key}@${source.provider.version}:${url.origin}`,
      providerKey: source.provider.key, providerVersion: source.provider.version,
      policyVersion: source.accessPolicy.version,
      ...(requestLane ? { requestLane } : {}),
      requestedUrl: url.href, ...(redirectParentAttemptId ? { redirectParentAttemptId } : {}),
      minimumIntervalMs: policy.minimumIntervalMs,
      maxRequestsPerMinute: policy.maxRequestsPerMinute });
    if (result.status === "admitted") return result.attempt;
    if (result.status === "blocked") throw new Error(`持久请求 gate 阻止访问：${result.reason}`);
    const waitMs = Math.max(0, new Date(result.retryAt).getTime() - Date.now());
    if (waitMs > 0) await delay(waitMs, undefined, { signal });
  }
}

function requestPolicy(input: Parameters<typeof requestPublicResourcePersistently>[0]) {
  if (input.requestLane !== "asset") return input.source.accessPolicy;
  const policy = input.source.accessPolicy.assetPolicy;
  if (!policy) throw new Error("来源计划没有冻结图片请求策略");
  return policy;
}

function restrictionReason(status: number, robotsPolicyRequest = false) {
  // WHY：RFC 9309 把 robots.txt 的普通 4xx 定义为 unavailable；不能据此熔断同 origin 的实际资源。
  if (robotsPolicyRequest && status >= 400 && status <= 499 && status !== 429) return undefined;
  if (status === 429) return "rate_limited";
  if (status === 401) return "login_required";
  if (status === 403) return "access_denied";
  return undefined;
}

class TransientPublicResourceError extends SourceProviderFailure {
  constructor(message: string) { super("transient_transport", message); }
}

export function isTransientPublicResourceFailure(error: unknown) {
  if (error instanceof TransientPublicResourceError) return true;
  if (!(error instanceof Error)) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  if (code && new Set(["EAI_AGAIN", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EPIPE",
    "ERR_HTTP2_ERROR", "ERR_HTTP2_STREAM_ERROR", "UND_ERR_CONNECT_TIMEOUT"]).has(code)) return true;
  return /socket disconnected before secure TLS connection|HTTP\/2.*internal error|公共资源请求超时|可信 DoH 查询失败：DNS status 2|^(?:502|503|504)\s+-\s+/i
    .test(error.message);
}

function isTransientStatus(status: number) {
  return status === 502 || status === 503 || status === 504;
}

function boundedFailure(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}
