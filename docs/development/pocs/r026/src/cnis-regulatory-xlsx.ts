import { createHash } from "node:crypto";

import { Configuration, LogLevel } from "@crawlee/core";
import { HttpCrawler } from "@crawlee/http";
import { ArchiveReader, libarchiveWasm } from "libarchive-wasm";
import { readSheet } from "read-excel-file/node";

const sourceUrl = "https://www.cnis.ac.cn/tzgg/202412/P020241231788865667216.rar";
const targetWorkbookSuffix = "家用电冰箱2015版标准 （2023年1月-12月）.xlsx";
const targetModel = process.argv[2] === "missing" ? "MODEL-THAT-DOES-NOT-EXIST" : "MR-457WUSPZE";
const allowedOrigins = new Set(["https://www.cnis.ac.cn"]);
let archive: Buffer | undefined;
let access: Record<string, unknown> | undefined;
let finalFailure: Error | undefined;
const config = new Configuration({ persistStorage: false, purgeOnStart: false, logLevel: LogLevel.WARNING });
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
    assertAllowed(finalUrl);
    if (typeof body === "string") throw new Error("RAR 来源被错误解码为文本响应");
    if (body.byteLength > 10 * 1024 * 1024) throw new Error("RAR 超过 POC 字节上限");
    archive = body;
    access = { status: response.statusCode, finalUrl };
  },
  failedRequestHandler(_context, error) {
    finalFailure = error instanceof Error ? error : new Error(String(error));
  },
}, config);

assertAllowed(sourceUrl);
try {
  await crawler.run([sourceUrl]);
  if (!archive || !access) throw finalFailure ?? new Error("RAR POC 未下载来源");
} finally {
  await crawler.teardown();
  await config.getStorageClient().teardown?.();
}

const archiveSha256 = createHash("sha256").update(archive).digest("hex");
const module = await libarchiveWasm();
const reader = new ArchiveReader(module, new Int8Array(archive));
let workbook: Uint8Array | undefined;
let workbookPath: string | undefined;
let entryCount = 0;
let workbookCount = 0;
try {
  for (const entry of reader.entries()) {
    entryCount += 1;
    const pathname = entry.getPathname();
    if (pathname.endsWith(".xlsx")) workbookCount += 1;
    if (pathname.endsWith(targetWorkbookSuffix)) {
      workbook = new Uint8Array(entry.readData());
      workbookPath = pathname;
    }
  }
} finally {
  reader.free();
}
if (!workbook || !workbookPath) throw new Error("RAR 中没有目标年度工作簿");

const rows = await readSheet(Buffer.from(workbook), "结果");
if (process.argv[2] === "inspect") {
  console.log(JSON.stringify({ rows: rows.slice(0, 12).map((row, index) => ({ rowNumber: index + 1, row })) }));
  process.exit(0);
}
const matches = rows.flatMap((row, index) =>
  String(row[4] ?? "") === targetModel ? [{ row, rowNumber: index + 1 }] : [],
);
if (process.argv[2] === "missing") {
  console.log(JSON.stringify({ state: "failed", code: "evidence_not_found", matchCount: matches.length }));
  process.exit(0);
}
if (matches.length !== 1) throw new Error(`监管型号行必须唯一，实际 ${matches.length} 行`);
const expectedHeader = ["序号", "国家标准", "大类名称", "生产者名称", "规格型号", "备案号", "能效等级"];
const headerMatches = rows.flatMap((row, index) =>
  expectedHeader.every((value, column) => row[column] === value)
    ? [{ header: row.slice(0, 7), rowNumber: index + 1 }]
    : [],
);
if (headerMatches.length !== 1) throw new Error(`监管表头必须唯一，实际 ${headerMatches.length} 行`);
const header = headerMatches[0]!.header;
const row = matches[0]!.row.slice(0, 7);
if (!header || header.length !== 7 || row.length !== 7) throw new Error("监管表缺少七列原始区域");
const content = JSON.stringify({ header, row });
console.log(JSON.stringify({
  state: "accessible",
  ...access,
  archiveBytes: archive.byteLength,
  archiveSha256,
  entryCount,
  workbookCount,
  workbookPath,
  workbookBytes: workbook.byteLength,
  workbookSha256: createHash("sha256").update(workbook).digest("hex"),
  sheet: "结果",
  headerRange: `A${headerMatches[0]!.rowNumber}:G${headerMatches[0]!.rowNumber}`,
  cellRange: `A${matches[0]!.rowNumber}:G${matches[0]!.rowNumber}`,
  rowIdentity: targetModel,
  contentBytes: new TextEncoder().encode(content).byteLength,
  contentSha256: createHash("sha256").update(content).digest("hex"),
  content,
  fullSourcePersisted: false,
}));

function assertAllowed(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !allowedOrigins.has(url.origin)) {
    throw new Error(`来源 origin 未获 POC 允许：${url.origin}`);
  }
}
