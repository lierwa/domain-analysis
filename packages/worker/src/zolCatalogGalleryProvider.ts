import type {
  CrawlPlanSource,
  SourceProviderCollectionContext,
  SourceProviderEvent,
  SourceRequestAdmissionPort,
} from "@domain-analysis/shared";
import { SourceProviderFailure } from "@domain-analysis/shared";
import robotsParser from "robots-parser";

import { assertPublicHttpsUrl } from "./publicNetworkPolicy";
import {
  createPublicResourceTransport,
  preflightPublicResourceEnvironment,
  publicWebUserAgent,
  type PublicResourceTransportOptions,
  type RawPublicResponse,
} from "./publicResourceTransport";
import {
  isTransientPublicResourceFailure,
  requestPublicResourcePersistently as requestPersistently,
  type PublicResourceRequest,
} from "./publicResourceRetry";
import {
  captureEvent,
  inaccessible,
  supportingAssessment,
} from "./publicWebResourceContent";
import {
  parseZolCatalogPage,
  parseZolGalleryUrl,
  parseZolParameterPage,
  zolProductGroupId,
  type ZolModelEntry,
} from "./zolCatalogParsing";
import {
  assertZolImageUrl,
  parseZolGallerySections,
  parseZolPictureImages,
  type ZolGalleryImage,
} from "./zolGalleryParsing";
import { createZolImageDownloadQueue } from "./zolImageDownloadQueue";
import {
  validateZolCatalogGallerySource as validateSource,
  zolBrandKey as brandKey,
  zolCatalogGalleryConfiguration as providerConfiguration,
  zolCatalogGalleryProviderKey as providerKey,
  zolCatalogGalleryProviderVersion as providerVersion,
} from "./zolCatalogGalleryPlan";
const allowedImageTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
]);
export interface ZolCatalogGalleryProviderOptions {
  request?: PublicResourceRequest;
  now?: () => Date;
  transportOptions?: PublicResourceTransportOptions;
  environmentPreflight?: () => Promise<void>;
}
type RobotsPolicy = ReturnType<typeof robotsParser> | "blocked";
type BrandState = { key: string; catalogUrl: URL; models: ZolModelEntry[] };
type QueuedImage = { event?: SourceProviderEvent; modelWorkKey: string; failure?: unknown };
type PendingModel = { pendingImages: number; sealed: boolean; failureReason?: string };
type ZolCollectionContext = {
  source: CrawlPlanSource;
  runId: string;
  admission: SourceRequestAdmissionPort;
  targetKey: string;
  request: PublicResourceRequest;
  now: () => Date;
  signal: AbortSignal;
  configuration: ReturnType<typeof providerConfiguration>;
  robots: Map<string, RobotsPolicy>;
  completedWorkKeys: Set<string>;
  pendingModels: Map<string, PendingModel>;
  imageQueue: ReturnType<typeof createZolImageDownloadQueue<QueuedImage>>;
};
export function createZolCatalogGalleryProvider(options: ZolCatalogGalleryProviderOptions = {}) {
  const request = options.request ?? createPublicResourceTransport(options.transportOptions);
  const environmentPreflight = options.environmentPreflight
    ?? (() => preflightPublicResourceEnvironment(options.transportOptions));
  const now = options.now ?? (() => new Date());
  return {
    key: providerKey,
    version: providerVersion,
    validate: validateSource,
    async preflightEnvironment(sources: CrawlPlanSource[]) {
      for (const source of sources) validateSource(source);
      await environmentPreflight();
    },
    async preflight(source: CrawlPlanSource) { validateSource(source); },
    async *collect(source: CrawlPlanSource, runId: string, admission: SourceRequestAdmissionPort,
      signal?: AbortSignal, collectionContext?: SourceProviderCollectionContext): AsyncIterable<SourceProviderEvent> {
      const configuration = providerConfiguration(source);
      const runSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(source.accessPolicy.maximumRunMs)])
        : AbortSignal.timeout(source.accessPolicy.maximumRunMs);
      const assetPolicy = source.accessPolicy.assetPolicy!;
      const imageQueue = createZolImageDownloadQueue<QueuedImage>({ ...assetPolicy, signal: runSignal });
      yield* collectZolSource({ source, runId, admission, targetKey: source.targets[0]!.key,
        request, now, signal: runSignal, configuration, robots: new Map(), imageQueue,
        completedWorkKeys: new Set(collectionContext?.completedWorkKeys ?? []), pendingModels: new Map() });
    },
  };
}

async function* collectZolSource(context: ZolCollectionContext): AsyncGenerator<SourceProviderEvent> {
  let failure: unknown;
  let observedUnitCount = 0;
  try {
    if (!(yield* ensureOriginRobots(context, context.configuration.brandCatalogUrls[0]!.origin,
      "保存 ZOL 页面 origin 的 robots 原文"))) return;
    const catalogs = context.configuration.brandCatalogUrls;
    for (let brandOffset = 0; brandOffset < catalogs.length;
      brandOffset += context.configuration.brandBatchSize) {
      const group = catalogs.slice(brandOffset, brandOffset + context.configuration.brandBatchSize);
      const states: BrandState[] = [];
      for (const catalogUrl of group) {
        const state = yield* collectBrandStateSafely(context, catalogUrl);
        if (state) states.push(state);
      }
      for (let modelOffset = 0; modelOffset < context.configuration.targetModelsPerBrand;
        modelOffset += context.configuration.modelBatchSize) {
        const batchEnd = Math.min(modelOffset + context.configuration.modelBatchSize,
          context.configuration.targetModelsPerBrand);
        // WHY：品牌内保持目录顺序；同一型号 ordinal 先轮转品牌，避免大品牌长期占用执行机会。
        for (let modelIndex = modelOffset; modelIndex < batchEnd; modelIndex += 1) {
          for (const brand of states) {
            const model = brand.models[modelIndex];
            if (model) yield* collectModelSafely(context, brand, model);
          }
          yield* emitQueuedImages(context, context.imageQueue.takeReady());
        }
      }
      observedUnitCount += states.reduce((sum, state) => sum + state.models.length, 0);
    }
    yield* emitQueuedImages(context, await context.imageQueue.drain());
    yield { type: "target.completed", targetKey: context.targetKey,
      observedUnitCount };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await context.imageQueue.close(failure);
  }
}

async function* collectBrandStateSafely(context: ZolCollectionContext, catalogUrl: URL):
AsyncGenerator<SourceProviderEvent, BrandState | undefined> {
  try {
    return yield* collectBrandState(context, catalogUrl);
  } catch (error) {
    if (!isRecoverableModelFailure(error)) throw error;
    return undefined;
  }
}

async function* collectModelSafely(context: ZolCollectionContext, brand: BrandState, model: ZolModelEntry):
AsyncGenerator<SourceProviderEvent> {
  const workKey = modelWorkKey(brand, model);
  try {
    yield* collectModel(context, brand, model);
  } catch (error) {
    if (!isRecoverableModelFailure(error)) throw error;
    await markModelFailed(context, workKey, error);
  }
}

async function* ensureOriginRobots(context: ZolCollectionContext, origin: string, reason: string,
  requestLane?: "asset"):
AsyncGenerator<SourceProviderEvent, boolean> {
  if (context.robots.has(origin)) return context.robots.get(origin) !== "blocked";
  const result = await requestRobots({ ...context, origin,
    maximumBytes: context.configuration.maximumHtmlBytes, ...(requestLane ? { requestLane } : {}) });
  context.robots.set(origin, parseRobots(result.url, result.response));
  if (result.response.statusCode >= 200 && result.response.statusCode < 300) {
    yield captureEvent(context.source, context.targetKey, result.url, result.response, context.now(),
      supportingAssessment("robots_policy", reason),
      { workKey: `robots:${origin}`, discoveryKind: "planned_entry", depth: 0 });
  }
  return context.robots.get(origin) !== "blocked";
}

async function* collectBrandState(context: ZolCollectionContext, catalogUrl: URL):
AsyncGenerator<SourceProviderEvent, BrandState | undefined> {
  const key = brandKey(catalogUrl);
  const models = new Map<string, ZolModelEntry>();
  for (let page = 1; page <= context.configuration.maximumCatalogPages; page += 1) {
    const url = page === 1 ? catalogUrl : new URL(`${page}.html`, catalogUrl);
    if (!isAllowed(context.robots, url)) {
      yield inaccessible(context.targetKey, url, context.now(), "access_denied", "robots.txt 不允许品牌目录");
      return undefined;
    }
    const response = await requestPersistently({ ...context, workKey: `page:brand:${key}:${page}`,
      captureUnit: "zol_brand_catalog_page", url,
      maximumBytes: context.configuration.maximumHtmlBytes });
    const statusFailure = pageStatusFailure(response, `品牌 ${key} 目录第 ${page} 页`, "source");
    if (statusFailure) {
      yield inaccessible(context.targetKey, url, context.now(), observationState(response.statusCode),
        statusFailure.message, response.finalUrl ? new URL(response.finalUrl) : undefined,
        brandLineage(catalogUrl, key, page));
      throw statusFailure;
    }
    let facts: ReturnType<typeof parseZolCatalogPage>;
    try { facts = parseZolCatalogPage(response, url, page, context.configuration.categorySlug); } catch (error) {
      yield captureEvent(context.source, context.targetKey, url, response, context.now(),
        rejected("brand_catalog", bounded(error)), brandLineage(catalogUrl, key, page));
      throw structuralFailure(`品牌 ${key} 目录第 ${page} 页无法识别：${bounded(error)}`);
    }
    for (const model of facts.models) if (!models.has(model.id)) models.set(model.id, model);
    const exhausted = facts.pageCount != null && page >= facts.pageCount
      && models.size < context.configuration.targetModelsPerBrand;
    yield captureEvent(context.source, context.targetKey, url, response, context.now(),
      accepted("brand_catalog", `品牌 ${key} 目录第 ${page} 页识别 ${facts.models.length} 个型号，累计去重 ${models.size} 个${exhausted ? "，来源目录已穷尽" : ""}`),
      brandLineage(catalogUrl, key, page));
    if (models.size >= context.configuration.targetModelsPerBrand) {
      return { key, catalogUrl, models: [...models.values()].slice(0, context.configuration.targetModelsPerBrand) };
    }
    if (facts.pageCount != null && page >= facts.pageCount) break;
  }
  // WHY：每品牌上限是最大值，不是必须凑满的配额；公开目录不足时保存全部可识别型号并正常结束该品牌。
  return { key, catalogUrl, models: [...models.values()].slice(0, context.configuration.targetModelsPerBrand) };
}

async function* collectModel(context: ZolCollectionContext, brand: BrandState, model: ZolModelEntry):
AsyncGenerator<SourceProviderEvent> {
  const workKey = modelWorkKey(brand, model);
  if (context.completedWorkKeys.has(workKey)) return;
  await context.admission.ensureCaptureWorkItem({ runId: context.runId, targetKey: context.targetKey,
    workKey, parentObjectKey: model.id, captureUnit: "zol_model_bundle", expectedUnitCount: 1 });
  await context.admission.startCaptureWorkItem({ runId: context.runId, workKey });
  context.pendingModels.set(workKey, { pendingImages: 0, sealed: false });
  const parameterUrl = assertPublicHttpsUrl(
    `https://detail.zol.com.cn/${zolProductGroupId(model.id)}/${model.id}/param.shtml`,
  );
  const parameterResponse = await requestPersistently({ ...context, workKey: `page:param:${model.id}`,
    captureUnit: "zol_model_parameters", url: parameterUrl,
    maximumBytes: context.configuration.maximumHtmlBytes });
  const statusFailure = pageStatusFailure(parameterResponse, `型号 ${model.id} 参数页`, "model");
  if (statusFailure) {
    yield inaccessible(context.targetKey, parameterUrl, context.now(), observationState(parameterResponse.statusCode),
      statusFailure.message, parameterResponse.finalUrl ? new URL(parameterResponse.finalUrl) : undefined,
      parameterLineage(brand, model));
    throw statusFailure;
  }
  let galleryUrl: URL;
  try {
    parseZolParameterPage(parameterResponse, model.id);
    galleryUrl = parseZolGalleryUrl(parameterResponse, model.id);
  } catch (error) {
    yield captureEvent(context.source, context.targetKey, parameterUrl, parameterResponse, context.now(),
      rejected("parameter_or_gallery_link", bounded(error)), parameterLineage(brand, model));
    throw structuralFailure(`型号 ${model.id} 参数页或图集入口无法识别：${bounded(error)}`);
  }
  yield captureEvent(context.source, context.targetKey, parameterUrl, parameterResponse, context.now(),
    accepted("model_parameters", `型号 ${model.name} 参数页与图集入口已识别`), parameterLineage(brand, model));
  yield* collectGallery(context, brand, model, parameterUrl, galleryUrl, workKey);
  const pending = context.pendingModels.get(workKey)!;
  pending.sealed = true;
  await finishSettledModel(context, workKey);
}

async function* collectGallery(context: ZolCollectionContext, _brand: BrandState, model: ZolModelEntry,
  parameterUrl: URL, galleryUrl: URL, workKey: string): AsyncGenerator<SourceProviderEvent> {
  const response = await requestPersistently({ ...context, workKey: `page:gallery:${model.id}`,
    captureUnit: "zol_model_gallery", url: galleryUrl,
    maximumBytes: context.configuration.maximumHtmlBytes });
  const statusFailure = pageStatusFailure(response, `型号 ${model.id} 图集页`, "model");
  if (statusFailure) {
    yield inaccessible(context.targetKey, galleryUrl, context.now(), observationState(response.statusCode),
      statusFailure.message, response.finalUrl ? new URL(response.finalUrl) : undefined,
      galleryLineage(parameterUrl, model));
    throw statusFailure;
  }
  let sections: ReturnType<typeof parseZolGallerySections>;
  try { sections = parseZolGallerySections(response, model.id); } catch (error) {
    yield captureEvent(context.source, context.targetKey, galleryUrl, response, context.now(),
      rejected("gallery_images", bounded(error)), galleryLineage(parameterUrl, model));
    // WHY：图集 HTML 只属于当前型号；无法枚举图片时保留拒绝快照并隔离该型号，不能阻断后续品牌。
    throw contentFailure(`型号 ${model.id} 图集无法识别：${bounded(error)}`);
  }
  yield captureEvent(context.source, context.targetKey, galleryUrl, response, context.now(),
    accepted("model_gallery", `型号 ${model.name} 图集枚举 ${sections.length} 个大图分区`),
    galleryLineage(parameterUrl, model));
  const seenImages = new Set<string>();
  let imageOrdinal = 0;
  for (const section of sections) {
    imageOrdinal = yield* collectGallerySection(context, model, galleryUrl, section, sections,
      seenImages, imageOrdinal, workKey);
  }
}

async function* collectGallerySection(context: ZolCollectionContext, model: ZolModelEntry, galleryUrl: URL,
  section: ReturnType<typeof parseZolGallerySections>[number], sections: ReturnType<typeof parseZolGallerySections>,
  seenImages: Set<string>, imageOrdinal: number, workKey: string):
AsyncGenerator<SourceProviderEvent, number> {
  const detailUrl = assertPublicHttpsUrl(section.detailUrl);
  const response = await requestPersistently({ ...context, workKey: `page:image-set:${model.id}:${section.ordinal}`,
    captureUnit: "zol_model_picture_set", url: detailUrl,
    maximumBytes: context.configuration.maximumHtmlBytes });
  const statusFailure = pageStatusFailure(response, `型号 ${model.id} 大图分区`, "model");
  if (statusFailure) {
    yield inaccessible(context.targetKey, detailUrl, context.now(), observationState(response.statusCode),
      statusFailure.message, response.finalUrl ? new URL(response.finalUrl) : undefined,
      pictureSetLineage(galleryUrl, model, section.ordinal));
    throw statusFailure;
  }
  let images: ZolGalleryImage[];
  let declaredCountNote: string | undefined;
  try {
    images = parseZolPictureImages(response, model.id).filter((image) => !seenImages.has(image.url));
    const declaredTotal = sections.every((item) => item.declaredCount != null)
      ? sections.reduce((sum, item) => sum + item.declaredCount!, 0) : undefined;
    if (section === sections[0] && declaredTotal != null && images.length !== declaredTotal) {
      // WHY：ZOL 的标题计数可能落后于产品绑定 picList；后者同时带产品 ID、哈希、尺寸和稳定顺序，
      // 因此保留全部可验证图片并记录差异，避免一个展示计数阻断其余型号。
      declaredCountNote = `；图集标题声明 ${declaredTotal} 张，picList 实际有效图片 ${images.length} 张，按 picList 保存`;
    }
  } catch (error) {
    yield captureEvent(context.source, context.targetKey, detailUrl, response, context.now(),
      rejected("picture_set_images", bounded(error)), pictureSetLineage(galleryUrl, model, section.ordinal));
    throw contentFailure(`型号 ${model.id} 大图分区无法识别：${bounded(error)}`);
  }
  for (const image of images) seenImages.add(image.url);
  const sectionEvent = captureEvent(context.source, context.targetKey, detailUrl, response, context.now(),
    accepted("picture_set", `${model.name} ${section.title} 枚举 ${images.length} 张源站原图${declaredCountNote ?? ""}`),
    pictureSetLineage(galleryUrl, model, section.ordinal));
  yield { ...sectionEvent, resourceReferences: images.map((image, ordinal) => ({
    kind: "image" as const, sourceUrl: image.url, observedValue: model.name,
    locator: image.locator, role: imageOrdinal + ordinal === 0 ? "primary" as const : "detail" as const,
    section: image.section, ordinal: imageOrdinal + ordinal,
  })) };
  for (const image of images) {
    const sourceOrdinal = imageOrdinal;
    const imageUrl = assertZolImageUrl(image.url);
    if (!(yield* ensureOriginRobots(context, imageUrl.origin, "保存 ZOL 图片 origin 的 robots 原文", "asset"))) {
      throw new SourceProviderFailure("source_restricted", "robots.txt 不允许图片资源");
    }
    const pending = context.pendingModels.get(workKey)!;
    pending.pendingImages += 1;
    // WHY：队列任务稍后才执行；必须在入队时冻结 ordinal，不能闭包读取继续递增的循环变量。
    const completed = await context.imageQueue.enqueue(
      (imageSignal) => downloadImage(context, model, detailUrl, image, sourceOrdinal, workKey, imageSignal));
    yield* emitQueuedImages(context, completed);
    imageOrdinal += 1;
  }
  return imageOrdinal;
}

async function downloadImage(context: ZolCollectionContext, model: ZolModelEntry, detailUrl: URL,
  image: ZolGalleryImage, imageOrdinal: number, modelWorkKeyValue: string,
  signal: AbortSignal): Promise<QueuedImage> {
  const imageUrl = assertZolImageUrl(image.url);
  try {
    if (!isAllowed(context.robots, imageUrl)) {
      throw new SourceProviderFailure("source_restricted", "robots.txt 不允许图片资源");
    }
    const response = await requestPersistently({ ...context, workKey: `asset:image:${model.id}:${imageOrdinal}`,
      captureUnit: "zol_model_gallery_image", url: imageUrl,
      maximumBytes: context.configuration.maximumImageBytes, requestLane: "asset", signal });
    if ([401, 403, 429].includes(response.statusCode)) {
      throw new SourceProviderFailure("source_restricted", `图片资源返回 HTTP ${response.statusCode}`);
    }
    if (response.statusCode === 404) return { modelWorkKey: modelWorkKeyValue,
      failure: contentFailure(`型号 ${model.id} 图片资源不存在`),
      event: inaccessible(context.targetKey, imageUrl, context.now(), "not_found", "图片资源不存在",
        response.finalUrl ? new URL(response.finalUrl) : undefined, imageLineage(detailUrl, model, imageOrdinal)) };
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw contentFailure(`图片资源返回 HTTP ${response.statusCode}`);
    }
    const mediaType = responseMediaType(response);
    if (allowedImageTypes.has(mediaType)) return { modelWorkKey: modelWorkKeyValue,
      event: captureEvent(context.source, context.targetKey, imageUrl, response, context.now(),
        accepted("gallery_image", `${model.name} 图集第 ${image.ordinal + 1} 张原始图片`),
        imageLineage(detailUrl, model, imageOrdinal)) };
    const failure = contentFailure(`型号 ${model.id} 图片返回不允许的类型：${mediaType || "unknown"}`);
    return { modelWorkKey: modelWorkKeyValue, failure,
      event: captureEvent(context.source, context.targetKey, imageUrl, response, context.now(),
        rejected("unsafe_image_type", `图片类型不允许内联：${mediaType || "unknown"}`),
        imageLineage(detailUrl, model, imageOrdinal)) };
  } catch (failure) {
    return { modelWorkKey: modelWorkKeyValue, failure };
  }
}

async function* emitQueuedImages(context: ZolCollectionContext,
  results: Array<{ status: "fulfilled"; value: QueuedImage } | { status: "rejected"; reason: unknown }>):
AsyncGenerator<SourceProviderEvent> {
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
    if (result.value.event) yield result.value.event;
    const pending = context.pendingModels.get(result.value.modelWorkKey);
    if (!pending) throw new SourceProviderFailure("contract_fault", "图片结果找不到所属型号工作项");
    pending.pendingImages -= 1;
    if (pending.pendingImages < 0) {
      throw new SourceProviderFailure("contract_fault", "型号图片完成数超过已排队数量");
    }
    if (result.value.failure) {
      if (!isRecoverableModelFailure(result.value.failure)) throw result.value.failure;
      pending.failureReason ??= bounded(result.value.failure);
    }
    await finishSettledModel(context, result.value.modelWorkKey);
  }
}

async function markModelFailed(context: ZolCollectionContext, workKey: string, error: unknown) {
  const pending = context.pendingModels.get(workKey);
  if (!pending) throw new SourceProviderFailure("contract_fault", "型号失败找不到所属工作项");
  pending.sealed = true;
  pending.failureReason ??= bounded(error);
  await finishSettledModel(context, workKey);
}

async function finishSettledModel(context: ZolCollectionContext, workKey: string) {
  const pending = context.pendingModels.get(workKey);
  if (!pending || !pending.sealed || pending.pendingImages > 0) return;
  await context.admission.finishCaptureWorkItem({ runId: context.runId, workKey,
    status: pending.failureReason ? "failed" : "completed",
    observedUnitCount: pending.failureReason ? 0 : 1,
    ...(pending.failureReason ? { terminationReason: pending.failureReason } : {}) });
  context.pendingModels.delete(workKey);
}

function modelWorkKey(brand: BrandState, model: ZolModelEntry) {
  return `model:${brand.key}:${model.id}`;
}

function requestRobots(input: { source: CrawlPlanSource; runId: string; admission: SourceRequestAdmissionPort;
  targetKey: string; origin: string; maximumBytes: number; request: PublicResourceRequest;
  requestLane?: "asset"; signal?: AbortSignal }) {
  const url = new URL("/robots.txt", input.origin);
  return requestPersistently({ ...input, workKey: `robots:${input.origin}`, captureUnit: "robots_policy", url,
    robotsPolicyRequest: true, ...(input.requestLane ? { requestLane: input.requestLane } : {}) })
    .then((response) => ({ url, response }));
}

function parseRobots(url: URL, response: RawPublicResponse): RobotsPolicy {
  // WHY：RFC 9309 2.3.1.3 将 robots.txt 的 4xx 定义为 unavailable，允许访问资源；5xx/网络失败仍 fail closed。
  if (response.statusCode >= 400 && response.statusCode <= 499) return robotsParser(url.href, "");
  if (response.statusCode < 200 || response.statusCode >= 300) return "blocked";
  return robotsParser(url.href, Buffer.from(response.body).toString("utf8"));
}

function isAllowed(robots: Map<string, RobotsPolicy>, url: URL) {
  const policy = robots.get(url.origin);
  return policy !== "blocked" && policy?.isAllowed(url.href, publicWebUserAgent) !== false;
}

function responseMediaType(response: RawPublicResponse) {
  return response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function bounded(error: unknown) { return (error instanceof Error ? error.message : String(error)).slice(0, 1_800); }
function contentFailure(message: string) { return new SourceProviderFailure("content_not_accepted", message); }
function structuralFailure(message: string) { return new SourceProviderFailure("plan_revision_required", message); }
function pageStatusFailure(response: RawPublicResponse, label: string, scope: "source" | "model") {
  if (response.statusCode >= 200 && response.statusCode < 300) return undefined;
  if ([401, 403, 429].includes(response.statusCode)) {
    return new SourceProviderFailure("source_restricted", `${label}返回 HTTP ${response.statusCode}`);
  }
  return new SourceProviderFailure(scope === "source" ? "plan_revision_required" : "content_not_accepted",
    `${label}返回 HTTP ${response.statusCode}`);
}
function observationState(status: number) {
  if (status === 401) return "login_required" as const;
  if (status === 403 || status === 429) return "access_denied" as const;
  if (status === 404) return "not_found" as const;
  return "source_error" as const;
}
function isRecoverableModelFailure(error: unknown) {
  return isTransientPublicResourceFailure(error)
    || (error instanceof SourceProviderFailure && error.category === "content_not_accepted");
}
function accepted(signal: string, reason: string) {
  return { status: "accepted" as const, ruleVersion: "zol-catalog-gallery-v2", matchedSignals: [signal], reason };
}
function rejected(signal: string, reason: string) {
  return { status: "rejected" as const, ruleVersion: "zol-catalog-gallery-v2", matchedSignals: [signal], reason };
}
function brandLineage(catalogUrl: URL, key: string, page: number) {
  return page === 1
    ? { workKey: `page:brand:${key}:${page}`, discoveryKind: "planned_entry" as const, depth: 0 as const }
    : { workKey: `page:brand:${key}:${page}`, discoveryKind: "html_link" as const,
      depth: 1 as const, parentUrl: catalogUrl.href };
}
function parameterLineage(brand: BrandState, model: ZolModelEntry) {
  return { workKey: `page:param:${model.id}`, discoveryKind: "html_link" as const,
    depth: 1 as const, parentUrl: brand.catalogUrl.href };
}
function galleryLineage(parameterUrl: URL, model: ZolModelEntry) {
  // WHY：共享 lineage contract 只允许 0-3 层；图集与参数同属型号层，图片再占第 3 层。
  return { workKey: `page:gallery:${model.id}`, discoveryKind: "html_link" as const,
    depth: 2 as const, parentUrl: parameterUrl.href };
}
function pictureSetLineage(galleryUrl: URL, model: ZolModelEntry, ordinal: number) {
  return { workKey: `page:image-set:${model.id}:${ordinal}`, discoveryKind: "html_link" as const,
    depth: 2 as const, parentUrl: galleryUrl.href };
}
function imageLineage(detailUrl: URL, model: ZolModelEntry, ordinal: number) {
  return { workKey: `asset:image:${model.id}:${ordinal}`, discoveryKind: "html_link" as const,
    depth: 3 as const, parentUrl: detailUrl.href };
}
