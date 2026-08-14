import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FileDownload, RequestQueue } from "crawlee";
import { fileTypeFromFile } from "file-type";
import { z } from "zod";

import { fileSourceDefinitions } from "./file-source-definitions.mjs";
import { writeImmutableJson } from "../lib/poc-artifact.mjs";

if (Number(process.versions.node.split(".")[0]) !== 22) {
  throw new Error("R-001 必须在 Node 22 下运行");
}

const metadataSchema = z
  .object({
    schemaVersion: z.literal("r001-file-snapshot-v1"),
    id: z.string(),
    sourceKind: z.string(),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url(),
    status: z.number().int(),
    declaredContentType: z.string(),
    detectedType: z.object({ ext: z.string(), mime: z.string() }).strict(),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    filename: z.string(),
    privacyClass: z.literal("public"),
    usagePolicy: z.enum(["research_source", "lookup_only"]),
    discovery: z.object({ url: z.string().url(), locator: z.string(), label: z.string() }).strict(),
    capturedAt: z.string().datetime(),
  })
  .strict();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

async function main() {
  const requestedIds = new Set(process.argv.slice(2));
  const sources = requestedIds.size
    ? fileSourceDefinitions.filter(({ id }) => requestedIds.has(id))
    : fileSourceDefinitions;
  if (!sources.length) throw new Error("没有匹配的文件样本");

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const localRoot = path.join(projectRoot, "data/pocs/r001");
  process.env.CRAWLEE_STORAGE_DIR = path.join(localRoot, "crawlee-patchright");
  process.env.CRAWLEE_PURGE_ON_START = "false";

  const revision = "file-snapshots-v3";
  const attemptId = new Date().toISOString().replaceAll(":", "-");
  const outputRoot = path.join(localRoot, "file-attempts", attemptId);
  await mkdir(outputRoot, { recursive: true });

  const queue = await RequestQueue.open(`r001-${revision}`);
  for (const source of sources) {
    await queue.addRequest({
      url: source.url,
      uniqueKey: `r001:${revision}:${source.id}`,
      userData: { sourceId: source.id },
    });
  }

  const sourceById = new Map(fileSourceDefinitions.map((source) => [source.id, source]));
  const results = [];
  const crawler = new FileDownload({
    requestQueue: queue,
    maxConcurrency: 1,
    maxRequestRetries: 0,
    navigationTimeoutSecs: 120,
    statisticsOptions: { id: `r001-${revision}` },
    streamHandler: (context) => captureFile(context, { sourceById, outputRoot, results }),
    async failedRequestHandler({ request }) {
      results.push({
        id: request.userData.sourceId,
        state: "request_failed",
        errors: request.errorMessages,
      });
    },
  });

  await crawler.run();
  await writeImmutableJson(path.join(outputRoot, "run.json"), results);
  console.log(JSON.stringify({ attemptId, results }, null, 2));
}

async function captureFile({ stream, request, response }, { sourceById, outputRoot, results }) {
  const source = sourceById.get(request.userData.sourceId);
  if (!source) throw new Error(`未知文件来源：${request.userData.sourceId}`);

  const directory = path.join(outputRoot, source.id);
  await mkdir(directory);
  const partialPath = path.join(directory, `${source.filename}.partial`);
  const finalPath = path.join(directory, source.filename);
  const hash = createHash("sha256");

  // WHY：复用 Crawlee FileDownload 传输；这里只做有上限的流式哈希和不可变落盘。
  await pipeline(
    stream,
    createHashAndLimitTransform(hash, source.maxBytes),
    createWriteStream(partialPath, { flags: "wx" }),
  );
  const detectedType = await fileTypeFromFile(partialPath);
  assertExpectedFileType(detectedType, source.expectedType);
  const fileStat = await stat(partialPath);
  await rename(partialPath, finalPath);

  const metadata = metadataSchema.parse({
    schemaVersion: "r001-file-snapshot-v1",
    id: source.id,
    sourceKind: source.sourceKind,
    requestedUrl: source.url,
    finalUrl: response.url ?? request.loadedUrl ?? request.url,
    status: response.statusCode,
    declaredContentType: String(response.headers["content-type"] ?? "unknown").split(";")[0],
    detectedType,
    bytes: fileStat.size,
    sha256: hash.digest("hex"),
    filename: source.filename,
    privacyClass: source.privacyClass,
    usagePolicy: source.usagePolicy,
    discovery: source.discovery,
    capturedAt: new Date().toISOString(),
  });
  await writeImmutableJson(path.join(directory, "metadata.json"), metadata);
  results.push(metadata);
}

function createHashAndLimitTransform(hash, maxBytes) {
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) return callback(new Error(`文件超过上限：${maxBytes} bytes`));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

export function assertExpectedFileType(detectedType, expectedType) {
  if (detectedType?.ext !== expectedType.ext || detectedType?.mime !== expectedType.mime) {
    throw new Error(
      `文件类型不符：期望 ${expectedType.ext}/${expectedType.mime}，实际 ${detectedType?.ext ?? "unknown"}/${detectedType?.mime ?? "unknown"}`,
    );
  }
}
