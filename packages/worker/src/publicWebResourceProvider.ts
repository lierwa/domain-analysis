import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type {
  CrawlPlanSource,
  SourceProviderCollectionContext,
  SourceProviderEvent,
  SourceRequestAdmissionPort,
} from "@domain-analysis/shared";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";

import { assertPublicHttpsUrl } from "./publicNetworkPolicy";
import {
  createPublicResourceTransport,
  publicWebUserAgent,
  type RawPublicResponse,
} from "./publicResourceTransport";

const providerKey = "public.web-resource";
const providerVersion = "1.0.0";
const maximumAllowedBytes = 25_000_000;
const maximumRobotsBytes = 256_000;

export interface PublicWebResourceProviderOptions {
  request?: (url: URL, maximumBytes: number, signal?: AbortSignal) => Promise<RawPublicResponse>;
  now?: () => Date;
}

export function createPublicWebResourceProvider(options: PublicWebResourceProviderOptions = {}) {
  const request = options.request ?? createPublicResourceTransport();
  const now = options.now ?? (() => new Date());
  return {
    key: providerKey,
    version: providerVersion,
    validate: validatePublicSource,
    async preflight(source: CrawlPlanSource) { validatePublicSource(source); },
    async *collect(source: CrawlPlanSource, runId: string, admission?: SourceRequestAdmissionPort,
      signal?: AbortSignal, context?: SourceProviderCollectionContext): AsyncIterable<SourceProviderEvent> {
      if (context?.resumedFromRunId) {
        throw new Error("public.web-resource 没有持久工作队列，不能从前序运行继续");
      }
      if (!admission) throw new Error("public.web-resource 必须通过持久请求准入执行");
      const configuration = sourceConfiguration(source);
      const targets = source.targets.map((target, index) => targetPlan(source, target, index));
      const origins = [...new Set(targets.flatMap((plan) => plan.kind === "exact" ? [plan.url.origin] : []))];
      if (source.stopPolicy.requestBudget < targets.length + origins.length) {
        throw new Error("公共资源请求预算必须包含每个 origin 的 robots.txt 与每个 target 请求");
      }
      const robots = new Map<string, ReturnType<typeof robotsParser> | "blocked">();
      for (const origin of origins) {
        const robotsUrl = new URL("/robots.txt", origin);
        const owner = targets.find((plan) => plan.kind === "exact" && plan.url.origin === origin);
        if (!owner) throw new Error(`robots.txt 找不到所属 target：${origin}`);
        const response = await requestPersistently(source, runId, admission, owner.target.key,
          `robots:${origin}`, "robots_policy", robotsUrl, maximumRobotsBytes, request, signal);
        robots.set(origin, parseRobots(robotsUrl, response));
      }
      const responses = new Map<string, { url: URL; response: RawPublicResponse }>();
      for (const plan of targets) {
        const { target } = plan;
        const url = plan.kind === "exact" ? plan.url : linkedTargetUrl(plan, responses);
        const policy = robots.get(url.origin);
        if (policy === "blocked" || policy?.isAllowed(url.href, publicWebUserAgent) === false) {
          yield inaccessible(target.key, url, now(), "access_denied", "robots.txt 不允许访问该资源");
          return;
        }
        const response = await requestPersistently(source, runId, admission, target.key,
          `target:${target.key}`, target.captureUnit, url, configuration.maximumBytes, request, signal);
        const event = captureEvent(source, target.key, url, response, now());
        yield event;
        if (event.snapshot.observation.state !== "accessible") return;
        responses.set(target.key, { url, response });
        yield { type: "target.completed", targetKey: target.key };
      }
    },
  };
}

async function requestPersistently(
  source: CrawlPlanSource,
  runId: string,
  admission: SourceRequestAdmissionPort,
  targetKey: string,
  workKey: string,
  captureUnit: string,
  url: URL,
  maximumBytes: number,
  request: NonNullable<PublicWebResourceProviderOptions["request"]>,
  signal?: AbortSignal,
) {
  await admission.ensureCaptureWorkItem({ runId, targetKey, workKey, captureUnit, expectedUnitCount: 1 });
  await admission.startCaptureWorkItem({ runId, workKey });
  const attempt = await reserveWhenEligible(source, runId, admission, targetKey, workKey, url, signal);
  try {
    const response = await request(url, maximumBytes, signal);
    const restricted = restrictionReason(response.statusCode);
    await admission.finishRequest({ attemptId: attempt.id,
      state: restricted ? "restricted" : response.statusCode >= 500 ? "failed" : "completed",
      finalUrl: url.href, httpStatus: response.statusCode, bytes: response.body.byteLength,
      ...(restricted ? { restrictionReason: restricted } : {}) });
    await admission.finishCaptureWorkItem({ runId, workKey,
      status: restricted ? "stopped" : response.statusCode >= 500 ? "failed" : "completed",
      observedUnitCount: restricted || response.statusCode >= 500 ? 0 : 1,
      ...(restricted ? { terminationReason: restricted } : response.statusCode >= 500
        ? { terminationReason: `HTTP ${response.statusCode}` } : {}) });
    return response;
  } catch (error) {
    await admission.finishRequest({ attemptId: attempt.id, state: "failed" }).catch(() => undefined);
    await admission.finishCaptureWorkItem({ runId, workKey, status: "failed", observedUnitCount: 0,
      terminationReason: boundedFailure(error) }).catch(() => undefined);
    throw error;
  }
}

async function reserveWhenEligible(
  source: CrawlPlanSource,
  runId: string,
  admission: SourceRequestAdmissionPort,
  targetKey: string,
  workKey: string,
  url: URL,
  signal?: AbortSignal,
) {
  while (true) {
    const result = await admission.reserveRequest({ runId, targetKey, workKey,
      gateKey: `${providerKey}@${providerVersion}:${url.origin}`,
      providerKey, providerVersion, policyVersion: source.accessPolicy.version,
      requestedUrl: url.href, minimumIntervalMs: source.accessPolicy.minimumIntervalMs,
      maxRequestsPerMinute: source.accessPolicy.maxRequestsPerMinute });
    if (result.status === "admitted") return result.attempt;
    if (result.status === "blocked") throw new Error(`持久请求 gate 阻止访问：${result.reason}`);
    const waitMs = Math.max(0, new Date(result.retryAt).getTime() - Date.now());
    if (waitMs > 0) await delay(waitMs, undefined, { signal });
  }
}

function restrictionReason(status: number) {
  if (status === 429) return "rate_limited";
  if (status === 401) return "login_required";
  if (status === 403) return "access_denied";
  return undefined;
}

function boundedFailure(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

function validatePublicSource(source: CrawlPlanSource) {
  const configuration = sourceConfiguration(source);
  if (source.provider.key !== providerKey || source.provider.version !== providerVersion) {
    throw new Error(`公共资源 Provider 绑定必须是 ${providerKey}@${providerVersion}`);
  }
  for (const entry of source.entryUrls) assertPublicHttpsUrl(entry);
  const plans = source.targets.map((target, index) => targetPlan(source, target, index));
  for (const { target } of plans) {
    if (target.quantity.mode !== "target_count" || target.quantity.targetCount !== 1) {
      throw new Error(`公共资源 target ${target.key} 必须声明 target_count=1`);
    }
  }
  const exactUrls = plans.flatMap((plan) => plan.kind === "exact" ? [plan.url.href] : []);
  if (new Set(exactUrls).size !== exactUrls.length) throw new Error("公共资源 target URL 不得重复");
  if (source.entryUrls.length !== exactUrls.length
    || source.entryUrls.some((entry) => !exactUrls.includes(new URL(entry).href))) {
    throw new Error("公共资源入口清单中的每个 URL 都必须恰好对应一个 exact target");
  }
  const originCount = new Set(exactUrls.map((value) => new URL(value).origin)).size;
  if (source.stopPolicy.requestBudget < plans.length + originCount) {
    throw new Error("公共资源请求预算必须包含每个 origin 的 robots.txt 与每个 target 请求");
  }
  if (configuration.maximumBytes > maximumAllowedBytes) {
    throw new Error(`公共资源 maximum_bytes 不能超过 ${maximumAllowedBytes}`);
  }
}

function sourceConfiguration(source: CrawlPlanSource) {
  const keys = source.provider.configuration.map((item) => item.key).sort();
  if (keys.join(",") !== "maximum_bytes,mode") {
    throw new Error("公共资源 Provider 配置必须且只能包含 mode 与 maximum_bytes");
  }
  const values = Object.fromEntries(source.provider.configuration.map((item) => [item.key, item.value]));
  if (values.mode !== "exact_https") throw new Error("公共资源 Provider 只接受 mode=exact_https");
  const maximumBytes = Number(values.maximum_bytes);
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) throw new Error("公共资源 Provider 缺少正整数 maximum_bytes");
  return { maximumBytes };
}

function targetPlan(source: CrawlPlanSource, target: CrawlPlanSource["targets"][number], index: number) {
  const values = Object.fromEntries(target.providerConfiguration.map((item) => [item.key, item.value]));
  if (typeof values.url === "string" && target.providerConfiguration.length === 1) {
    const url = assertPublicHttpsUrl(values.url);
    // WHY：URL 与 URL/ 是同一个公网资源；双方先走 URL 规范化，不能用原始字符串制造假预检失败。
    if (!source.entryUrls.some((entryUrl) => new URL(entryUrl).href === url.href)) {
      throw new Error(`target ${target.key} 的 url 不在来源入口清单中`);
    }
    return { kind: "exact" as const, target, url };
  }
  if (typeof values.from_target === "string" && typeof values.link_text === "string"
    && target.providerConfiguration.length === 2) {
    const parentIndex = source.targets.findIndex((item) => item.key === values.from_target);
    if (parentIndex < 0 || parentIndex >= index) throw new Error(`target ${target.key} 的 from_target 必须引用前序 target`);
    return { kind: "linked" as const, target, fromTarget: values.from_target, linkText: values.link_text };
  }
  throw new Error(`target ${target.key} 必须配置单个 url，或 from_target + link_text`);
}

function linkedTargetUrl(
  plan: { target: CrawlPlanSource["targets"][number]; fromTarget: string; linkText: string },
  responses: Map<string, { url: URL; response: RawPublicResponse }>,
) {
  const parent = responses.get(plan.fromTarget);
  if (!parent) throw new Error(`target ${plan.target.key} 找不到已完成的前序响应：${plan.fromTarget}`);
  const mediaType = parent.response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") {
    throw new Error(`target ${plan.target.key} 的前序响应不是 HTML`);
  }
  const $ = cheerio.load(Buffer.from(parent.response.body).toString("utf8"));
  const matches = new Set<string>();
  $("a[href]").each((_index, element) => {
    if (normalizeLinkText($(element).text()) !== normalizeLinkText(plan.linkText)) return;
    const href = $(element).attr("href");
    if (!href) return;
    try { matches.add(new URL(href, parent.url).href); } catch { /* 无效 href 不进入候选。 */ }
  });
  if (matches.size !== 1) throw new Error(`target ${plan.target.key} 的链接文字必须唯一命中，实际 ${matches.size} 个 URL`);
  const url = assertPublicHttpsUrl([...matches][0]!);
  if (url.origin !== parent.url.origin) throw new Error(`target ${plan.target.key} 只允许跟进同源链接`);
  return url;
}

function normalizeLinkText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseRobots(url: URL, response: RawPublicResponse) {
  if (response.statusCode === 404) return robotsParser(url.href, "");
  if (response.statusCode === 401 || response.statusCode === 403) return "blocked" as const;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`robots.txt 返回 HTTP ${response.statusCode}`);
  }
  return robotsParser(url.href, Buffer.from(response.body).toString("utf8"));
}

function captureEvent(
  source: CrawlPlanSource,
  targetKey: string,
  url: URL,
  response: RawPublicResponse,
  observedAt: Date,
): Extract<SourceProviderEvent, { type: "capture" }> {
  const state = classifyStatus(response.statusCode);
  if (state !== "accessible") return inaccessible(targetKey, url, observedAt, state, `HTTP ${response.statusCode}`);
  const mediaType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
  const outputFormat = outputFormatFor(mediaType);
  if (!source.rawOutputPolicy.formats.includes(outputFormat)) {
    throw new Error(`来源返回 ${mediaType}，但计划未声明 ${outputFormat} 原始输出`);
  }
  if (!isInline(mediaType) && !source.rawOutputPolicy.retainAssets) {
    throw new Error(`来源返回 ${mediaType} 附件，但计划未允许保存附件`);
  }
  const hash = createHash("sha256").update(response.body).digest("hex");
  const common = { idempotencyKey: `${targetKey}-${hash}`,
    object: { sourceIdentity: source.key, kind: objectKind(mediaType), externalKey: url.href },
    observation: { requestedUrl: url.href, finalUrl: url.href, observedAt: observedAt.toISOString(),
      state, httpStatus: response.statusCode, responseHeaders: safeResponseHeaders(response.headers) } };
  if (isInline(mediaType)) {
    const text = Buffer.from(response.body).toString("utf8");
    return { type: "capture", targetKey, assets: [], snapshot: { ...common,
      payload: { kind: "inline_text", mediaType, charset: "utf-8", text,
        bytes: response.body.byteLength, contentHash: hash } } };
  }
  const filename = resourceFilename(url, response.headers["content-disposition"], mediaType);
  const assetKey = `${targetKey}-raw`;
  return { type: "capture", targetKey, snapshot: { ...common,
    payload: { kind: "asset", assetKey, filename, mediaType,
      bytes: response.body.byteLength, contentHash: hash } }, assets: [{
    assetKey, filename, sourceUrl: url.href, mediaType, contentHash: hash, content: response.body,
  }] };
}

function inaccessible(targetKey: string, url: URL, observedAt: Date,
  state: "login_required" | "access_denied" | "not_found" | "source_error", error: string) {
  return { type: "capture" as const, targetKey, assets: [], snapshot: {
    idempotencyKey: `${targetKey}-${state}`,
    object: { sourceIdentity: url.origin, kind: "web_resource", externalKey: url.href },
    observation: { requestedUrl: url.href, observedAt: observedAt.toISOString(), state,
      responseHeaders: {}, error },
  } };
}

function classifyStatus(status: number) {
  if (status >= 200 && status < 300) return "accessible" as const;
  if (status === 401) return "login_required" as const;
  if (status === 403 || status === 429) return "access_denied" as const;
  if (status === 404) return "not_found" as const;
  return "source_error" as const;
}

function isInline(mediaType: string) {
  return mediaType.startsWith("text/") || mediaType === "application/json"
    || mediaType === "application/xml" || mediaType === "application/xhtml+xml";
}

function outputFormatFor(mediaType: string): CrawlPlanSource["rawOutputPolicy"]["formats"][number] {
  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") return "html";
  if (mediaType === "application/json") return "source_json";
  if (mediaType.startsWith("image/")) return "image";
  if (isInline(mediaType)) return "text";
  return "document";
}

function objectKind(mediaType: string) {
  if (mediaType === "application/pdf" || mediaType.includes("officedocument") || mediaType.includes("spreadsheet")) return "document";
  if (mediaType.startsWith("image/")) return "image";
  return "web_resource";
}

function resourceFilename(url: URL, disposition: string | undefined, mediaType: string) {
  const named = disposition?.match(/filename\*?=(?:UTF-8''|\")?([^";]+)/i)?.[1];
  const fallback = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "resource");
  const value = (named ?? fallback).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 200);
  return value || (mediaType === "application/pdf" ? "resource.pdf" : "resource.bin");
}

function safeResponseHeaders(headers: Record<string, string>) {
  const allowed = new Set(["content-type", "content-length", "last-modified", "etag"]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => allowed.has(key.toLowerCase())));
}
