import { CheerioCrawler } from "@crawlee/cheerio";
import {
  publicWebTextCaptureInputSchema,
  publicWebTextCaptureSchema,
  type PublicWebTextCapture,
  type PublicWebTextCaptureInput,
} from "@domain-analysis/shared";
import { SourceAccessError } from "./sourceAccessError";
import { createSourceTextQuoteLocator } from "./sourceTextLocator";
import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";

export interface PublicWebTextSource {
  capture(input: PublicWebTextCaptureInput): Promise<PublicWebTextCapture>;
}

export interface CrawleePublicWebTextSourceOptions {
  allowedOrigins: string[];
  now?: () => Date;
}

export function createCrawleePublicWebTextSource(
  options: CrawleePublicWebTextSourceOptions,
): PublicWebTextSource {
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
  const now = options.now ?? (() => new Date());

  return {
    capture: (input) => capturePublicWebText(input, allowedOrigins, now),
  };
}

async function capturePublicWebText(
  rawInput: PublicWebTextCaptureInput,
  allowedOrigins: ReadonlySet<string>,
  now: () => Date,
): Promise<PublicWebTextCapture> {
  const input = publicWebTextCaptureInputSchema.parse(rawInput);
  assertAllowedOrigin(input.requestedUrl, allowedOrigins);
  let captured: PublicWebTextCapture | undefined;
  let finalFailure: Error | undefined;
  // WHY：关闭 Crawlee 的磁盘持久化，完整响应只存在于本次访问内存；永久区只接收选中的最小文本。
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new CheerioCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 30,
    async requestHandler({ $, request, response }) {
      const finalUrl = request.loadedUrl ?? request.url;
      assertAllowedOrigin(finalUrl, allowedOrigins);
      const selected = $(input.selector).filter((_, element) =>
        $(element).text().includes(input.requiredText)).first();
      if (selected.length === 0) {
        throw new SourceAccessError(
          "evidence_not_found",
          `来源中没有找到包含必要文本的选择区域：${input.selector}`,
        );
      }
      const content = (selected.is("script") ? selected.html() : selected.text())?.trim() ?? "";
      if (!content.includes(input.requiredText)) {
        throw new SourceAccessError("evidence_not_found", "选中的来源区域不包含必要文本");
      }
      const bytes = new TextEncoder().encode(content);
      if (bytes.byteLength > input.maximumBytes) {
        throw new SourceAccessError("source_abnormal", "选中的来源区域超过证据请求字节上限");
      }
      captured = publicWebTextCaptureSchema.parse({
        requestedUrl: input.requestedUrl,
        finalUrl,
        observedAt: now().toISOString(),
        httpValidation: {
          status: response.statusCode,
          etag: firstHeader(response.headers.etag),
          lastModified: firstHeader(response.headers["last-modified"]),
        },
        content,
        locator: createSourceTextQuoteLocator(content, input.selector),
      });
    },
    failedRequestHandler(_context, error) {
      finalFailure = error instanceof Error ? error : new Error(String(error));
    },
  }, config);

  try {
    await crawler.run([input.requestedUrl]);
    if (captured) return captured;
    if (finalFailure instanceof SourceAccessError) throw finalFailure;
    throw new SourceAccessError(
      "source_abnormal",
      finalFailure?.message ?? "来源访问结束但没有产出观察结果",
    );
  } finally {
    // TRADE-OFF：当前纵切片不保留 Crawlee 队列；持久恢复留给正式 durable collection run。
    await crawler.teardown();
    await config.getStorageClient().teardown?.();
  }
}

function assertAllowedOrigin(url: string, allowedOrigins: ReadonlySet<string>) {
  const origin = normalizeOrigin(url);
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
