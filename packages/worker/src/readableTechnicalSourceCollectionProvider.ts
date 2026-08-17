import { CheerioCrawler } from "@crawlee/cheerio";
import {
  sourceCollectionProviderResultSchema,
  type SourceCollectionProviderPort,
  type SourceCollectionProviderResult,
  type SourceCollectionWorkItem,
} from "@domain-analysis/shared";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { z } from "zod";

import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import { SourceAccessError } from "./sourceAccessError";

const failureStates = [
  "not_found",
  "access_denied",
  "login_required",
  "verification_required",
  "rate_limited",
  "source_abnormal",
] as const;

const readablePageObservationSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("accessible"),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url(),
    observedAt: z.string().datetime({ offset: true }),
    httpValidation: z.object({
      status: z.number().int().min(100).max(599),
      etag: z.string().min(1).max(1000).optional(),
      lastModified: z.string().min(1).max(1000).optional(),
    }).strict(),
    html: z.string().min(1).max(2_000_000),
  }).strict(),
  z.object({
    state: z.enum(failureStates),
    requestedUrl: z.string().url(),
    observedAt: z.string().datetime({ offset: true }),
    httpValidation: z.object({ status: z.number().int().min(100).max(599).optional() }).strict().optional(),
  }).strict(),
]);

export type ReadablePageObservation = z.infer<typeof readablePageObservationSchema>;
export type ReadablePageReader = (
  requestedUrl: string,
  signal?: AbortSignal,
) => Promise<ReadablePageObservation>;

export interface ReadableTechnicalSourceOptions {
  allowedOrigins: string[];
  pageReader: ReadablePageReader;
}

export interface CrawleeReadablePageReaderOptions {
  allowedOrigins: string[];
  now?: () => Date;
  maximumHtmlCharacters?: number;
}

export function createReadableTechnicalSourceCollectionProvider(
  options: ReadableTechnicalSourceOptions,
): SourceCollectionProviderPort {
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
  const active = new Map<string, Set<AbortController>>();
  return {
    collect: async ({ sourceRun, item, abortSignal }) => {
      const denied = deniedReason(item);
      if (denied) return failureResult(item.requestedUrl, new Date().toISOString(), "source_abnormal");
      if (item.object.kind !== "document") {
        return failureResult(item.requestedUrl, new Date().toISOString(), "source_abnormal");
      }
      assertAllowedOrigin(item.requestedUrl, allowedOrigins);
      const controller = registerController(active, sourceRun.id);
      const signal = abortSignal
        ? AbortSignal.any([abortSignal, controller.signal])
        : controller.signal;
      try {
        const page = readablePageObservationSchema.parse(
          await options.pageReader(item.requestedUrl, signal),
        );
        if (page.state !== "accessible") {
          return failureResult(page.requestedUrl, page.observedAt, page.state, page.httpValidation);
        }
        assertAllowedOrigin(page.finalUrl, allowedOrigins);
        return accessibleResult(item, page);
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        const state = error instanceof SourceAccessError && error.code !== "origin_not_allowed"
          ? error.code
          : "source_abnormal";
        return failureResult(item.requestedUrl, new Date().toISOString(), normalizeFailureState(state));
      } finally {
        unregisterController(active, sourceRun.id, controller);
      }
    },
    cancel: (sourceRunId, reason) => {
      for (const controller of active.get(sourceRunId) ?? []) {
        controller.abort(new SourceAccessError("source_abnormal", reason));
      }
    },
  };
}

export function createCrawleeReadablePageReader(
  options: CrawleeReadablePageReaderOptions,
): ReadablePageReader {
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
  const now = options.now ?? (() => new Date());
  const maximumHtmlCharacters = options.maximumHtmlCharacters ?? 2_000_000;
  return async (requestedUrl, signal) => {
    assertAllowedOrigin(requestedUrl, allowedOrigins);
    let observation: ReadablePageObservation | undefined;
    let failure: Error | undefined;
    const config = createEphemeralCrawleeConfiguration();
    // WHY：页面正文只在本次访问内存中存在；不执行脚本、不加载子资源、不建立第二套持久队列。
    const crawler = new CheerioCrawler({
      maxConcurrency: 1,
      maxRequestRetries: 0,
      maxRequestsPerCrawl: 1,
      navigationTimeoutSecs: 30,
      requestHandlerTimeoutSecs: 30,
      async requestHandler({ $, request, response }) {
        const finalUrl = request.loadedUrl ?? request.url;
        assertAllowedOrigin(finalUrl, allowedOrigins);
        const html = $.html();
        if (html.length > maximumHtmlCharacters) {
          throw new SourceAccessError("source_abnormal", "公开技术网页超过临时解析上限");
        }
        observation = readablePageObservationSchema.parse({
          state: "accessible",
          requestedUrl,
          finalUrl,
          observedAt: now().toISOString(),
          httpValidation: {
            status: response.statusCode,
            etag: firstHeader(response.headers.etag),
            lastModified: firstHeader(response.headers["last-modified"]),
          },
          html,
        });
      },
      failedRequestHandler(_context, error) {
        failure = error instanceof Error ? error : new Error(String(error));
      },
    }, config);
    const abort = () => crawler.teardown();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await crawler.run([requestedUrl]);
      if (signal?.aborted) throw signal.reason ?? new Error("来源读取已取消");
      if (observation) return observation;
      if (failure instanceof SourceAccessError) throw failure;
      throw new SourceAccessError("source_abnormal", failure?.message ?? "公开技术网页没有观察结果");
    } finally {
      signal?.removeEventListener("abort", abort);
      await crawler.teardown();
      await config.getStorageClient().teardown?.();
    }
  };
}

export function extractReadableDocument(html: string, sourceUrl: string) {
  // TRADE-OFF：只保留纯文本，不返回 Readability HTML；这样当前链路无需执行或渲染不可信标记。
  const dom = new JSDOM(html, { url: sourceUrl });
  const article = new Readability(dom.window.document.cloneNode(true) as Document, {
    charThreshold: 120,
    maxElemsToParse: 50_000,
  }).parse();
  const text = normalizeText(article?.textContent ?? "");
  if (!article || text.length < 120) {
    throw new SourceAccessError("evidence_not_found", "公开技术网页没有足够的正文内容");
  }
  if (text.length > 100_000) {
    throw new SourceAccessError("source_abnormal", "公开技术网页正文超过来源快照上限");
  }
  return {
    title: article.title?.trim() || new URL(sourceUrl).hostname,
    publisher: article.siteName?.trim() || new URL(sourceUrl).hostname,
    text,
  };
}

function accessibleResult(
  item: SourceCollectionWorkItem,
  page: Extract<ReadablePageObservation, { state: "accessible" }>,
): SourceCollectionProviderResult {
  const document = extractReadableDocument(page.html, page.finalUrl);
  return sourceCollectionProviderResultSchema.parse({
    accessStartedAt: page.observedAt,
    accessFinishedAt: page.observedAt,
    observation: {
      requestedUrl: page.requestedUrl,
      finalUrl: page.finalUrl,
      observedAt: page.observedAt,
      state: "accessible",
      httpValidation: page.httpValidation,
    },
    content: {
      kind: "document",
      title: document.title,
      publisher: document.publisher,
      documentIdentifier: page.finalUrl,
      publicationStatus: "unknown",
      sections: [{
        heading: document.title,
        blocks: [{ kind: "text", role: "other", text: document.text }],
      }],
    },
    relations: [],
    stopRun: false,
  });
}

function failureResult(
  requestedUrl: string,
  observedAt: string,
  state: (typeof failureStates)[number],
  httpValidation?: { status?: number },
) {
  return sourceCollectionProviderResultSchema.parse({
    accessStartedAt: observedAt,
    accessFinishedAt: observedAt,
    observation: {
      requestedUrl,
      observedAt,
      state,
      failureCode: state,
      httpValidation,
    },
    relations: [],
    stopRun: state !== "not_found",
  });
}

function deniedReason(item: SourceCollectionWorkItem) {
  if (item.usagePermission.localRead !== "allowed") return "local_read_not_allowed";
  if (item.usagePermission.evidenceStorage !== "allowed") return "evidence_storage_not_allowed";
  return undefined;
}

function normalizeFailureState(value: string): (typeof failureStates)[number] {
  return failureStates.includes(value as (typeof failureStates)[number])
    ? value as (typeof failureStates)[number]
    : "source_abnormal";
}

function normalizeText(value: string) {
  return value.replaceAll("\r\n", "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function assertAllowedOrigin(value: string, allowedOrigins: ReadonlySet<string>) {
  const origin = normalizeOrigin(value);
  if (!allowedOrigins.has(origin)) {
    throw new SourceAccessError("origin_not_allowed", `来源 origin 未获本地配置允许：${origin}`);
  }
}

function normalizeOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new SourceAccessError("origin_not_allowed", "公开来源只允许 HTTPS");
  }
  return url.origin;
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function registerController(active: Map<string, Set<AbortController>>, runId: string) {
  const controller = new AbortController();
  const controllers = active.get(runId) ?? new Set<AbortController>();
  controllers.add(controller);
  active.set(runId, controllers);
  return controller;
}

function unregisterController(
  active: Map<string, Set<AbortController>>,
  runId: string,
  controller: AbortController,
) {
  const controllers = active.get(runId);
  controllers?.delete(controller);
  if (controllers?.size === 0) active.delete(runId);
}
