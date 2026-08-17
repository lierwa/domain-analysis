import { createHash } from "node:crypto";

import { Configuration, LogLevel } from "@crawlee/core";
import { HttpCrawler } from "@crawlee/http";
import sharp from "sharp";

const sourceUrl = "https://image.haier.com/cn/cooling/W020241126359088762136_1200.png";
const productPageUrl = "https://www.haier.com/cooling/20241126_252875.shtml";
const allowedOrigins = new Set(["https://image.haier.com"]);
let result: Record<string, unknown> | undefined;
let finalFailure: Error | undefined;
const config = new Configuration({ persistStorage: false, purgeOnStart: false, logLevel: LogLevel.WARNING });
const crawler = new HttpCrawler({
  maxConcurrency: 1,
  maxRequestRetries: 2,
  maxRequestsPerCrawl: 1,
  navigationTimeoutSecs: 30,
  requestHandlerTimeoutSecs: 30,
  additionalMimeTypes: ["image/png", "image/webp"],
  async requestHandler({ body, contentType, request, response }) {
    const finalUrl = request.loadedUrl ?? request.url;
    assertAllowed(finalUrl);
    if (typeof body === "string") throw new Error("图片来源被错误解码为文本响应");
    if (!new Set(["image/png", "image/webp"]).has(contentType.type)) {
      throw new Error(`来源不是允许的图片格式：${contentType.type}`);
    }
    if (body.byteLength > 20 * 1024 * 1024) throw new Error("图片超过 POC 字节上限");
    const metadata = await sharp(body).metadata();
    if (!metadata.width || !metadata.height || `image/${metadata.format}` !== contentType.type) {
      throw new Error("响应 MIME 与 sharp 解码格式不一致");
    }
    result = {
      state: "accessible",
      status: response.statusCode,
      finalUrl,
      mediaType: contentType.type,
      bytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      xywh: { unit: "pixel", x: 0, y: 0, width: metadata.width, height: metadata.height },
      fullSourcePersisted: false,
    };
  },
  failedRequestHandler(_context, error) {
    finalFailure = error instanceof Error ? error : new Error(String(error));
  },
}, config);

assertAllowed(sourceUrl);
try {
  await crawler.run([{
    url: sourceUrl,
    headers: {
      referer: productPageUrl,
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  }]);
  if (!result) throw finalFailure ?? new Error("图片 POC 未产出结果");
  console.log(JSON.stringify(result));
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
