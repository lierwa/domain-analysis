import { HttpCrawler } from "@crawlee/http";
import {
  officialCatalogSnapshotSchema,
  type OfficialCatalogEntry,
} from "@domain-analysis/shared";
import { z } from "zod";

import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import type { OfficialCatalogSource } from "./officialCatalogSources";
import { SourceAccessError } from "./sourceAccessError";

const catalogUrl = "https://www.siemens-home.bsh-group.cn/productlist/product-frist-level.html?name=冰箱&groupId=26";
const apiUrl = "https://www.siemens-home.bsh-group.cn/bsh-product/product-official/getProductOfficialList";
const pageSize = 100;
const pageSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.object({
    total: z.number().int().nonnegative(),
    rows: z.array(z.object({
      vib: z.string().min(1),
      name: z.string().min(1),
      isOnSale: z.coerce.string(),
      groupId: z.coerce.string(),
      goodId: z.number().int().optional(),
    }).passthrough()),
  }).passthrough(),
}).passthrough();

type Page = z.infer<typeof pageSchema>;
type PageLoader = (page: number) => Promise<unknown>;

export interface SiemensOfficialCatalogSourceOptions {
  allowedOrigins: string[];
  now?: () => Date;
  pageLoader?: PageLoader;
}

export function createSiemensOfficialCatalogSource(
  options: SiemensOfficialCatalogSourceOptions,
): OfficialCatalogSource {
  return {
    enumerate: async () => {
      assertAllowed(apiUrl, options.allowedOrigins);
      const pages = options.pageLoader
        ? await loadPages(options.pageLoader)
        : await crawlPages(options.allowedOrigins);
      const first = pages[0]!;
      const rows = pages.flatMap((page) => page.data.rows);
      if (rows.length !== first.data.total) {
        throw new SourceAccessError(
          "source_abnormal",
          `西门子官方在售目录声明 ${first.data.total} 行，实际读取 ${rows.length} 行`,
        );
      }
      const entries = rows.filter(isRefrigerator).map(toEntry);
      return officialCatalogSnapshotSchema.parse({
        sourceId: "siemens-cn-refrigerator-catalog",
        sourceIdentity: "siemens-cn-official-onsale-catalog",
        sourceAuthorityType: "brand_official_site",
        coverageKind: "independent_brand_catalog",
        catalogUrl,
        observedAt: (options.now ?? (() => new Date()))().toISOString(),
        declaredItemCount: first.data.total,
        fetchedItemCount: rows.length,
        acceptedItemCount: entries.length,
        coverageStatus: "complete",
        entries,
      });
    },
  };
}

async function loadPages(loader: PageLoader) {
  const first = parsePage(await loader(1), 1);
  const pages = [first];
  const totalPages = Math.max(1, Math.ceil(first.data.total / pageSize));
  for (let page = 2; page <= totalPages; page += 1) pages.push(parsePage(await loader(page), page));
  return pages;
}

async function crawlPages(allowedOrigins: string[]) {
  const pages = new Map<number, Page>();
  let failure: Error | undefined;
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new HttpCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    maxRequestsPerCrawl: 20,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 30,
    async requestHandler({ addRequests, body, contentType, json, request }) {
      assertAllowed(request.loadedUrl ?? request.url, allowedOrigins);
      const pageNumber = z.number().int().positive().parse(request.userData.page);
      const page = parsePage(json ?? JSON.parse(
        typeof body === "string" ? body : body.toString(contentType.encoding),
      ), pageNumber);
      pages.set(pageNumber, page);
      if (pageNumber === 1) {
        const totalPages = Math.max(1, Math.ceil(page.data.total / pageSize));
        await addRequests(Array.from({ length: totalPages - 1 }, (_, index) => requestFor(index + 2)));
      }
    },
    failedRequestHandler(_context, error) {
      failure = error instanceof Error ? error : new Error(String(error));
    },
  }, config);
  try {
    await crawler.run([requestFor(1)]);
    if (failure instanceof SourceAccessError) throw failure;
    if (failure) throw new SourceAccessError("source_abnormal", failure.message);
    const first = pages.get(1);
    const totalPages = first ? Math.max(1, Math.ceil(first.data.total / pageSize)) : 0;
    if (!first || pages.size !== totalPages) {
      throw new SourceAccessError("source_abnormal", "西门子官方在售目录分页读取不完整");
    }
    return [...pages.entries()].sort(([left], [right]) => left - right).map(([, page]) => page);
  } finally {
    await crawler.teardown();
    await config.getStorageClient().teardown?.();
  }
}

function requestFor(page: number) {
  return {
    url: apiUrl,
    uniqueKey: `${apiUrl}?page=${page}`,
    method: "POST" as const,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      origin: new URL(catalogUrl).origin,
      referer: new URL(catalogUrl).toString(),
    },
    payload: JSON.stringify({
      currentPage: page,
      pageSize,
      brandId: "A02",
      classId: "26",
      serialValue: "",
      filtrateValue: [],
      isOnSale: 1,
      newProduct: "",
      seriesSort: "",
      salesStartSort: "",
    }),
    userData: { page },
  };
}

function parsePage(value: unknown, page: number) {
  const parsed = pageSchema.parse(value);
  if (parsed.code !== 0 || parsed.data.rows.some((row) => row.isOnSale !== "1")) {
    throw new SourceAccessError("source_abnormal", `西门子官方在售目录第 ${page} 页响应异常：${parsed.message}`);
  }
  return parsed;
}

function isRefrigerator(row: Page["data"]["rows"][number]) {
  // WHY：官网冰箱一级类目同时含酒柜和独立冷冻箱；保留冷藏箱，但排除两个明确的非冰箱子类。
  return row.groupId !== "6" && !/冷冻箱|wine cooler|酒柜/i.test(row.name);
}

function toEntry(row: Page["data"]["rows"][number]): OfficialCatalogEntry {
  const manufacturerModel = row.vib.trim().toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(manufacturerModel)) {
    throw new SourceAccessError("source_abnormal", `西门子官方条目缺少型号 identity：${row.vib}`);
  }
  const url = new URL("/productlist/product-detail.html", catalogUrl);
  url.searchParams.set("vib", row.vib);
  if (row.goodId) url.searchParams.set("goodId", String(row.goodId));
  return { brand: "西门子", manufacturerModel, sourceItemId: row.vib, sourceUrl: url.toString() };
}

function assertAllowed(value: string, allowedOrigins: string[]) {
  const url = new URL(value);
  const allowed = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  if (url.protocol !== "https:" || !allowed.has(url.origin)) {
    throw new SourceAccessError("origin_not_allowed", `来源 origin 未获本地配置允许：${url.origin}`);
  }
}
