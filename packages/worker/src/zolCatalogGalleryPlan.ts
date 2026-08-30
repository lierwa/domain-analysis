import type { CrawlPlanSource } from "@domain-analysis/shared";

import { assertPublicHttpsUrl } from "./publicNetworkPolicy";

export const zolCatalogGalleryProviderKey = "zol.catalog-gallery";
export const zolCatalogGalleryProviderVersion = "1.2.0";

export function validateZolCatalogGallerySource(source: CrawlPlanSource) {
  const configuration = zolCatalogGalleryConfiguration(source);
  if (source.provider.key !== zolCatalogGalleryProviderKey
    || source.provider.version !== zolCatalogGalleryProviderVersion) {
    throw new Error(`ZOL 品牌目录与图集 Provider 必须是 ${zolCatalogGalleryProviderKey}@${zolCatalogGalleryProviderVersion}`);
  }
  const expectedModelCount = configuration.brandCatalogUrls.length * configuration.targetModelsPerBrand;
  if (source.targets.length !== 1 || source.targets[0]!.quantity.mode !== "target_count"
    || source.targets[0]!.quantity.targetCount !== expectedModelCount) {
    throw new Error(`ZOL 批次必须只有一个 target，且 target_count=${expectedModelCount} 个型号`);
  }
  const entries = source.entryUrls.map((value) => assertPublicHttpsUrl(value).href).sort();
  const catalogs = configuration.brandCatalogUrls.map((value) => value.href).sort();
  if (entries.length !== catalogs.length || entries.some((entry, index) => entry !== catalogs[index])) {
    throw new Error("ZOL 批次入口必须恰好对应计划中的品牌目录");
  }
  const assetPolicy = source.accessPolicy.assetPolicy;
  if (source.accessPolicy.maxRequestsPerMinute > 12 || source.accessPolicy.minimumIntervalMs < 5_000
    || !assetPolicy || assetPolicy.maxRequestsPerMinute > 30 || assetPolicy.minimumIntervalMs < 2_000
    || assetPolicy.concurrency > 2 || assetPolicy.queueCapacity < assetPolicy.concurrency) {
    throw new Error("ZOL 批次必须使用已验证的 HTML 与图片独立有界调度策略");
  }
  if (source.stopPolicy.requestBudget < expectedModelCount * 10) {
    throw new Error("ZOL 批次请求预算不能小于目标型号数的 10 倍");
  }
  if (!source.rawOutputPolicy.retainAssets
    || !["html", "text", "image"].every((format) => source.rawOutputPolicy.formats.includes(format as "html"))) {
    throw new Error("ZOL 批次必须保存 HTML、文本和图片原始附件");
  }
}

export function zolCatalogGalleryConfiguration(source: CrawlPlanSource) {
  const values = Object.fromEntries(source.provider.configuration.map((item) => [item.key, item.value]));
  const keys = source.provider.configuration.map((item) => item.key).sort().join(",");
  if (keys !== "brand_batch_size,brand_catalog_urls,category_slug,maximum_catalog_pages,maximum_html_bytes,maximum_image_bytes,mode,model_batch_size,target_models_per_brand"
    || values.mode !== "zol_catalog_batch" || !Array.isArray(values.brand_catalog_urls)) {
    throw new Error("ZOL 批次 Provider 配置字段不完整");
  }
  const categorySlug = String(values.category_slug);
  const brandBatchSize = Number(values.brand_batch_size);
  const modelBatchSize = Number(values.model_batch_size);
  const targetModelsPerBrand = Number(values.target_models_per_brand);
  const maximumCatalogPages = Number(values.maximum_catalog_pages);
  const maximumHtmlBytes = Number(values.maximum_html_bytes);
  const maximumImageBytes = Number(values.maximum_image_bytes);
  const brandCatalogUrls = values.brand_catalog_urls.map(String).map((value) => assertPublicHttpsUrl(value));
  if (!/^[a-z][a-z0-9_-]+$/.test(categorySlug) || brandCatalogUrls.length < 1
    || !Number.isInteger(brandBatchSize) || brandBatchSize < 1 || brandBatchSize > 100
    || !Number.isInteger(modelBatchSize) || modelBatchSize < 1 || modelBatchSize > targetModelsPerBrand
    || !Number.isInteger(targetModelsPerBrand) || targetModelsPerBrand < 1 || targetModelsPerBrand > 100
    || !Number.isInteger(maximumCatalogPages) || maximumCatalogPages < 1 || maximumCatalogPages > 100
    || new Set(brandCatalogUrls.map(zolBrandKey)).size !== brandCatalogUrls.length
    || !Number.isInteger(maximumHtmlBytes) || maximumHtmlBytes < 100_000 || maximumHtmlBytes > 25_000_000
    || !Number.isInteger(maximumImageBytes) || maximumImageBytes < 100_000 || maximumImageBytes > 10_000_000) {
    throw new Error("ZOL 批次的品牌组、型号批次、目标数量、页数或字节上限无效");
  }
  for (const catalogUrl of brandCatalogUrls) {
    if (catalogUrl.origin !== "https://detail.zol.com.cn"
      || catalogUrl.pathname !== `/${categorySlug}/${zolBrandKey(catalogUrl)}/`
      || catalogUrl.search || catalogUrl.hash) {
      throw new Error(`ZOL 品牌目录与门类 slug 不一致：${catalogUrl.href}`);
    }
  }
  return { categorySlug, brandCatalogUrls, brandBatchSize, modelBatchSize, targetModelsPerBrand,
    maximumCatalogPages, maximumHtmlBytes, maximumImageBytes };
}

export function zolBrandKey(url: URL) {
  const key = url.pathname.split("/").filter(Boolean).at(-1);
  if (!key || !/^[a-z0-9-]+$/i.test(key)) throw new Error(`品牌目录 URL 无法形成稳定 key：${url.href}`);
  return key.toLowerCase();
}
