import { createHash } from "node:crypto";

import { HttpCrawler } from "@crawlee/http";
import {
  documentExcerptCaptureInputSchema,
  documentExcerptCaptureSchema,
  type DocumentExcerptCapture,
  type DocumentExcerptCaptureInput,
} from "@domain-analysis/shared";
import { extractText } from "unpdf";

import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import { SourceAccessError } from "./sourceAccessError";
import { createTextQuote } from "./sourceTextLocator";

export interface DocumentExcerptSource {
  capture(input: DocumentExcerptCaptureInput, signal?: AbortSignal): Promise<DocumentExcerptCapture>;
}

export interface CrawleeDocumentExcerptSourceOptions {
  allowedOrigins: string[];
  now?: () => Date;
}

export function createCrawleeDocumentExcerptSource(
  options: CrawleeDocumentExcerptSourceOptions,
): DocumentExcerptSource {
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
  const now = options.now ?? (() => new Date());
  return {
    capture: (input, signal) => captureDocumentExcerpt(input, allowedOrigins, now, signal),
  };
}

async function captureDocumentExcerpt(
  rawInput: DocumentExcerptCaptureInput,
  allowedOrigins: ReadonlySet<string>,
  now: () => Date,
  signal?: AbortSignal,
): Promise<DocumentExcerptCapture> {
  const input = documentExcerptCaptureInputSchema.parse(rawInput);
  assertAllowedOrigin(input.requestedUrl, allowedOrigins);
  let captured: DocumentExcerptCapture | undefined;
  let finalFailure: Error | undefined;
  // WHY：完整 PDF 只进入内存；Evidence 永久区仅接收由问题定位出的单页原始文本。
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new HttpCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    maxRequestsPerCrawl: 1,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 30,
    additionalMimeTypes: ["application/pdf"],
    async requestHandler({ body, contentType, request, response }) {
      const finalUrl = request.loadedUrl ?? request.url;
      assertAllowedOrigin(finalUrl, allowedOrigins);
      if (contentType.type !== "application/pdf") {
        throw new SourceAccessError("source_abnormal", `来源不是 PDF：${contentType.type}`);
      }
      if (typeof body === "string") {
        throw new SourceAccessError("source_abnormal", "PDF 来源被错误解码为文本响应");
      }
      if (body.byteLength > input.maximumSourceBytes) {
        throw new SourceAccessError("source_abnormal", "PDF 超过来源访问字节上限");
      }

      const sourceDocumentSha256 = createHash("sha256").update(body).digest("hex");
      const { text } = await extractText(new Uint8Array(body), { mergePages: false });
      const excerpt = selectDocumentExcerpt(text, input, sourceDocumentSha256);
      captured = documentExcerptCaptureSchema.parse({
        requestedUrl: input.requestedUrl,
        finalUrl,
        observedAt: now().toISOString(),
        httpValidation: {
          status: response.statusCode,
          etag: firstHeader(response.headers.etag),
          lastModified: firstHeader(response.headers["last-modified"]),
        },
        content: excerpt.content,
        locator: excerpt.locator,
      });
    },
    failedRequestHandler(_context, error) {
      finalFailure = error instanceof Error ? error : new Error(String(error));
    },
  }, config);
  const abort = () => crawler.teardown();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    await crawler.run([input.requestedUrl]);
    if (signal?.aborted) throw signal.reason ?? new Error("PDF 来源读取已取消");
    if (captured) return captured;
    if (finalFailure instanceof SourceAccessError) throw finalFailure;
    throw new SourceAccessError("source_abnormal", finalFailure?.message ?? "PDF 来源未产出页摘录");
  } finally {
    signal?.removeEventListener("abort", abort);
    await crawler.teardown();
    await config.getStorageClient().teardown?.();
  }
}

export function selectDocumentExcerpt(
  pages: readonly string[],
  input: Pick<DocumentExcerptCaptureInput, "requiredText" | "requiredSectionTerms" | "section" | "maximumExcerptBytes">,
  sourceDocumentSha256: string,
) {
  const matches = pages.flatMap((content, index) => {
    const includesIdentity = content.includes(input.requiredText);
    const includesSection = input.requiredSectionTerms.every((term) => content.includes(term));
    return includesIdentity && includesSection ? [{ content, page: index + 1 }] : [];
  });
  if (matches.length === 0) {
    throw new SourceAccessError("evidence_not_found", "PDF 中没有同时满足对象与章节线索的页面");
  }
  if (matches.length !== 1) {
    throw new SourceAccessError("source_abnormal", `PDF 章节定位不唯一：${matches.length} 页`);
  }
  const match = matches[0]!;
  if (new TextEncoder().encode(match.content).byteLength > input.maximumExcerptBytes) {
    throw new SourceAccessError("source_abnormal", "PDF 页摘录超过证据字节上限");
  }
  return {
    content: match.content,
    locator: {
      kind: "document_excerpt" as const,
      sourceDocumentSha256,
      page: match.page,
      section: input.section,
      quote: createTextQuote(match.content),
    },
  };
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
