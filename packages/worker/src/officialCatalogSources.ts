import { CheerioCrawler } from "@crawlee/cheerio";
import { HttpCrawler } from "@crawlee/http";
import {
  officialCatalogSnapshotSchema,
  type OfficialCatalogEntry,
  type OfficialCatalogSnapshot,
} from "@domain-analysis/shared";
import { z } from "zod";

import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import { SourceAccessError } from "./sourceAccessError";

const haierCatalogUrl = "https://www.haier.com/cooling/";
const haierApiUrl = "https://www.haier.com/igs/front/cn_product/getProduct";
const leaderCatalogUrl = "https://www.leader.com.cn/cooling/";
const leaderApiUrl = "https://www.leader.com.cn/igs/front/leader_product/getProduct";
const mideaCatalogUrl = "https://www.midea.cn/s/search/search.html?category_id=10008";
const mideaApiUrl = "https://www.midea.cn/next/item_search/searchsku";
const tclCatalogUrl = "https://www.tcl.com/cn/zh/refrigerators";

const haierPageSchema = z.object({
  page: z.object({
    data: z.array(z.object({
      metaDataId: z.number().int(),
      modelno: z.string().min(1),
      docPubUrl: z.string().min(1),
      psale: z.coerce.string(),
    }).passthrough()),
    total: z.coerce.number().int().nonnegative(),
    totalPage: z.coerce.number().int().positive(),
  }).passthrough(),
}).passthrough();

const mideaPageSchema = z.object({
  errcode: z.number().int(),
  data: z.object({
    total: z.number().int().nonnegative(),
    vecSkuInfoList: z.array(z.object({
      lSkuId: z.number().int(),
      lCategoryId: z.number().int(),
      nOnSale: z.number().int(),
      nModel: z.string().min(1),
      strBrandName: z.string().min(1),
      strLink: z.string().url(),
    }).passthrough()),
  }).passthrough(),
}).passthrough();

const tclCatalogSchema = z.object({
  allProducts: z.array(z.object({
    classField: z.object({
      productSet: z.array(z.object({
        productDataPath: z.string().min(1),
        productInfo: z.object({
          productPage: z.string().min(1),
          productTitle: z.string(),
          bannerDesc: z.string(),
          hideInProductList: z.boolean().optional().default(false),
        }).passthrough(),
      }).passthrough()),
    }).passthrough(),
  }).passthrough()),
}).passthrough();

interface CatalogPage {
  declaredItemCount: number;
  totalPages: number;
  fetchedItemCount: number;
  entries: OfficialCatalogEntry[];
}

type CatalogPageLoader = (url: string, page: number) => Promise<unknown>;
type CatalogPropertyLoader = () => Promise<string>;

export interface OfficialCatalogSource {
  enumerate(): Promise<OfficialCatalogSnapshot>;
}

interface OfficialCatalogSourceOptions {
  allowedOrigins: string[];
  now?: () => Date;
  pageLoader?: CatalogPageLoader;
  propertyLoader?: CatalogPropertyLoader;
}

export function createHaierOfficialCatalogSource(
  options: OfficialCatalogSourceOptions,
): OfficialCatalogSource {
  return {
    enumerate: () => enumerateCatalog({
      sourceId: "haier-cn-refrigerator-catalog",
      sourceIdentity: "haier-cn-official-catalog",
      coverageKind: "independent_brand_catalog",
      catalogUrl: haierCatalogUrl,
      apiOrigin: new URL(haierApiUrl).origin,
      allowedOrigins: options.allowedOrigins,
      now: options.now,
      pageLoader: options.pageLoader,
      makePageUrl: createHaierPageUrl,
      parsePage: parseHaierPage,
    }),
  };
}

export function createLeaderOfficialCatalogSource(
  options: OfficialCatalogSourceOptions,
): OfficialCatalogSource {
  return {
    enumerate: () => enumerateCatalog({
      sourceId: "leader-cn-refrigerator-catalog",
      sourceIdentity: "leader-cn-official-catalog",
      coverageKind: "independent_brand_catalog",
      catalogUrl: leaderCatalogUrl,
      apiOrigin: new URL(leaderApiUrl).origin,
      allowedOrigins: options.allowedOrigins,
      now: options.now,
      pageLoader: options.pageLoader,
      makePageUrl: createLeaderPageUrl,
      parsePage: parseLeaderPage,
    }),
  };
}

export function createMideaOfficialCatalogSource(
  options: OfficialCatalogSourceOptions,
): OfficialCatalogSource {
  return {
    enumerate: () => enumerateCatalog({
      sourceId: "midea-cn-refrigerator-catalog",
      sourceIdentity: "midea-cn-official-mall",
      coverageKind: "multi_brand_official_catalog",
      catalogUrl: mideaCatalogUrl,
      apiOrigin: new URL(mideaApiUrl).origin,
      allowedOrigins: options.allowedOrigins,
      now: options.now,
      pageLoader: options.pageLoader,
      makePageUrl: createMideaPageUrl,
      parsePage: parseMideaPage,
    }),
  };
}

export function createTclOfficialCatalogSource(
  options: OfficialCatalogSourceOptions,
): OfficialCatalogSource {
  return {
    enumerate: async () => {
      assertAllowed(tclCatalogUrl, options.allowedOrigins);
      const property = options.propertyLoader
        ? await options.propertyLoader()
        : await crawlTclCatalogProperty(options.allowedOrigins);
      const entries = parseTclCatalogEntries(property);
      return officialCatalogSnapshotSchema.parse({
        sourceId: "tcl-cn-refrigerator-catalog",
        sourceIdentity: "tcl-cn-official-catalog",
        sourceAuthorityType: "brand_official_site",
        coverageKind: "independent_brand_catalog",
        catalogUrl: tclCatalogUrl,
        observedAt: (options.now ?? (() => new Date()))().toISOString(),
        declaredItemCount: entries.length,
        fetchedItemCount: entries.length,
        acceptedItemCount: entries.length,
        coverageStatus: "complete",
        entries,
      });
    },
  };
}

interface EnumerateCatalogOptions {
  sourceId: string;
  sourceIdentity: string;
  coverageKind: "independent_brand_catalog" | "multi_brand_official_catalog";
  catalogUrl: string;
  apiOrigin: string;
  allowedOrigins: string[];
  now?: () => Date;
  pageLoader?: CatalogPageLoader;
  makePageUrl(page: number): string;
  parsePage(value: unknown): CatalogPage;
}

async function enumerateCatalog(options: EnumerateCatalogOptions): Promise<OfficialCatalogSnapshot> {
  assertAllowed(options.apiOrigin, options.allowedOrigins);
  const pages = options.pageLoader
    ? await loadFixturePages(options.makePageUrl, options.parsePage, options.pageLoader)
    : await crawlJsonPages(options.makePageUrl, options.parsePage, options.allowedOrigins);
  const first = pages[0]!;
  const fetchedItemCount = pages.reduce((sum, page) => sum + page.fetchedItemCount, 0);
  const entries = pages.flatMap((page) => page.entries);
  if (fetchedItemCount !== first.declaredItemCount) {
    throw new SourceAccessError(
      "source_abnormal",
      `官方目录声明 ${first.declaredItemCount} 行，实际读取 ${fetchedItemCount} 行`,
    );
  }
  return officialCatalogSnapshotSchema.parse({
    sourceId: options.sourceId,
    sourceIdentity: options.sourceIdentity,
    sourceAuthorityType: "brand_official_site",
    coverageKind: options.coverageKind,
    catalogUrl: options.catalogUrl,
    observedAt: (options.now ?? (() => new Date()))().toISOString(),
    declaredItemCount: first.declaredItemCount,
    fetchedItemCount,
    acceptedItemCount: entries.length,
    coverageStatus: "complete",
    entries,
  });
}

async function loadFixturePages(
  makePageUrl: (page: number) => string,
  parsePage: (value: unknown) => CatalogPage,
  loader: CatalogPageLoader,
) {
  const first = parsePage(await loader(makePageUrl(1), 1));
  const pages = [first];
  for (let page = 2; page <= first.totalPages; page += 1) {
    pages.push(parsePage(await loader(makePageUrl(page), page)));
  }
  return pages;
}

async function crawlJsonPages(
  makePageUrl: (page: number) => string,
  parsePage: (value: unknown) => CatalogPage,
  allowedOrigins: string[],
) {
  const pages = new Map<number, CatalogPage>();
  let failure: Error | undefined;
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new HttpCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    maxRequestsPerCrawl: 100,
    // WHY：美的官方接口返回 JSON 字节但声明 text/plain；允许该 MIME 后仍由 Zod 校验真实结构。
    additionalMimeTypes: ["text/plain"],
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 30,
    async requestHandler({ addRequests, body, contentType, json, request }) {
      assertAllowed(request.loadedUrl ?? request.url, allowedOrigins);
      const pageNumber = z.number().int().positive().parse(request.userData.page);
      const page = parsePage(json ?? JSON.parse(
        typeof body === "string" ? body : body.toString(contentType.encoding),
      ));
      pages.set(pageNumber, page);
      if (pageNumber === 1 && page.totalPages > 1) {
        await addRequests(Array.from({ length: page.totalPages - 1 }, (_, index) => ({
          url: makePageUrl(index + 2),
          userData: { page: index + 2 },
        })));
      }
    },
    failedRequestHandler(_context, error) {
      failure = error instanceof Error ? error : new Error(String(error));
    },
  }, config);

  try {
    await crawler.run([{ url: makePageUrl(1), userData: { page: 1 } }]);
    if (failure instanceof SourceAccessError) throw failure;
    if (failure) throw new SourceAccessError("source_abnormal", failure.message);
    const first = pages.get(1);
    if (!first || pages.size !== first.totalPages) {
      throw new SourceAccessError("source_abnormal", "官方目录分页读取不完整");
    }
    return [...pages.entries()].sort(([left], [right]) => left - right).map(([, page]) => page);
  } finally {
    await crawler.teardown();
    await config.getStorageClient().teardown?.();
  }
}

async function crawlTclCatalogProperty(allowedOrigins: string[]) {
  let property: string | undefined;
  let failure: Error | undefined;
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new CheerioCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 30,
    async requestHandler({ $, request }) {
      assertAllowed(request.loadedUrl ?? request.url, allowedOrigins);
      property = $("#product-product-list-root").attr("property");
      if (!property) throw new SourceAccessError("source_abnormal", "TCL 官方目录缺少产品数据");
    },
    failedRequestHandler(_context, error) {
      failure = error instanceof Error ? error : new Error(String(error));
    },
  }, config);
  try {
    await crawler.run([tclCatalogUrl]);
    if (property) return property;
    if (failure instanceof SourceAccessError) throw failure;
    throw new SourceAccessError("source_abnormal", failure?.message ?? "TCL 官方目录访问未产出数据");
  } finally {
    await crawler.teardown();
    await config.getStorageClient().teardown?.();
  }
}

function parseTclCatalogEntries(property: string): OfficialCatalogEntry[] {
  const products = tclCatalogSchema.parse(JSON.parse(property)).allProducts;
  return products.flatMap((group) => group.classField.productSet).filter((item) =>
    !item.productInfo.hideInProductList).map((item) => ({
    brand: "TCL",
    manufacturerModel: findTclManufacturerModel(item.productInfo, item.productDataPath),
    sourceItemId: item.productDataPath,
    sourceUrl: new URL(item.productInfo.productPage, tclCatalogUrl).toString(),
  }));
}

function findTclManufacturerModel(
  product: { bannerDesc: string; productTitle: string; productPage: string },
  productDataPath: string,
) {
  const pattern = /\b(?:BCD-)?(?:[A-Z]+\d|\d)[A-Z0-9]*(?:-[A-Z0-9]+)+\b/g;
  for (const text of [product.bannerDesc, product.productTitle]) {
    const matches = text.toUpperCase().match(pattern);
    if (matches?.length) return matches.sort((left, right) => right.length - left.length)[0]!;
  }
  const slug = product.productPage.split("/").filter(Boolean).at(-1)
    ?? productDataPath.split("/").filter(Boolean).at(-2);
  if (!slug) throw new SourceAccessError("source_abnormal", `TCL 产品缺少型号 identity：${productDataPath}`);
  // TRADE-OFF：仅在官方标题/banner 未给出完整串时使用同一官方详情页 slug；不读取卖家标题。
  return slug.toUpperCase();
}

function parseHaierPage(value: unknown): CatalogPage {
  const page = haierPageSchema.parse(value).page;
  const activeRows = page.data.filter((row) => row.psale === "0");
  return {
    declaredItemCount: page.total,
    totalPages: page.totalPage,
    fetchedItemCount: page.data.length,
    entries: activeRows.map((row) => ({
      brand: "海尔",
      manufacturerModel: row.modelno.trim(),
      sourceItemId: String(row.metaDataId),
      sourceUrl: new URL(row.docPubUrl, "https://www.haier.com").toString(),
    })),
  };
}

function parseLeaderPage(value: unknown): CatalogPage {
  const page = haierPageSchema.parse(value).page;
  const activeRows = page.data.filter((row) => row.psale === "0");
  return {
    declaredItemCount: page.total,
    totalPages: page.totalPage,
    fetchedItemCount: page.data.length,
    entries: activeRows.map((row) => ({
      brand: "统帅",
      manufacturerModel: row.modelno.trim(),
      sourceItemId: String(row.metaDataId),
      sourceUrl: new URL(row.docPubUrl, "https://www.leader.com.cn").toString(),
    })),
  };
}

function parseMideaPage(value: unknown): CatalogPage {
  const response = mideaPageSchema.parse(value);
  if (response.errcode !== 0) throw new SourceAccessError("source_abnormal", `美的目录错误码：${response.errcode}`);
  const rows = response.data.vecSkuInfoList;
  const refrigerators = rows.filter((row) => row.lCategoryId === 1 && row.nOnSale === 1);
  return {
    declaredItemCount: response.data.total,
    totalPages: Math.max(1, Math.ceil(response.data.total / 20)),
    fetchedItemCount: rows.length,
    entries: refrigerators.map((row) => ({
      brand: row.strBrandName.trim(),
      manufacturerModel: row.nModel.trim(),
      sourceItemId: String(row.lSkuId),
      sourceUrl: row.strLink,
    })),
  };
}

function createHaierPageUrl(page: number) {
  const url = new URL(haierApiUrl);
  const search = "(channelId=38345) and (psale=0)";
  url.search = new URLSearchParams({
    code: "3e6bff6304c547dba650d9941aa472c0",
    searchWord: search,
    pageNo: String(page),
    pageSize: "18",
    siteId: "2",
    filterJsonUrl: "https://www.haier.com/cn/cooling/filter_es.json",
    orderBy: "hotProduct:desc,saleProduct:desc,productWt:desc,productAllWt:desc",
    defaultSearch: search,
    retFilterJson: "yes",
    searchColumns: "productShowLabel,productBigClassName,productClassName",
  }).toString();
  return url.toString();
}

function createLeaderPageUrl(page: number) {
  const url = new URL(leaderApiUrl);
  const search = "(channelId=41824) and (psale=0)";
  url.search = new URLSearchParams({
    code: "50fc4d3a07844238b4cad0ee303618fa",
    searchWord: search,
    pageNo: String(page),
    pageSize: "100",
    siteId: "20",
    filterJsonUrl: `${leaderCatalogUrl}filter_es.json`,
    orderBy: "price:desc,hotSale:desc,psale_time:desc,productViewNumber:desc",
    defaultSearch: search,
    retFilterJson: "yes",
    searchColumns: "appFile,proSalePoint,docPubUrl,specifications,promoteUrls,chnlDesc",
  }).toString();
  return url.toString();
}

function createMideaPageUrl(page: number) {
  const url = new URL(mideaApiUrl);
  url.search = new URLSearchParams({
    scene_type: "2",
    scene: "6",
    category_id: "10008",
    pageno: String(page),
    pagesize: "20",
  }).toString();
  return url.toString();
}

function assertAllowed(value: string, allowedOrigins: string[]) {
  const url = new URL(value);
  const allowed = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  if (url.protocol !== "https:" || !allowed.has(url.origin)) {
    throw new SourceAccessError("origin_not_allowed", `来源 origin 未获本地配置允许：${url.origin}`);
  }
}
