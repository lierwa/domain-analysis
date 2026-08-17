import { HttpCrawler } from "@crawlee/http";
import {
  officialCatalogSnapshotSchema,
  type OfficialCatalogEntry,
} from "@domain-analysis/shared";

import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import type { OfficialCatalogSource } from "./officialCatalogSources";
import { SourceAccessError } from "./sourceAccessError";

const catalogUrl = "https://www.rsdgroup.com.cn/product_list.asp?keyno=319&p_id=231";

export interface RoyalstarOfficialChannelSourceOptions {
  allowedOrigins: string[];
  now?: () => Date;
  htmlLoader?: () => Promise<string>;
}

export function createRoyalstarOfficialChannelSource(
  options: RoyalstarOfficialChannelSourceOptions,
): OfficialCatalogSource {
  return {
    enumerate: async () => {
      assertAllowed(catalogUrl, options.allowedOrigins);
      const html = options.htmlLoader ? await options.htmlLoader() : await crawlCatalog(options.allowedOrigins);
      const { declaredItemCount, entries } = parseCatalog(html);
      return officialCatalogSnapshotSchema.parse({
        sourceId: "royalstar-group-cn-refrigerator-discovery",
        sourceIdentity: "royalstar-group-cn-official-product-center",
        sourceAuthorityType: "brand_official_site",
        coverageKind: "official_channel_discovery",
        catalogUrl,
        observedAt: (options.now ?? (() => new Date()))().toISOString(),
        declaredItemCount,
        fetchedItemCount: entries.length,
        acceptedItemCount: entries.length,
        coverageStatus: "partial",
        entries,
      });
    },
  };
}

async function crawlCatalog(allowedOrigins: string[]) {
  let html: string | undefined;
  let failure: Error | undefined;
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new HttpCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    maxRequestsPerCrawl: 1,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 30,
    async requestHandler({ body, request }) {
      assertAllowed(request.loadedUrl ?? request.url, allowedOrigins);
      // WHY：该 HttpCrawler 路径给出原始 Buffer；直接用 Node 标准解码器处理已知 GB18030，避免错误转码后再解析。
      html = typeof body === "string" ? body : new TextDecoder("gb18030").decode(body);
    },
    failedRequestHandler(_context, error) {
      failure = error instanceof Error ? error : new Error(String(error));
    },
  }, config);
  try {
    await crawler.run([catalogUrl]);
    if (failure) throw new SourceAccessError("source_abnormal", failure.message);
    if (!html) throw new SourceAccessError("source_abnormal", "荣事达官网产品中心未返回正文");
    return html;
  } finally {
    await crawler.teardown();
    await config.getStorageClient().teardown?.();
  }
}

function parseCatalog(html: string) {
  const declaredItemCount = Number(html.match(/共(\d+)条信息/)?.[1]);
  const entries = [...html.matchAll(
    /<a\s+href=["']view\.aspx?\?prono=(\d+)["'][^>]*>[\s\S]*?<a\s+href=["']view\.aspx?\?prono=\1["'][^>]*>\s*([^<]+?)\s*<\/a>/gi,
  )].map((match): OfficialCatalogEntry => {
    const sourceItemId = match[1]!;
    const manufacturerModel = match[2]!.trim().toUpperCase();
    if (!/^BCD-[A-Z0-9()/-]+$/.test(manufacturerModel)) {
      throw new SourceAccessError("source_abnormal", `荣事达官网条目缺少冰箱型号 identity：${sourceItemId}`);
    }
    return {
      brand: "荣事达",
      manufacturerModel,
      sourceItemId,
      sourceUrl: new URL(`/view.aspx?prono=${sourceItemId}`, catalogUrl).toString(),
    };
  });
  if (!Number.isInteger(declaredItemCount) || declaredItemCount < 1 || entries.length !== declaredItemCount) {
    throw new SourceAccessError(
      "source_abnormal",
      `荣事达官网产品中心声明 ${declaredItemCount || 0} 行，实际读取 ${entries.length} 行`,
    );
  }
  return { declaredItemCount, entries };
}

function assertAllowed(value: string, allowedOrigins: string[]) {
  const url = new URL(value);
  const allowed = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  if (url.protocol !== "https:" || !allowed.has(url.origin)) {
    throw new SourceAccessError("origin_not_allowed", `来源 origin 未获本地配置允许：${url.origin}`);
  }
}
