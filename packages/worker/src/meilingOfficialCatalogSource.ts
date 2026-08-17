import { HttpCrawler } from "@crawlee/http";
import {
  officialCatalogSnapshotSchema,
  type OfficialCatalogEntry,
} from "@domain-analysis/shared";
import { z } from "zod";

import type { OfficialCatalogSource } from "./officialCatalogSources";
import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import { SourceAccessError } from "./sourceAccessError";

const catalogUrl = "https://www.meiling.com/meiling/pages/product.html#/";
const apiUrl = "https://mlmall.meiling.com/mall/sku/getSkuListByColumnCondition.do";
const pageSize = 20;
const pageSchema = z.object({
  resultCode: z.string(),
  resultMsg: z.string(),
  basePageObj: z.object({
    currentPage: z.number().int().positive(),
    totalPages: z.number().int().positive(),
    totalRows: z.number().int().nonnegative(),
    hasNextPage: z.boolean(),
    dataList: z.array(z.object({
      id: z.number().int().positive(),
      skucode: z.string().min(1),
      skuname: z.string().min(1),
      isonline: z.string(),
    }).passthrough()),
  }).passthrough(),
}).passthrough();

type PageLoader = (page: number) => Promise<unknown>;

export interface MeilingOfficialCatalogSourceOptions {
  allowedOrigins: string[];
  now?: () => Date;
  pageLoader?: PageLoader;
}

export function createMeilingOfficialCatalogSource(
  options: MeilingOfficialCatalogSourceOptions,
): OfficialCatalogSource {
  return {
    enumerate: async () => {
      assertAllowed(apiUrl, options.allowedOrigins);
      const pages = options.pageLoader
        ? await loadPages(options.pageLoader)
        : await crawlPages(options.allowedOrigins);
      const first = pages[0]!;
      const rows = pages.flatMap((page) => page.basePageObj.dataList);
      if (rows.length !== first.basePageObj.totalRows) {
        throw new SourceAccessError(
          "source_abnormal",
          `美菱官方目录声明 ${first.basePageObj.totalRows} 行，实际读取 ${rows.length} 行`,
        );
      }
      const entries = rows.filter((row) => row.isonline === "Y").map(toEntry);
      return officialCatalogSnapshotSchema.parse({
        sourceId: "meiling-cn-refrigerator-catalog",
        sourceIdentity: "meiling-cn-official-mall",
        sourceAuthorityType: "brand_official_site",
        coverageKind: "independent_brand_catalog",
        catalogUrl,
        observedAt: (options.now ?? (() => new Date()))().toISOString(),
        declaredItemCount: first.basePageObj.totalRows,
        fetchedItemCount: rows.length,
        acceptedItemCount: entries.length,
        coverageStatus: entries.length === first.basePageObj.totalRows ? "complete" : "partial",
        entries,
      });
    },
  };
}

async function loadPages(loader: PageLoader) {
  const first = parsePage(await loader(1), 1);
  const pages = [first];
  for (let page = 2; page <= first.basePageObj.totalPages; page += 1) {
    pages.push(parsePage(await loader(page), page));
  }
  return pages;
}

async function crawlPages(allowedOrigins: string[]) {
  const pages = new Map<number, z.infer<typeof pageSchema>>();
  let failure: Error | undefined;
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new HttpCrawler({
    // WHY：美菱官方接口实际返回 JSON，但响应头使用非标准 text/json；Crawlee 官方允许显式追加 MIME。
    additionalMimeTypes: ["text/json"],
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
        await addRequests(Array.from({ length: page.basePageObj.totalPages - 1 }, (_, index) => requestFor(index + 2)));
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
    if (!first || pages.size !== first.basePageObj.totalPages) {
      throw new SourceAccessError("source_abnormal", "美菱官方目录分页读取不完整");
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
    uniqueKey: `${apiUrl}?columnId=721&page=${page}`,
    method: "POST" as const,
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    payload: new URLSearchParams({ pageNo: String(page), pageSize: String(pageSize), columnId: "721" }).toString(),
    userData: { page },
  };
}

function parsePage(value: unknown, expectedPage: number) {
  const page = pageSchema.parse(value);
  if (page.resultCode !== "1" || page.basePageObj.currentPage !== expectedPage) {
    throw new SourceAccessError("source_abnormal", `美菱官方目录分页响应异常：${page.resultMsg}`);
  }
  return page;
}

function toEntry(row: z.infer<typeof pageSchema>["basePageObj"]["dataList"][number]): OfficialCatalogEntry {
  // WHY：商城明确以 skuname 首段表达厂商型号；统一 Unicode 破折号，不补写页面没有声明的 BCD 前缀。
  const manufacturerModel = row.skuname.match(/^[A-Za-z0-9()—-]+/)?.[0]?.replaceAll("—", "-");
  if (!manufacturerModel) throw new SourceAccessError("source_abnormal", `美菱 SKU 缺少型号 identity：${row.id}`);
  return {
    brand: "美菱",
    manufacturerModel,
    sourceItemId: String(row.id),
    sourceUrl: `https://www.meiling.com/meiling/pages/classify.html#/details/${row.skucode}`,
  };
}

function assertAllowed(value: string, allowedOrigins: string[]) {
  const url = new URL(value);
  const allowed = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  if (url.protocol !== "https:" || !allowed.has(url.origin)) {
    throw new SourceAccessError("origin_not_allowed", `来源 origin 未获本地配置允许：${url.origin}`);
  }
}
