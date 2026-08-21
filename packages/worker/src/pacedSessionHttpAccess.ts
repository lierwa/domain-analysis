import { setTimeout as delay } from "node:timers/promises";

import type {
  SourceAccessPolicy,
  SourceRequestAdmission,
  SourceRequestAdmissionPort,
  SourceRequestAttempt,
} from "@domain-analysis/shared";
import type { APIRequestContext } from "playwright-core";

import {
  createPacedAccessGate,
  type PacedAccessGateOptions,
  type PacedAccessGateState,
} from "./pacedAccessGate";
import { SourceAccessError } from "./sourceAccessError";

type PacedPolicy = Extract<SourceAccessPolicy, { kind: "paced_http" }>;

export interface SessionHttpRequestObservation {
  attemptId: string;
  url: string;
  status: number;
  startedAt: string;
  finishedAt: string;
}

export interface SessionHttpResult {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  requests: SessionHttpRequestObservation[];
}

export interface PacedSessionHttpAccess {
  get(url: string, work: { targetKey: string; workKey: string }, signal?: AbortSignal): Promise<SessionHttpResult>;
  cancel(reason: string): void;
  onIdle(): Promise<void>;
  close?(): Promise<void>;
  readonly state: PacedAccessGateState;
}

export interface PacedSessionHttpAccessOptions {
  maximumBytes: number;
  requestTimeoutMs: number;
  allowedOrigins: string[];
  admission: Pick<SourceRequestAdmissionPort, "reserveRequest" | "finishRequest">;
  runId: string;
  gateKey: string;
  providerKey: string;
  providerVersion: string;
  responseRestriction?: (response: { url: string; status: number;
    headers: Record<string, string>; body: Buffer }) => SourceAccessError | undefined;
  rateGateOptions?: PacedAccessGateOptions;
}

type SessionHttpStep = {
  observation: SessionHttpRequestObservation;
  redirectUrl: string;
} | {
  observation: SessionHttpRequestObservation;
  final: Omit<SessionHttpResult, "requests">;
};

export function createPacedSessionHttpAccess(
  requestContext: Pick<APIRequestContext, "fetch">,
  policy: PacedPolicy,
  options: PacedSessionHttpAccessOptions,
): PacedSessionHttpAccess {
  validateOptions(options);
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
  const gate = createPacedAccessGate(policy, {
    ...options.rateGateOptions,
    shouldBreak: (error) => error instanceof SourceAccessError,
  });
  let requestOrdinal = 0;

  return {
    async get(initialUrl, work, signal) {
      const observations: SessionHttpRequestObservation[] = [];
      let currentUrl = requireAllowedUrl(initialUrl, allowedOrigins);
      let redirectParentAttemptId: string | undefined;
      const abort = () => gate.cancel("operator_cancelled");
      signal?.addEventListener("abort", abort, { once: true });
      try {
        while (true) {
          requestOrdinal += 1;
          const ordinal = requestOrdinal;
          const result = await gate.schedule<SessionHttpStep>(`session-http-${ordinal}`, async (gateSignal) => {
            const attempt = await reserveWhenEligible(options, policy, work, currentUrl.href,
              redirectParentAttemptId, gateSignal);
            let recorded = false;
            const finish = async (input: Parameters<SourceRequestAdmissionPort["finishRequest"]>[0]) => {
              recorded = true;
              await persistFinish(options.admission, input);
            };
            try {
              const response = await requestContext.fetch(currentUrl.href, {
                method: "GET",
                failOnStatusCode: false,
                maxRedirects: 0,
                signal: gateSignal,
                timeout: options.requestTimeoutMs,
              });
              try {
              const status = response.status();
              const headers = response.headers();
              const restriction = restrictionForStatus(status);
              if (restriction) {
                await finish({ attemptId: attempt.id, state: "restricted", finalUrl: currentUrl.href,
                  httpStatus: status, bytes: 0, restrictionReason: restriction.code });
                throw restriction;
              }
              if (status < 200 || status >= 400) {
                await finish({ attemptId: attempt.id, state: "failed", finalUrl: currentUrl.href,
                  httpStatus: status, bytes: 0 });
                throw new SourceAccessError("source_abnormal", `来源返回 HTTP ${status}，已停止访问`);
              }
              const observation = { attemptId: attempt.id, url: currentUrl.href, status,
                startedAt: attempt.startedAt,
                finishedAt: new Date().toISOString() };
              const location = redirectLocation(status, headers);
              if (location) {
                const redirectUrl = new URL(location, currentUrl).href;
                if (!allowedOrigins.has(new URL(redirectUrl).origin)) {
                  await finish({ attemptId: attempt.id, state: "restricted", finalUrl: currentUrl.href,
                    httpStatus: status, bytes: 0, restrictionReason: "unknown_redirect_origin" });
                  throw new SourceAccessError("access_denied", "来源跳转到未获计划允许的 origin，已熔断访问");
                }
                await finish({ attemptId: attempt.id, state: "completed", finalUrl: currentUrl.href,
                  httpStatus: status, bytes: 0 });
                return { observation, redirectUrl };
              }
              const declaredBytes = Number(headers["content-length"]);
              if (Number.isFinite(declaredBytes) && declaredBytes > options.maximumBytes) {
                throw new SourceAccessError("source_abnormal", "来源响应声明大小超过允许上限");
              }
              const body = await response.body();
              if (body.byteLength > options.maximumBytes) {
                throw new SourceAccessError("source_abnormal", "来源响应大小超过允许上限");
              }
              const bodyRestriction = options.responseRestriction?.({ url: currentUrl.href, status, headers, body });
              if (bodyRestriction) {
                await finish({ attemptId: attempt.id, state: "restricted", finalUrl: currentUrl.href,
                  httpStatus: status, bytes: body.byteLength, restrictionReason: bodyRestriction.code });
                throw bodyRestriction;
              }
              await finish({ attemptId: attempt.id, state: "completed", finalUrl: currentUrl.href,
                httpStatus: status, bytes: body.byteLength });
              return { observation, final: { finalUrl: currentUrl.href, status, headers, body } };
              } finally {
                await response.dispose();
              }
            } catch (error) {
              if (!recorded) await finish({ attemptId: attempt.id, state: "failed" });
              if (error instanceof SourceAccessError) throw error;
              throw new SourceAccessError("source_abnormal", boundedFailure("显式 HTTP 请求失败", error));
            }
          });
          observations.push(result.observation);
          if ("final" in result) return { ...result.final, requests: observations };
          redirectParentAttemptId = result.observation.attemptId;
          currentUrl = requireAllowedUrl(new URL(result.redirectUrl, currentUrl).href, allowedOrigins);
        }
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
    cancel(reason) { gate.cancel(reason); },
    onIdle: () => gate.onIdle(),
    get state() { return gate.state; },
  };
}

function validateOptions(options: PacedSessionHttpAccessOptions) {
  if (!Number.isInteger(options.maximumBytes) || options.maximumBytes < 1) {
    throw new Error("响应字节上限必须为正整数");
  }
  if (!Number.isInteger(options.requestTimeoutMs) || options.requestTimeoutMs < 1) {
    throw new Error("单次请求超时必须为正整数");
  }
  if (options.allowedOrigins.length === 0) throw new Error("至少需要一个允许 origin");
}

async function reserveWhenEligible(
  options: PacedSessionHttpAccessOptions,
  policy: PacedPolicy,
  work: { targetKey: string; workKey: string },
  requestedUrl: string,
  redirectParentAttemptId: string | undefined,
  signal: AbortSignal,
): Promise<SourceRequestAttempt> {
  while (true) {
    let admission: SourceRequestAdmission;
    try {
      admission = await options.admission.reserveRequest({ runId: options.runId,
        targetKey: work.targetKey, workKey: work.workKey, gateKey: options.gateKey,
        providerKey: options.providerKey, providerVersion: options.providerVersion,
        policyVersion: policy.version, requestedUrl, redirectParentAttemptId,
        minimumIntervalMs: policy.minimumIntervalMs,
        maxRequestsPerMinute: policy.maxRequestsPerMinute });
    } catch (error) {
      throw new SourceAccessError("source_abnormal", boundedFailure("持久请求准入不可用", error));
    }
    if (admission.status === "admitted") return admission.attempt;
    if (admission.status === "blocked") throw blockedError(admission.reason);
    const waitMs = Math.max(0, new Date(admission.retryAt).getTime() - Date.now());
    if (waitMs > 0) await delay(waitMs, undefined, { signal });
  }
}

async function persistFinish(
  admission: Pick<SourceRequestAdmissionPort, "finishRequest">,
  input: Parameters<SourceRequestAdmissionPort["finishRequest"]>[0],
) {
  try {
    await admission.finishRequest(input);
  } catch (error) {
    throw new SourceAccessError("source_abnormal", boundedFailure("持久请求结果写入失败", error));
  }
}

function blockedError(reason: string) {
  if (reason === "rate_limited") return new SourceAccessError("rate_limited", "来源频控 gate 已开路");
  if (reason === "access_denied") return new SourceAccessError("access_denied", "来源访问 gate 已开路");
  if (reason === "login_required") return new SourceAccessError("login_required", "来源要求登录，gate 已开路");
  if (reason === "verification_required") {
    return new SourceAccessError("verification_required", "来源要求人工验证，gate 已开路");
  }
  return new SourceAccessError("source_abnormal", `持久请求 gate 阻止访问：${reason}`);
}

function boundedFailure(prefix: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return `${prefix}：${detail}`.slice(0, 2000);
}

function normalizeOrigin(value: string) {
  const url = new URL(value);
  if (url.origin !== value) throw new Error(`允许项必须是标准 origin：${value}`);
  return url.origin;
}

function requireAllowedUrl(value: string, allowedOrigins: Set<string>) {
  const url = new URL(value);
  if (!allowedOrigins.has(url.origin)) {
    throw new SourceAccessError("origin_not_allowed", `请求 origin 未获计划允许：${url.origin}`);
  }
  return url;
}

function restrictionForStatus(status: number) {
  if (status === 429) return new SourceAccessError("rate_limited", "来源返回 HTTP 429，已熔断访问");
  if (status === 401) return new SourceAccessError("login_required", "来源返回 HTTP 401，已停止访问");
  if (status === 403) return new SourceAccessError("access_denied", "来源返回 HTTP 403，已熔断访问");
  return undefined;
}

function redirectLocation(status: number, headers: Record<string, string>) {
  if (![301, 302, 303, 307, 308].includes(status)) return undefined;
  const location = headers.location;
  if (!location) throw new SourceAccessError("source_abnormal", `HTTP ${status} 缺少 Location`);
  return location;
}
