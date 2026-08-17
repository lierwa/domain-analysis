import { CheerioCrawler } from "@crawlee/cheerio";
import {
  officialCatalogSnapshotSchema,
  type OfficialCatalogEntry,
} from "@domain-analysis/shared";

import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import type { OfficialCatalogSource } from "./officialCatalogSources";
import { SourceAccessError } from "./sourceAccessError";

const catalogUrl = "https://www.konka.com/list.html?cat_id=28";

export interface KonkaFrestecOfficialCatalogSourceOptions {
  allowedOrigins: string[];
  now?: () => Date;
  htmlLoader?: (url: string) => Promise<string>;
}

export function createKonkaFrestecOfficialCatalogSource(
  options: KonkaFrestecOfficialCatalogSourceOptions,
): OfficialCatalogSource {
  return {
    enumerate: async () => {
      assertAllowed(catalogUrl, options.allowedOrigins);
      const result = options.htmlLoader
        ? await loadCatalog(options.htmlLoader, options.allowedOrigins)
        : await crawlCatalog(options.allowedOrigins);
      const entries = result.entries.filter((entry) => entry.manufacturerModel.startsWith("BCD-"));
      return officialCatalogSnapshotSchema.parse({
        sourceId: "konka-group-cn-refrigerator-catalog",
        sourceIdentity: "konka-group-cn-official-catalog",
        sourceAuthorityType: "brand_official_site",
        coverageKind: "multi_brand_official_catalog",
        catalogUrl,
        observedAt: (options.now ?? (() => new Date()))().toISOString(),
        declaredItemCount: result.declaredItemCount,
        fetchedItemCount: result.fetchedItemCount,
        acceptedItemCount: entries.length,
        coverageStatus: "complete",
        entries,
      });
    },
  };
}

async function loadCatalog(loader: (url: string) => Promise<string>, allowedOrigins: string[]) {
  const productUrls = parseCatalogPage(await loader(catalogUrl));
  const entries: OfficialCatalogEntry[] = [];
  for (const sourceUrl of productUrls) {
    assertAllowed(sourceUrl, allowedOrigins);
    entries.push(parseProductPage(await loader(sourceUrl), sourceUrl));
  }
  return { declaredItemCount: productUrls.length, fetchedItemCount: productUrls.length, entries };
}

async function crawlCatalog(allowedOrigins: string[]) {
  let productUrls: string[] = [];
  let fetchedItemCount = 0;
  const entries: OfficialCatalogEntry[] = [];
  let failure: Error | undefined;
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new CheerioCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    maxRequestsPerCrawl: 20,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 30,
    async requestHandler({ $, addRequests, request }) {
      assertAllowed(request.loadedUrl ?? request.url, allowedOrigins);
      if (request.userData.kind === "catalog") {
        productUrls = $(".goods-list a[href]").map((_index, element) => $(element).attr("href"))
          .get().filter((href): href is string => /\/item-\d+\.html$/.test(href))
          .map((href) => new URL(href, catalogUrl).toString());
        productUrls = [...new Set(productUrls)];
        if (!productUrls.length) throw new SourceAccessError("source_abnormal", "康佳集团冰箱目录缺少商品详情链接");
        await addRequests(productUrls.map((url) => ({ url, userData: { kind: "product" } })));
        return;
      }
      fetchedItemCount += 1;
      entries.push(parseProductPage($.html(), request.loadedUrl ?? request.url));
    },
    failedRequestHandler(_context, error) {
      failure = error instanceof Error ? error : new Error(String(error));
    },
  }, config);
  try {
    await crawler.run([{ url: catalogUrl, userData: { kind: "catalog" } }]);
    if (failure instanceof SourceAccessError) throw failure;
    if (failure) throw new SourceAccessError("source_abnormal", failure.message);
    if (productUrls.length !== fetchedItemCount) {
      throw new SourceAccessError(
        "source_abnormal",
        `康佳集团冰箱目录发现 ${productUrls.length} 个详情，实际读取 ${fetchedItemCount} 个`,
      );
    }
    return { declaredItemCount: productUrls.length, fetchedItemCount, entries };
  } finally {
    await crawler.teardown();
    await config.getStorageClient().teardown?.();
  }
}

function parseCatalogPage(html: string) {
  const scopedHtml = html.match(/<div[^>]+class=["'][^"']*goods-list[^"']*["'][^>]*>([\s\S]*?)<script/i)?.[1] ?? html;
  const urls = [...scopedHtml.matchAll(/href=["']([^"']*\/item-\d+\.html)["']/gi)]
    .map((match) => new URL(match[1]!, catalogUrl).toString());
  const unique = [...new Set(urls)];
  if (!unique.length) throw new SourceAccessError("source_abnormal", "康佳集团冰箱目录缺少商品详情链接");
  return unique;
}

function parseProductPage(html: string, sourceUrl: string): OfficialCatalogEntry {
  if (!/"marketable":"true"/.test(html)) {
    throw new SourceAccessError("source_abnormal", `康佳集团商品不是当前可展示状态：${sourceUrl}`);
  }
  const brandValue = html.match(/\\u54c1\\u724c":"([^"]+)"/)?.[1];
  const modelValue = html.match(/\\u578b\\u53f7":"([^"]+)"/)?.[1];
  const brand = decodeJsonString(brandValue);
  const manufacturerModel = decodeJsonString(modelValue).toUpperCase();
  const sourceItemId = new URL(sourceUrl).pathname.match(/\/item-(\d+)\.html/)?.[1];
  if (!sourceItemId || !manufacturerModel || !/^(?:BCD-|BD\/BC-)[A-Z0-9/-]+$/.test(manufacturerModel)) {
    throw new SourceAccessError("source_abnormal", `康佳集团商品缺少型号 identity：${sourceUrl}`);
  }
  if (brand !== "新飞" && brand !== "KONKA") {
    throw new SourceAccessError("source_abnormal", `康佳集团商品缺少品牌 identity：${sourceUrl}`);
  }
  // WHY：只按官方参数中的品牌字段归一显示名，不从标题缺省推断品牌。
  return { brand: brand === "KONKA" ? "康佳" : brand, manufacturerModel, sourceItemId, sourceUrl };
}

function decodeJsonString(value: string | undefined) {
  if (!value) return "";
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    throw new SourceAccessError("source_abnormal", "康佳集团商品参数不是合法 JSON 字符串");
  }
}

function assertAllowed(value: string, allowedOrigins: string[]) {
  const url = new URL(value);
  const allowed = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  if (url.protocol !== "https:" || !allowed.has(url.origin)) {
    throw new SourceAccessError("origin_not_allowed", `来源 origin 未获本地配置允许：${url.origin}`);
  }
}
