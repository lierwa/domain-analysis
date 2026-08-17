import { HttpCrawler } from "@crawlee/http";
import {
  energyLabelRecordCaptureInputSchema,
  publicWebTextCaptureSchema,
  type EnergyLabelRecordCaptureInput,
  type PublicWebTextCapture,
} from "@domain-analysis/shared";
import { z } from "zod";

import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import { SourceAccessError } from "./sourceAccessError";
import { createSourceTextQuoteLocator } from "./sourceTextLocator";

const listPath = "/admin-api/gateway/productRegistration/productRegistrationList";
const detailPath = "/admin-api/gateway/productRegistration/productDetailById";
const registrationSchema = z.object({
  id: z.number().int(),
  productModel: z.string().min(1),
  productTypeCode: z.string().min(1),
  producerName: z.string().min(1),
  registrationNumber: z.string().min(1),
}).passthrough();
const listResponseSchema = z.object({
  code: z.literal(200),
  data: z.object({
    total: z.number().int().nonnegative(),
    list: z.array(registrationSchema),
  }).passthrough(),
}).passthrough();
const detailResponseSchema = z.object({
  code: z.literal(200),
  data: z.object({
    productModel: z.string(),
    registrationNumber: z.string().min(1),
  }).passthrough(),
}).passthrough();

export type EnergyLabelRegistration = z.infer<typeof registrationSchema>;

export interface EnergyLabelRecordSource {
  readonly requestedUrl: string;
  findRegistrationsByModel(input: EnergyLabelRecordCaptureInput, signal?: AbortSignal): Promise<EnergyLabelRegistration[]>;
  captureByModel(input: EnergyLabelRecordCaptureInput, signal?: AbortSignal): Promise<PublicWebTextCapture>;
}

export interface CrawleeEnergyLabelRecordSourceOptions {
  allowedOrigins: string[];
  origin?: string;
  now?: () => Date;
}

export function createCrawleeEnergyLabelRecordSource(
  options: CrawleeEnergyLabelRecordSourceOptions,
): EnergyLabelRecordSource {
  const origin = normalizeOrigin(options.origin ?? "https://www.energylabel.com.cn");
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
  const requestedUrl = new URL(detailPath, origin).toString();
  const now = options.now ?? (() => new Date());
  return {
    requestedUrl,
    findRegistrationsByModel: (input, signal) => findRegistrationsByModel(input, origin, allowedOrigins, signal),
    captureByModel: (input, signal) => captureEnergyLabelRecord(input, origin, allowedOrigins, now, signal),
  };
}

export function parseEnergyLabelRegistrationList(
  value: unknown,
  productModel: string,
): EnergyLabelRegistration[] {
  return listResponseSchema.parse(value).data.list.filter((item) => item.productModel === productModel);
}

async function findRegistrationsByModel(
  rawInput: EnergyLabelRecordCaptureInput,
  origin: string,
  allowedOrigins: ReadonlySet<string>,
  signal?: AbortSignal,
) {
  const input = energyLabelRecordCaptureInputSchema.parse(rawInput);
  assertAllowed(origin, allowedOrigins);
  const listUrl = new URL(listPath, origin).toString();
  const response = await requestJson(createListRequest(listUrl, input.productModel), allowedOrigins, signal);
  assertMaximumBytes(response.content, input.maximumBytes, "能效备案列表");
  return parseEnergyLabelRegistrationList(response.json, input.productModel);
}

async function captureEnergyLabelRecord(
  rawInput: EnergyLabelRecordCaptureInput,
  origin: string,
  allowedOrigins: ReadonlySet<string>,
  now: () => Date,
  signal?: AbortSignal,
): Promise<PublicWebTextCapture> {
  const input = energyLabelRecordCaptureInputSchema.parse(rawInput);
  try {
    const matches = await findRegistrationsByModel(input, origin, allowedOrigins, signal);
    if (matches.length === 0) {
      throw new SourceAccessError("evidence_not_found", `能效备案中没有型号：${input.productModel}`);
    }
    if (matches.length !== 1) {
      throw new SourceAccessError("source_abnormal", `能效备案型号存在 ${matches.length} 条记录：${input.productModel}`);
    }
    const detailUrl = new URL(detailPath, origin).toString();
    const response = await requestJson(createDetailRequest(detailUrl, matches[0]!), allowedOrigins, signal);
    assertMaximumBytes(response.content, input.maximumBytes, "能效备案详情");
    const parsed = detailResponseSchema.parse(response.json);
    if (parsed.data.productModel !== input.productModel) {
      throw new SourceAccessError("source_abnormal", "能效备案详情型号与请求不一致");
    }
    return publicWebTextCaptureSchema.parse({
      requestedUrl: detailUrl,
      finalUrl: response.finalUrl,
      observedAt: now().toISOString(),
      httpValidation: { status: response.status },
      content: response.content,
      locator: createSourceTextQuoteLocator(response.content, "json:$.data"),
    });
  } catch (error) {
    if (error instanceof SourceAccessError) throw error;
    throw new SourceAccessError("source_abnormal", error instanceof Error ? error.message : String(error));
  }
}

async function requestJson(
  request: ReturnType<typeof createPostRequest>,
  allowedOrigins: ReadonlySet<string>,
  signal?: AbortSignal,
) {
  let captured: { content: string; finalUrl: string; json: unknown; status: number } | undefined;
  let finalFailure: Error | undefined;
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new HttpCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    maxRequestsPerCrawl: 1,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 30,
    async requestHandler({ body, contentType, json, request: handledRequest, response }) {
      const finalUrl = handledRequest.loadedUrl ?? handledRequest.url;
      assertAllowed(finalUrl, allowedOrigins);
      if (!response.statusCode) throw new Error("能效备案响应缺少 HTTP 状态码");
      captured = {
        content: typeof body === "string" ? body : body.toString(contentType.encoding),
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
    await crawler.run([request]);
    if (signal?.aborted) throw signal.reason ?? new Error("监管来源读取已取消");
    if (captured) return captured;
    throw new SourceAccessError("source_abnormal", finalFailure?.message ?? "能效备案访问未产出 JSON");
  } finally {
    signal?.removeEventListener("abort", abort);
    await crawler.teardown();
    await config.getStorageClient().teardown?.();
  }
}

function createListRequest(url: string, productModel: string) {
  return createPostRequest(url, {
    mark: 854,
    productType: "",
    productModel,
    registrationNumber: "",
    current: 1,
    pageSize: 20,
    isOld: 0,
    producerName: "",
  });
}

function createDetailRequest(url: string, match: { id: number; productTypeCode: string }) {
  return createPostRequest(url, {
    productId: match.id,
    productTypeCode: match.productTypeCode,
    mark: 854,
    isSign: "true",
    isOld: 0,
  });
}

function createPostRequest(url: string, body: Record<string, unknown>) {
  return {
    url,
    method: "POST" as const,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(body),
    useExtendedUniqueKey: true,
  };
}

function assertMaximumBytes(content: string, maximumBytes: number, label: string) {
  if (new TextEncoder().encode(content).byteLength > maximumBytes) {
    throw new SourceAccessError("source_abnormal", `${label}超过证据请求字节上限`);
  }
}

function assertAllowed(value: string, allowedOrigins: ReadonlySet<string>) {
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
