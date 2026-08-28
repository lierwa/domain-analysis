import { createHash } from "node:crypto";

import type { CrawlPlanSource, SourceProviderEvent, SourceSnapshotLineage } from "@domain-analysis/shared";
import * as cheerio from "cheerio";
import { decodeBuffer, getEncoding } from "encoding-sniffer";

import type { RawPublicResponse } from "./publicResourceTransport";

export type ContentAssessment = NonNullable<
  Extract<SourceProviderEvent, { type: "capture" }>["snapshot"]["observation"]["contentAssessment"]
>;

export function captureEvent(
  source: CrawlPlanSource,
  targetKey: string,
  url: URL,
  response: RawPublicResponse,
  observedAt: Date,
  contentAssessment?: ContentAssessment,
  lineage?: SourceSnapshotLineage,
): Extract<SourceProviderEvent, { type: "capture" }> {
  const finalUrl = new URL(response.finalUrl ?? url.href);
  const state = classifyStatus(response.statusCode);
  if (state !== "accessible") {
    return inaccessible(targetKey, url, observedAt, state, `HTTP ${response.statusCode}`, finalUrl, lineage);
  }
  const mediaType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase()
    || "application/octet-stream";
  const outputFormat = outputFormatFor(mediaType);
  if (!source.rawOutputPolicy.formats.includes(outputFormat)) {
    throw new Error(`来源返回 ${mediaType}，但计划未声明 ${outputFormat} 原始输出`);
  }
  if (!isInline(mediaType) && !source.rawOutputPolicy.retainAssets) {
    throw new Error(`来源返回 ${mediaType} 附件，但计划未允许保存附件`);
  }
  if (isInline(mediaType)) {
    const { text, charset } = decodeInlineText(response, mediaType);
    const hash = createHash("sha256").update(text).digest("hex");
    const common = snapshotCommon(source, targetKey, url, finalUrl,
      response, mediaType, observedAt, contentAssessment, lineage);
    return { type: "capture", targetKey, assets: [], snapshot: { ...common,
      payload: { kind: "inline_text", mediaType, charset, text,
        bytes: Buffer.byteLength(text), contentHash: hash } } };
  }
  const hash = createHash("sha256").update(response.body).digest("hex");
  const common = snapshotCommon(source, targetKey, url, finalUrl,
    response, mediaType, observedAt, contentAssessment, lineage);
  const filename = resourceFilename(finalUrl, response.headers["content-disposition"], mediaType);
  const assetKey = `${targetKey}-raw`;
  return { type: "capture", targetKey, snapshot: { ...common,
    payload: { kind: "asset", assetKey, filename, mediaType,
      bytes: response.body.byteLength, contentHash: hash } }, assets: [{
    assetKey, filename, sourceUrl: finalUrl.href, mediaType, contentHash: hash, content: response.body,
  }] };
}

export function inaccessible(targetKey: string, url: URL, observedAt: Date,
  state: "login_required" | "access_denied" | "not_found" | "source_error", error: string,
  finalUrl?: URL, lineage?: SourceSnapshotLineage) {
  return { type: "capture" as const, targetKey, assets: [], snapshot: {
    idempotencyKey: snapshotIdempotencyKey(targetKey, url, lineage),
    ...(lineage ? { lineage } : {}),
    object: { sourceIdentity: url.origin, kind: "web_resource", externalKey: url.href },
    observation: { requestedUrl: url.href, ...(finalUrl ? { finalUrl: finalUrl.href } : {}),
      observedAt: observedAt.toISOString(), state, responseHeaders: {}, error },
  } };
}

export function supportingAssessment(signal: string, reason: string): ContentAssessment {
  return { status: "supporting", ruleVersion: "public-content-v1", matchedSignals: [signal], reason };
}

export function assessExactResponse(
  source: CrawlPlanSource,
  target: CrawlPlanSource["targets"][number],
  response: RawPublicResponse,
  url: URL,
): ContentAssessment {
  const mediaType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!isInline(mediaType)) {
    const validPdf = mediaType !== "application/pdf"
      || Buffer.from(response.body.subarray(0, 5)).toString("ascii") === "%PDF-";
    return { status: response.body.byteLength > 0 && validPdf ? "accepted" : "rejected",
      ruleVersion: "public-content-v1", matchedSignals: validPdf ? ["planned_binary_resource"] : [],
      reason: validPdf ? "精确附件返回非空原字节" : "PDF 响应缺少有效文件签名" };
  }
  const { text } = decodeInlineText(response, mediaType);
  const visibleText = mediaType.includes("html") ? visiblePageText(text) : text.replace(/\s+/g, " ").trim();
  const terms = exactContentSignals(source, target, url);
  const matchedSignals = signalMatches(visibleText, terms);
  const structuredProduct = /["']@type["']\s*:\s*["'](?:Product|ProductGroup)["']/i.test(text);
  const models = modelTokens(visibleText);
  const relevantLinks = mediaType.includes("html") ? extractSiteLinks(response, url, terms).length : 0;
  const relevantBody = visibleText.length >= 200 && matchedSignals.length > 0;
  const productEvidence = source.sourceKind !== "brand_official"
    || structuredProduct || models.length >= 1 || relevantLinks >= 1;
  const accepted = relevantBody && productEvidence;
  return { status: accepted ? "accepted" : "rejected", ruleVersion: "public-content-v1",
    matchedSignals: matchedSignals.slice(0, 50), reason: accepted
      ? `精确正文命中 ${matchedSignals.length} 个计划信号`
      : `精确正文不满足内容门：chars=${visibleText.length}, signals=${matchedSignals.length}, models=${models.length}, links=${relevantLinks}` };
}

export function assessSiteResponse(response: RawPublicResponse, plan: { url: URL; requiredTerms: string[] }) {
  const mediaType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!isInline(mediaType)) {
    return { status: "rejected", ruleVersion: "public-content-v1", matchedSignals: [],
      reason: `site route 返回不可内联格式 ${mediaType || "unknown"}` } satisfies ContentAssessment;
  }
  const { text } = decodeInlineText(response, mediaType);
  const visibleText = mediaType.includes("html") ? visiblePageText(text) : text;
  const matchedSignals = signalMatches(visibleText, plan.requiredTerms);
  const relevantLinks = mediaType.includes("html")
    ? extractSiteLinks(response, plan.url, plan.requiredTerms).length : 0;
  const structuredProduct = /["']@type["']\s*:\s*["'](?:Product|ProductGroup)["']/i.test(text);
  const models = modelTokens(visibleText);
  const enoughBody = visibleText.length >= 600;
  const accepted = enoughBody && matchedSignals.length > 0
    && (structuredProduct || models.length >= 2 || relevantLinks >= 2);
  return { status: accepted ? "accepted" : "rejected", ruleVersion: "public-content-v1",
    matchedSignals: matchedSignals.slice(0, 50), reason: accepted
      ? `命中 ${matchedSignals.length} 个计划信号，并观察到${structuredProduct ? "结构化商品" : models.length >= 2 ? `${models.length} 个型号` : `${relevantLinks} 个相关链接`}`
      : `可见正文/计划信号/商品结构不足：chars=${visibleText.length}, signals=${matchedSignals.length}, models=${models.length}, links=${relevantLinks}` } satisfies ContentAssessment;
}

export function extractSiteLinks(response: RawPublicResponse, baseUrl: URL, requiredTerms: string[]) {
  const mediaType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") return [];
  const { text } = decodeInlineText(response, mediaType);
  const $ = cheerio.load(text);
  const byUrl = new Map<string, { url: URL; score: number }>();
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const url = safeSameOriginUrl(href, baseUrl.origin, baseUrl);
    if (!url || !isPageCandidate(url)) return;
    url.hash = "";
    const score = signalMatches(`${url.pathname} ${$(element).text()}`, requiredTerms).length * 10
      + sharedPathScore(url, baseUrl);
    const previous = byUrl.get(url.href);
    if (!previous || score > previous.score) byUrl.set(url.href, { url, score });
  });
  return [...byUrl.values()].filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score).map((item) => item.url);
}

export function signalMatches(value: string, terms: string[]) {
  const normalized = value.toLocaleLowerCase("zh-CN");
  return [...new Set(terms.filter((term) => normalized.includes(term.toLocaleLowerCase("zh-CN"))))];
}

export function safeSameOriginUrl(value: string, origin: string, base?: URL) {
  try {
    const url = new URL(value, base);
    if (url.origin !== origin || url.protocol !== "https:" || (url.port && url.port !== "443")
      || url.username || url.password) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function isPageCandidate(url: URL) {
  return !/\.(?:css|js|map|woff2?|ttf|eot|ico|png|jpe?g|gif|webp|svg|mp4|mp3|zip|rar)(?:$|\?)/i.test(url.href)
    && !/(?:logout|login|signin|signup|cart|checkout|account)(?:\/|$)/i.test(url.pathname);
}

export function sharedPathScore(candidate: URL, seed: URL) {
  const segment = seed.pathname.split("/").filter(Boolean)[0];
  return segment && candidate.pathname.split("/").filter(Boolean)[0] === segment ? 3 : 0;
}

export function decodeInlineText(response: RawPublicResponse, mediaType: string) {
  const transportLayerEncodingLabel = response.headers["content-type"]
    ?.match(/(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") {
    // WHY：HTML 的编码可能只写在 meta 中；复用 WHATWG sniffer，避免把非 UTF-8 原文替换后再伪造原字节哈希。
    const options = { defaultEncoding: "UTF-8", ...(transportLayerEncodingLabel
      ? { transportLayerEncodingLabel } : {}) };
    const body = Buffer.from(response.body);
    const decoded = { text: decodeBuffer(body, options), charset: getEncoding(body, options) };
    if (!transportLayerEncodingLabel
      || canDecodeWithoutReplacement(body, transportLayerEncodingLabel)) return decoded;
    const sniffedOptions = { defaultEncoding: "UTF-8" };
    const sniffed = { text: decodeBuffer(body, sniffedOptions), charset: getEncoding(body, sniffedOptions) };
    // WHY：真实官网可能把 HTTP charset 写错；只在标准优先级已造成损坏且正文声明结果更少损坏时纠正。
    return replacementCount(sniffed.text) < replacementCount(decoded.text) ? sniffed : decoded;
  }
  const decoder = new TextDecoder(transportLayerEncodingLabel ?? "utf-8");
  return { text: decoder.decode(response.body), charset: decoder.encoding };
}

export function isInline(mediaType: string) {
  return mediaType.startsWith("text/") || mediaType === "application/json"
    || mediaType === "application/xml" || mediaType === "application/xhtml+xml";
}

export function outputFormatFor(mediaType: string): CrawlPlanSource["rawOutputPolicy"]["formats"][number] {
  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") return "html";
  if (mediaType === "application/json") return "source_json";
  if (mediaType.startsWith("image/")) return "image";
  if (isInline(mediaType)) return "text";
  return "document";
}

export function objectKind(mediaType: string) {
  if (mediaType === "application/pdf" || mediaType.includes("officedocument")
    || mediaType.includes("spreadsheet")) return "document";
  if (mediaType.startsWith("image/")) return "image";
  return "web_resource";
}

export function resourceFilename(url: URL, disposition: string | undefined, mediaType: string) {
  const named = disposition?.match(/filename\*?=(?:UTF-8''|\")?([^";]+)/i)?.[1];
  const fallback = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "resource");
  const value = (named ?? fallback).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 200);
  return value || (mediaType === "application/pdf" ? "resource.pdf" : "resource.bin");
}

function visiblePageText(html: string) {
  const $ = cheerio.load(html);
  $("script,style,noscript,template").remove();
  return $.root().text().replace(/\s+/g, " ").trim();
}

function modelTokens(value: string) {
  const candidates = value.toUpperCase().match(/\b(?=[A-Z0-9-]{4,20}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9-]+\b/g) ?? [];
  return [...new Set(candidates)].filter((candidate) => !/^(?:UTF|GB|HTTP|HTML|CSS)-?\d+$/i.test(candidate));
}

function exactContentSignals(source: CrawlPlanSource, target: CrawlPlanSource["targets"][number], url: URL) {
  return [...new Set([source.publisher, target.name, target.captureUnit, ...target.taskTopics,
    ...url.pathname.split("/")].flatMap((value) => String(value).split(/[\s./_|,，、:：()（）-]+/u))
    .map((value) => value.trim()).filter((value) => value.length >= 2 && value.length <= 80))];
}

function canDecodeWithoutReplacement(body: Buffer, encodingLabel: string) {
  try {
    new TextDecoder(encodingLabel, { fatal: true }).decode(body);
    return true;
  } catch {
    return false;
  }
}

function replacementCount(value: string) {
  return value.split("�").length - 1;
}

function snapshotCommon(
  source: CrawlPlanSource,
  targetKey: string,
  requestedUrl: URL,
  finalUrl: URL,
  response: RawPublicResponse,
  mediaType: string,
  observedAt: Date,
  contentAssessment?: ContentAssessment,
  lineage?: SourceSnapshotLineage,
) {
  return { idempotencyKey: snapshotIdempotencyKey(targetKey, requestedUrl, lineage),
    ...(lineage ? { lineage } : {}),
    object: { sourceIdentity: source.key, kind: objectKind(mediaType), externalKey: requestedUrl.href },
    observation: { requestedUrl: requestedUrl.href, finalUrl: finalUrl.href, observedAt: observedAt.toISOString(),
      state: "accessible" as const, httpStatus: response.statusCode,
      responseHeaders: safeResponseHeaders(response.headers),
      ...(contentAssessment ? { contentAssessment } : {}) } };
}

function snapshotIdempotencyKey(targetKey: string, requestedUrl: URL, lineage?: SourceSnapshotLineage) {
  // WHY：幂等键标识计划中的稳定抓取工作，而不是响应字节。不同 URL 可能合法返回相同模板；
  // 同一工作重放时即使源站内容变化也必须保持同键，交给 Source Dataset 检出冲突。
  const workIdentity = `${lineage?.workKey ?? "url"}\0${requestedUrl.href}`;
  return `${targetKey}-${createHash("sha256").update(workIdentity).digest("hex")}`;
}

function classifyStatus(status: number) {
  if (status >= 200 && status < 300) return "accessible" as const;
  if (status === 401) return "login_required" as const;
  if (status === 403 || status === 429) return "access_denied" as const;
  if (status === 404) return "not_found" as const;
  return "source_error" as const;
}

function safeResponseHeaders(headers: Record<string, string>) {
  const allowed = new Set(["content-type", "content-length", "last-modified", "etag"]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => allowed.has(key.toLowerCase())));
}
