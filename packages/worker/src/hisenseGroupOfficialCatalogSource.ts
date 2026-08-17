import { CheerioCrawler } from "@crawlee/cheerio";
import {
  officialCatalogSnapshotSchema,
  type OfficialCatalogEntry,
} from "@domain-analysis/shared";

import type { OfficialCatalogSource } from "./officialCatalogSources";
import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import { SourceAccessError } from "./sourceAccessError";

const catalogUrl = "https://www.hisense.com/productcat/54.html";

export interface HisenseGroupOfficialCatalogSourceOptions {
  allowedOrigins: string[];
  now?: () => Date;
  htmlLoader?: (url: string) => Promise<string>;
}

export function createHisenseGroupOfficialCatalogSource(
  options: HisenseGroupOfficialCatalogSourceOptions,
): OfficialCatalogSource {
  return {
    enumerate: async () => {
      assertAllowed(catalogUrl, options.allowedOrigins);
      const result = options.htmlLoader
        ? await loadCatalog(options.htmlLoader, options.allowedOrigins)
        : await crawlCatalog(options.allowedOrigins);
      return officialCatalogSnapshotSchema.parse({
        sourceId: "hisense-group-cn-refrigerator-catalog",
        sourceIdentity: "hisense-group-cn-official-catalog",
        sourceAuthorityType: "brand_official_site",
        coverageKind: "multi_brand_official_catalog",
        catalogUrl,
        observedAt: (options.now ?? (() => new Date()))().toISOString(),
        declaredItemCount: result.declaredItemCount,
        fetchedItemCount: result.fetchedItemCount,
        acceptedItemCount: result.entries.length,
        coverageStatus: result.entries.length === result.declaredItemCount ? "complete" : "partial",
        entries: result.entries,
      });
    },
  };
}

async function loadCatalog(loader: (url: string) => Promise<string>, allowedOrigins: string[]) {
  const catalog = parseCatalogPage(await loader(catalogUrl));
  const entries: OfficialCatalogEntry[] = [];
  for (const sourceUrl of catalog.productUrls) {
    assertAllowed(sourceUrl, allowedOrigins);
    const entry = parseProductPage(await loader(sourceUrl), sourceUrl);
    if (entry) entries.push(entry);
  }
  return { declaredItemCount: catalog.declaredItemCount, fetchedItemCount: catalog.productUrls.length, entries };
}

async function crawlCatalog(allowedOrigins: string[]) {
  let declaredText: string | undefined;
  let productUrls: string[] = [];
  let fetchedItemCount = 0;
  const documents: Array<{ identityText: string; sourceUrl: string }> = [];
  let failure: Error | undefined;
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new CheerioCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    maxRequestsPerCrawl: 100,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 30,
    async requestHandler({ $, addRequests, request }) {
      assertAllowed(request.loadedUrl ?? request.url, allowedOrigins);
      if (request.userData.kind === "catalog") {
        declaredText = $(".mo-filter-total").first().text() || $(".product-filter .total").first().text();
        productUrls = [...new Set($("a[href]").map((_index, element) => $(element).attr("href"))
          .get().filter((href): href is string => /\/product\/\d+\.html$/.test(href))
          .map((href) => new URL(href, catalogUrl).toString()))];
        await addRequests(productUrls.map((url) => ({ url, userData: { kind: "product" } })));
        return;
      }
      fetchedItemCount += 1;
      documents.push({
        identityText: [$("title").text(), $('meta[name="keywords"]').attr("content"),
          $('meta[name="description"]').attr("content"), $("h1.fs-32.title").text()]
          .filter((value): value is string => Boolean(value)).join(" "),
        sourceUrl: request.loadedUrl ?? request.url,
      });
    },
    failedRequestHandler(_context, error) {
      failure = error instanceof Error ? error : new Error(String(error));
    },
  }, config);
  try {
    await crawler.run([{ url: catalogUrl, userData: { kind: "catalog" } }]);
    if (failure instanceof SourceAccessError) throw failure;
    if (failure) throw new SourceAccessError("source_abnormal", failure.message);
    const declaredItemCount = parseDeclaredCount(declaredText ?? "");
    if (productUrls.length !== declaredItemCount || fetchedItemCount !== declaredItemCount) {
      throw new SourceAccessError("source_abnormal", "海信集团官方目录声明数、详情链接和实际读取数不一致");
    }
    const entries = documents.map(({ identityText, sourceUrl }) => parseIdentity(identityText, sourceUrl))
      .filter((entry): entry is OfficialCatalogEntry => Boolean(entry));
    return { declaredItemCount, fetchedItemCount, entries };
  } finally {
    await crawler.teardown();
    await config.getStorageClient().teardown?.();
  }
}

function parseCatalogPage(html: string) {
  const declaredItemCount = parseDeclaredCount(html);
  const productUrls = [...new Set([...html.matchAll(/href=["']([^"']*\/product\/\d+\.html)["']/g)]
    .map((match) => new URL(match[1]!, catalogUrl).toString()))];
  if (productUrls.length !== declaredItemCount) {
    throw new SourceAccessError(
      "source_abnormal",
      `海信集团官方目录声明 ${declaredItemCount} 个产品，只发现 ${productUrls.length} 个详情链接`,
    );
  }
  return { declaredItemCount, productUrls };
}

function parseProductPage(html: string, sourceUrl: string) {
  // WHY：只接受 title/meta/主标题中的显式型号；图片文件名不足以单独确认厂商型号 identity。
  const identityText = [html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1],
    html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<h1[^>]*class=["'][^"']*fs-32[^"']*title[^"']*["'][^>]*>([^<]+)<\/h1>/i)?.[1]]
    .filter((value): value is string => Boolean(value)).join(" ");
  return parseIdentity(identityText, sourceUrl);
}

function parseDeclaredCount(value: string) {
  const declared = value.match(/共找到\s*(\d+)\s*个产品/);
  if (!declared) throw new SourceAccessError("source_abnormal", "海信集团官方目录缺少声明产品数");
  return Number(declared[1]);
}

function parseIdentity(identityText: string, sourceUrl: string): OfficialCatalogEntry | undefined {
  const manufacturerModel = identityText.toUpperCase().match(/\bBCD-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/)?.[0];
  if (!manufacturerModel) return undefined;
  const brand = identityText.includes("容声") ? "容声" : identityText.includes("海信") ? "海信" : undefined;
  if (!brand) throw new SourceAccessError("source_abnormal", `海信集团详情页缺少品牌 identity：${sourceUrl}`);
  const sourceItemId = new URL(sourceUrl).pathname.match(/\/product\/(\d+)\.html/)?.[1];
  if (!sourceItemId) throw new SourceAccessError("source_abnormal", `海信集团详情 URL 缺少产品 identity：${sourceUrl}`);
  return { brand, manufacturerModel, sourceItemId, sourceUrl };
}

function assertAllowed(value: string, allowedOrigins: string[]) {
  const url = new URL(value);
  const allowed = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  if (url.protocol !== "https:" || !allowed.has(url.origin)) {
    throw new SourceAccessError("origin_not_allowed", `来源 origin 未获本地配置允许：${url.origin}`);
  }
}
