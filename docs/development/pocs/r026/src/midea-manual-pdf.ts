import { createHash } from "node:crypto";

import { Configuration, LogLevel } from "@crawlee/core";
import { HttpCrawler } from "@crawlee/http";
import { extractText } from "unpdf";

const sourceUrl =
  "https://dsdcp.smartmidea.net/mcsp/prod/20230803/6b0f37e5343a4abfba8c4a5274565d70.pdf";
const mode = process.argv[2] ?? "success";
const expectedModel = mode === "missing" ? "MODEL-THAT-DOES-NOT-EXIST" : "MR-457WUSPZE";
const allowedOrigins = new Set(["https://dsdcp.smartmidea.net"]);
const maximumSourceBytes = 4 * 1024 * 1024;
let result: Record<string, unknown> | undefined;
let finalFailure: Error | undefined;

const config = new Configuration({
  persistStorage: false,
  purgeOnStart: false,
  logLevel: LogLevel.WARNING,
});
const crawler = new HttpCrawler({
  maxConcurrency: 1,
  maxRequestRetries: 2,
  maxRequestsPerCrawl: 1,
  navigationTimeoutSecs: 30,
  requestHandlerTimeoutSecs: 30,
  additionalMimeTypes: ["application/pdf"],
  async requestHandler({ body, contentType, request, response }) {
    const finalUrl = request.loadedUrl ?? request.url;
    assertAllowed(finalUrl);
    if (contentType.type !== "application/pdf") throw new Error(`来源不是 PDF：${contentType.type}`);
    if (typeof body === "string") throw new Error("PDF 来源被错误解码为文本响应");
    if (body.byteLength > maximumSourceBytes) throw new Error("PDF 超过 POC 完整来源字节上限");

    const sourceDocumentSha256 = createHash("sha256").update(body).digest("hex");
    const { totalPages, text } = await extractText(new Uint8Array(body), { mergePages: false });
    const matchingPages = text.flatMap((pageText, index) =>
      pageText.includes(expectedModel) ? [{ page: index + 1, text: pageText }] : [],
    );
    if (mode === "inspect") {
      result = {
        state: "inspected",
        matchingPages: matchingPages.map(({ page, text }) => ({
          page,
          preview: text.replace(/\s+/g, " ").trim().slice(0, 500),
        })),
      };
      return;
    }
    const specificationPages = matchingPages.filter(({ text }) =>
      text.includes("年综合耗电量") && text.includes("外形尺寸"),
    );
    if (specificationPages.length !== 1) {
      throw new Error(`型号规格页必须唯一，实际 ${specificationPages.length} 页`);
    }
    const match = specificationPages[0]!;
    const excerptBytes = new TextEncoder().encode(match.text).byteLength;
    result = {
      state: "accessible",
      status: response.statusCode,
      finalUrl,
      contentType: contentType.type,
      sourceBytes: body.byteLength,
      sourceDocumentSha256,
      totalPages,
      page: match.page,
      excerptBytes,
      excerptSha256: createHash("sha256").update(match.text).digest("hex"),
      containsExpectedModel: match.text.includes(expectedModel),
      fullSourcePersisted: false,
    };
  },
  failedRequestHandler(_context, error) {
    finalFailure = error instanceof Error ? error : new Error(String(error));
  },
}, config);

assertAllowed(sourceUrl);
try {
  await crawler.run([sourceUrl]);
  if (!result) throw finalFailure ?? new Error("PDF POC 未产出结果");
  console.log(JSON.stringify(result));
} catch (error) {
  if (mode !== "missing") throw error;
  console.log(JSON.stringify({
    state: "failed",
    code: "evidence_not_found",
    message: error instanceof Error ? error.message : String(error),
  }));
} finally {
  await crawler.teardown();
  await config.getStorageClient().teardown?.();
}

function assertAllowed(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !allowedOrigins.has(url.origin)) {
    throw new Error(`来源 origin 未获 POC 允许：${url.origin}`);
  }
}
