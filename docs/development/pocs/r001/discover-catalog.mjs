import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SitemapRequestList } from "crawlee";
import { z } from "zod";

import { writeImmutableJson } from "../lib/poc-artifact.mjs";

if (Number(process.versions.node.split(".")[0]) !== 22) {
  throw new Error("R-001 必须在 Node 22 下运行");
}

const SITEMAP_INDEX_URL = "https://www.haier.com/cn/sitemap.xml";
const SITEMAP_URL = "https://www.haier.com/cn/sitemap/product.xml";
const PRODUCT_URL_PATTERN = /^https:\/\/www\.haier\.com\/cooling\/\d{8}_\d+\.shtml$/;
const snapshotSchema = z
  .object({
    schemaVersion: z.literal("r001-catalog-discovery-v1"),
    source: z.literal("haier_official_sitemap"),
    sourceKind: z.literal("brand_official_catalog"),
    category: z.literal("refrigerator"),
    sitemapIndexUrl: z.string().url(),
    sitemapUrl: z.string().url(),
    robotsUrl: z.string().url(),
    urlPattern: z.string().min(1),
    discoveredAt: z.string().datetime(),
    sitemapFullyLoaded: z.literal(true),
    count: z.number().int().positive(),
    urls: z.array(z.string().url()).min(1),
  })
  .strict()
  .superRefine(({ count, urls }, context) => {
    if (count !== urls.length || new Set(urls).size !== urls.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "目录数量与唯一 URL 不一致" });
    }
  });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const localRoot = path.join(projectRoot, "data/pocs/r001");
  process.env.CRAWLEE_STORAGE_DIR = path.join(localRoot, "crawlee-patchright");
  process.env.CRAWLEE_PURGE_ON_START = "false";

  const attemptId = new Date().toISOString().replaceAll(":", "-");
  const outputRoot = path.join(localRoot, "catalog-attempts", attemptId);
  await mkdir(outputRoot, { recursive: true });

  // WHY：直接复用 Crawlee 的 sitemap index、嵌套 sitemap 和 URL 过滤能力，不维护 XML 解析器。
  const requestList = await SitemapRequestList.open({
    sitemapUrls: [SITEMAP_URL],
    regexps: [PRODUCT_URL_PATTERN],
    timeoutMillis: 120_000,
    persistenceOptions: { enable: false },
  });
  const urls = await collectUrls(requestList);
  const snapshot = snapshotSchema.parse({
    schemaVersion: "r001-catalog-discovery-v1",
    source: "haier_official_sitemap",
    sourceKind: "brand_official_catalog",
    category: "refrigerator",
    sitemapIndexUrl: SITEMAP_INDEX_URL,
    sitemapUrl: SITEMAP_URL,
    robotsUrl: "https://www.haier.com/robots.txt",
    urlPattern: PRODUCT_URL_PATTERN.source,
    discoveredAt: new Date().toISOString(),
    sitemapFullyLoaded: requestList.isSitemapFullyLoaded(),
    count: urls.length,
    urls,
  });
  const artifact = await writeImmutableJson(path.join(outputRoot, "catalog.json"), snapshot);
  console.log(JSON.stringify({ attemptId, count: snapshot.count, artifact }, null, 2));
}

async function collectUrls(requestList) {
  const urls = [];
  for await (const request of requestList) {
    urls.push(request.url);
    await requestList.markRequestHandled(request);
  }
  return urls.sort();
}
