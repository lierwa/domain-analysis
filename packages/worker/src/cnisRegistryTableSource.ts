import { createHash } from "node:crypto";

import { HttpCrawler } from "@crawlee/http";
import {
  cnisRegistryRowCaptureInputSchema,
  tableRegionCaptureSchema,
  type CnisRegistryRowCaptureInput,
  type TableRegionCapture,
} from "@domain-analysis/shared";
import { ArchiveReader, libarchiveWasm } from "libarchive-wasm";
import { readSheet } from "read-excel-file/node";

import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import { SourceAccessError } from "./sourceAccessError";

const defaultArchiveUrl = "https://www.cnis.ac.cn/tzgg/202412/P020241231788865667216.rar";
const sheet = "结果";
const expectedHeader = ["序号", "国家标准", "大类名称", "生产者名称", "规格型号", "备案号", "能效等级"];

export interface CnisRegistryTableSource {
  readonly requestedUrl: string;
  captureByModel(input: CnisRegistryRowCaptureInput): Promise<TableRegionCapture>;
}

export interface CnisRegistryTableSourceOptions {
  allowedOrigins: string[];
  archiveUrl?: string;
  now?: () => Date;
}

export function createCnisRegistryTableSource(
  options: CnisRegistryTableSourceOptions,
): CnisRegistryTableSource {
  const requestedUrl = options.archiveUrl ?? defaultArchiveUrl;
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
  const now = options.now ?? (() => new Date());
  return {
    requestedUrl,
    captureByModel: (input) => captureRegistryRow(input, requestedUrl, allowedOrigins, now),
  };
}

async function captureRegistryRow(
  rawInput: CnisRegistryRowCaptureInput,
  requestedUrl: string,
  allowedOrigins: ReadonlySet<string>,
  now: () => Date,
): Promise<TableRegionCapture> {
  const input = cnisRegistryRowCaptureInputSchema.parse(rawInput);
  try {
    const download = await downloadArchive(requestedUrl, input.maximumArchiveBytes, allowedOrigins);
    const workbook = await extractYearWorkbook(download.content, input.year);
    const region = await selectRegistryRegion(workbook.content, input);
    return tableRegionCaptureSchema.parse({
      requestedUrl,
      finalUrl: download.finalUrl,
      observedAt: now().toISOString(),
      httpValidation: download.httpValidation,
      content: region.content,
      locator: {
        kind: "table_region",
        sourceDocumentSha256: createHash("sha256").update(workbook.content).digest("hex"),
        sheet,
        headerRange: region.headerRange,
        cellRange: region.cellRange,
        rowIdentity: input.productModel,
      },
    });
  } catch (error) {
    if (error instanceof SourceAccessError) throw error;
    throw new SourceAccessError(
      "source_abnormal",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function downloadArchive(
  requestedUrl: string,
  maximumBytes: number,
  allowedOrigins: ReadonlySet<string>,
) {
  assertAllowedOrigin(requestedUrl, allowedOrigins);
  let captured: { content: Buffer; finalUrl: string; httpValidation: { status: number; etag?: string; lastModified?: string } } | undefined;
  let finalFailure: Error | undefined;
  // WHY：CNIS 错把 RAR 标为 text/plain，强制 buffer 后仍由 libarchive 真正验证格式。
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new HttpCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    maxRequestsPerCrawl: 1,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 30,
    additionalMimeTypes: ["application/x-rar-compressed", "application/octet-stream", "text/plain"],
    preNavigationHooks: [(_context, requestOptions) => {
      requestOptions.responseType = "buffer";
    }],
    async requestHandler({ body, request, response }) {
      const finalUrl = request.loadedUrl ?? request.url;
      assertAllowedOrigin(finalUrl, allowedOrigins);
      if (typeof body === "string") throw new SourceAccessError("source_abnormal", "RAR 来源被错误解码为文本");
      if (body.byteLength > maximumBytes) throw new SourceAccessError("source_abnormal", "RAR 超过来源访问字节上限");
      if (!response.statusCode) throw new SourceAccessError("source_abnormal", "RAR 响应缺少 HTTP 状态码");
      captured = {
        content: body,
        finalUrl,
        httpValidation: {
          status: response.statusCode,
          etag: firstHeader(response.headers.etag),
          lastModified: firstHeader(response.headers["last-modified"]),
        },
      };
    },
    failedRequestHandler(_context, error) {
      finalFailure = error instanceof Error ? error : new Error(String(error));
    },
  }, config);
  try {
    await crawler.run([requestedUrl]);
    if (captured) return captured;
    if (finalFailure instanceof SourceAccessError) throw finalFailure;
    throw new SourceAccessError("source_abnormal", finalFailure?.message ?? "RAR 下载未产出内容");
  } finally {
    await crawler.teardown();
    await config.getStorageClient().teardown?.();
  }
}

async function extractYearWorkbook(archive: Uint8Array, year: number) {
  const module = await libarchiveWasm();
  const reader = new ArchiveReader(module, new Int8Array(archive));
  const suffix = `家用电冰箱2015版标准 （${year}年1月-12月）.xlsx`;
  const matches: Array<{ path: string; content: Uint8Array }> = [];
  try {
    for (const entry of reader.entries()) {
      const pathname = entry.getPathname();
      if (pathname.endsWith(suffix)) {
        const content = entry.readData();
        if (!content) throw new SourceAccessError("source_abnormal", "目标工作簿没有可读取内容");
        matches.push({ path: pathname, content: new Uint8Array(content) });
      }
    }
  } finally {
    reader.free();
  }
  if (matches.length === 0) throw new SourceAccessError("evidence_not_found", `RAR 中没有 ${year} 年工作簿`);
  if (matches.length !== 1) throw new SourceAccessError("source_abnormal", `${year} 年工作簿不唯一`);
  return matches[0]!;
}

async function selectRegistryRegion(
  workbook: Uint8Array,
  input: CnisRegistryRowCaptureInput,
) {
  const rows = await readSheet(Buffer.from(workbook), sheet);
  const headerMatches = rows.flatMap((row, index) =>
    expectedHeader.every((value, column) => row[column] === value)
      ? [{ row: row.slice(0, 7), rowNumber: index + 1 }]
      : [],
  );
  const rowMatches = rows.flatMap((row, index) =>
    String(row[4] ?? "") === input.productModel
      ? [{ row: row.slice(0, 7), rowNumber: index + 1 }]
      : [],
  );
  if (rowMatches.length === 0) throw new SourceAccessError("evidence_not_found", `监管表中没有型号：${input.productModel}`);
  if (headerMatches.length !== 1 || rowMatches.length !== 1) {
    throw new SourceAccessError("source_abnormal", "监管表头或型号行不唯一");
  }
  const content = JSON.stringify({ header: headerMatches[0]!.row, row: rowMatches[0]!.row });
  if (new TextEncoder().encode(content).byteLength > input.maximumEvidenceBytes) {
    throw new SourceAccessError("source_abnormal", "监管表最小区域超过证据字节上限");
  }
  return {
    content,
    headerRange: `A${headerMatches[0]!.rowNumber}:G${headerMatches[0]!.rowNumber}`,
    cellRange: `A${rowMatches[0]!.rowNumber}:G${rowMatches[0]!.rowNumber}`,
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
  if (url.protocol !== "https:") throw new SourceAccessError("origin_not_allowed", "公开来源只允许 HTTPS");
  return url.origin;
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
