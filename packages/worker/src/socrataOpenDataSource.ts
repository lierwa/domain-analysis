import { HttpCrawler } from "@crawlee/http";
import { z } from "zod";

import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import { SourceAccessError } from "./sourceAccessError";

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const recordSchema = z.record(scalarSchema).superRefine((record, context) => {
  if (Object.keys(record).length === 0 || Object.keys(record).length > 200) {
    context.addIssue({ code: "custom", message: "开放数据记录字段数必须为 1-200" });
  }
});

export interface SocrataRecordCapture {
  requestedUrl: string;
  finalUrl: string;
  observedAt: string;
  httpValidation: { status: number };
  record: Record<string, string | number | boolean | null>;
}

export interface SocrataOpenDataSource {
  capture(input: {
    requestedUrl: string;
    lookup: { fieldCode: string; value: string };
    maximumBytes: number;
  }, signal?: AbortSignal): Promise<SocrataRecordCapture>;
}

export function createSocrataOpenDataSource(options: {
  allowedOrigins: string[];
  allowedDatasetIds: string[];
  now?: () => Date;
}): SocrataOpenDataSource {
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
  const allowedDatasetIds = new Set(options.allowedDatasetIds);
  const now = options.now ?? (() => new Date());
  return {
    capture: async (input, signal) => {
      validateRequest(input.requestedUrl, input.lookup, allowedOrigins, allowedDatasetIds);
      const response = await requestJson(input.requestedUrl, allowedOrigins, signal);
      if (response.bytes > input.maximumBytes) {
        throw new SourceAccessError("source_abnormal", "开放数据记录超过证据请求字节上限");
      }
      const rows = z.array(recordSchema).max(2).parse(response.json);
      if (rows.length === 0) throw new SourceAccessError("evidence_not_found", "开放数据集没有匹配记录");
      if (rows.length !== 1) throw new SourceAccessError("source_abnormal", "开放数据精确查询返回多条记录");
      const record = rows[0]!;
      if (String(record[input.lookup.fieldCode]) !== input.lookup.value) {
        throw new SourceAccessError("source_abnormal", "开放数据返回记录与查询身份不一致");
      }
      return {
        requestedUrl: input.requestedUrl,
        finalUrl: response.finalUrl,
        observedAt: now().toISOString(),
        httpValidation: { status: response.status },
        record,
      };
    },
  };
}

function validateRequest(
  requestedUrl: string,
  lookup: { fieldCode: string; value: string },
  allowedOrigins: ReadonlySet<string>,
  allowedDatasetIds: ReadonlySet<string>,
) {
  if (!/^[a-z_][a-z0-9_]*$/.test(lookup.fieldCode)) {
    throw new SourceAccessError("source_abnormal", "开放数据查询字段码非法");
  }
  const url = new URL(requestedUrl);
  if (!allowedOrigins.has(normalizeOrigin(url.toString()))) {
    throw new SourceAccessError("origin_not_allowed", `来源 origin 未获本地配置允许：${url.origin}`);
  }
  const match = /^\/resource\/([a-z0-9]{4}-[a-z0-9]{4})\.json$/.exec(url.pathname);
  if (!match || !allowedDatasetIds.has(match[1]!)) {
    throw new SourceAccessError("origin_not_allowed", "Socrata 数据集未进入本地白名单");
  }
  if (url.searchParams.get(lookup.fieldCode) !== lookup.value
    || url.searchParams.get("$limit") !== "1"
    || [...url.searchParams.keys()].some((key) => key !== lookup.fieldCode && key !== "$limit")) {
    throw new SourceAccessError("source_abnormal", "Socrata 只允许单字段精确查询并限制为一条记录");
  }
}

async function requestJson(
  requestedUrl: string,
  allowedOrigins: ReadonlySet<string>,
  signal?: AbortSignal,
) {
  let captured: { bytes: number; finalUrl: string; json: unknown; status: number } | undefined;
  let finalFailure: Error | undefined;
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new HttpCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    maxRequestsPerCrawl: 1,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 30,
    async requestHandler({ body, json, request, response }) {
      const finalUrl = request.loadedUrl ?? request.url;
      if (!allowedOrigins.has(normalizeOrigin(finalUrl))) {
        throw new SourceAccessError("origin_not_allowed", "开放数据重定向到未允许 origin");
      }
      if (!response.statusCode) throw new Error("开放数据响应缺少 HTTP 状态码");
      captured = {
        bytes: typeof body === "string" ? new TextEncoder().encode(body).byteLength : body.byteLength,
        finalUrl,
        json,
        status: response.statusCode,
      };
    },
    failedRequestHandler(_context, error) {
      finalFailure = error instanceof Error ? error : new Error(String(error));
    },
  }, config);
  const abort = () => crawler.teardown();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await crawler.run([requestedUrl]);
    if (signal?.aborted) throw signal.reason ?? new Error("开放数据读取已取消");
    if (captured) return captured;
    throw new SourceAccessError("source_abnormal", finalFailure?.message ?? "开放数据访问未产出 JSON");
  } finally {
    signal?.removeEventListener("abort", abort);
    await crawler.teardown();
    await config.getStorageClient().teardown?.();
  }
}

function normalizeOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new SourceAccessError("origin_not_allowed", "开放数据来源只允许 HTTPS");
  return url.origin;
}
