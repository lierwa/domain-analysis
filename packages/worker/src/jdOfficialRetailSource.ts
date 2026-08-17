import { BasicCrawler } from "@crawlee/basic";
import {
  catalogSourceContentSchema,
  experienceCollectionSourceContentSchema,
  officialCatalogSnapshotSchema,
  orderedRecordSourceContentSchema,
  sourceAccessPolicySchema,
  type OfficialCatalogEntry,
  type SourceAccessPolicy,
} from "@domain-analysis/shared";
import { z } from "zod";

import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import type { OfficialCatalogSource } from "./officialCatalogSources";
import { SourceAccessError, type SourceAccessFailureCode } from "./sourceAccessError";
import { createPacedAccessGate } from "./pacedAccessGate";

const catalogUrl = "https://www.jd.com/brand/737a81dda3769f80aa8.html";
const requestKindSchema = z.enum([
  "taxonomy",
  "store",
  "catalog",
  "detail",
  "product",
  "reviews",
]);
const pageStateSchema = z.enum([
  "accessible",
  "not_found",
  "login_required",
  "verification_required",
  "access_denied",
  "rate_limited",
  "source_abnormal",
]);

const jdCatalogCardSchema = z.object({
  sku: z.string().min(1).max(240),
  title: z.string().min(1).max(1000),
  sourceUrl: z.string().url(),
  selfOperated: z.boolean(),
}).strict();

export const jdPageObservationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("taxonomy"),
    state: pageStateSchema,
    content: catalogSourceContentSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("store"),
    state: pageStateSchema,
    content: orderedRecordSourceContentSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("catalog"),
    state: pageStateSchema,
    pageNumber: z.number().int().positive(),
    pageCount: z.number().int().positive(),
    cards: z.array(jdCatalogCardSchema),
  }).strict(),
  z.object({
    kind: z.literal("detail"),
    state: pageStateSchema,
    sku: z.string().min(1).max(240),
    parameters: z.record(z.string()),
    categoryPath: z.array(z.string()),
  }).strict(),
  z.object({
    kind: z.literal("product"),
    state: pageStateSchema,
    sku: z.string().min(1).max(240),
    content: orderedRecordSourceContentSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("reviews"),
    state: pageStateSchema,
    sku: z.string().min(1).max(240),
    content: experienceCollectionSourceContentSchema.optional(),
  }).strict(),
]);

export type JdPageState = z.infer<typeof pageStateSchema>;
export type JdCatalogCard = z.infer<typeof jdCatalogCardSchema>;
export type JdPageObservation = z.infer<typeof jdPageObservationSchema>;

export type JdPageReader = (
  url: string,
  kind: z.infer<typeof requestKindSchema>,
  signal?: AbortSignal,
) => Promise<JdPageObservation>;

export interface JdOfficialRetailSourceOptions {
  allowedOrigins: string[];
  now?: () => Date;
  pageReader?: JdPageReader;
  accessPolicy?: SourceAccessPolicy;
}

export function createJdOfficialRetailSource(
  options: JdOfficialRetailSourceOptions,
): OfficialCatalogSource {
  return {
    enumerate: async () => {
      assertAllowed(catalogUrl, options.allowedOrigins);
      if (!options.pageReader) {
        // WHY：当前成熟浏览器候选均未通过 R-012，失败关闭可保留京东 unknown，又避免继续发起已证伪的自动化访问。
        throw new SourceAccessError("source_abnormal", "京东生产浏览器 Provider 尚未通过 R-012");
      }
      const accessPolicy = requirePacedPolicy(options.accessPolicy);
      const result = await crawlCatalog(options.pageReader, options.allowedOrigins, accessPolicy);
      return officialCatalogSnapshotSchema.parse({
        sourceId: "jd-cn-self-operated-refrigerator-catalog",
        sourceIdentity: "jd-cn-self-operated-refrigerator-channel",
        sourceAuthorityType: "official_direct_retail",
        // WHY：authority 表达京东官方自营，coverageKind 只表达其承担渠道发现职责，避免新增第二套来源角色协议。
        coverageKind: "official_channel_discovery",
        catalogUrl,
        observedAt: (options.now ?? (() => new Date()))().toISOString(),
        declaredItemCount: result.cards.size,
        fetchedItemCount: result.fetchedDetails,
        acceptedItemCount: result.entries.length,
        coverageStatus: "complete",
        entries: result.entries,
      });
    },
  };
}

async function crawlCatalog(
  reader: JdPageReader,
  allowedOrigins: string[],
  accessPolicy: Extract<SourceAccessPolicy, { kind: "paced_http" }>,
) {
  const pages = new Map<number, JdPageObservation & { kind: "catalog" }>();
  const cards = new Map<string, JdCatalogCard>();
  const entries: OfficialCatalogEntry[] = [];
  let fetchedDetails = 0;
  let expectedPages = 0;
  let terminalFailure: SourceAccessError | undefined;
  const accessGate = createPacedAccessGate(accessPolicy, {
    shouldBreak: isJdCircuitSignal,
  });
  const config = createEphemeralCrawleeConfiguration();
  const crawler = new BasicCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 0,
    maxRequestsPerCrawl: 1_000,
    maxRequestsPerMinute: accessPolicy.maxRequestsPerMinute,
    requestHandlerTimeoutSecs: 60,
    async requestHandler({ addRequests, request }) {
      if (terminalFailure) return;
      const kind = requestKindSchema.parse(request.userData.kind);
      assertAllowed(request.url, allowedOrigins);
      let observation: JdPageObservation;
      try {
        observation = await accessGate.schedule(
          `${kind}:${request.url}`,
          async (signal) => {
            const result = jdPageObservationSchema.parse(await reader(request.url, kind, signal));
            if (result.state !== "accessible") throw errorForState(result.state);
            return result;
          },
        );
      } catch (error) {
        request.noRetry = true;
        terminalFailure ??= error instanceof SourceAccessError
          ? error
          : new SourceAccessError("source_abnormal", error instanceof Error ? error.message : String(error));
        throw terminalFailure;
      }
      if (observation.kind === "catalog") {
        expectedPages = expectedPages || observation.pageCount;
        validateCatalogPage(observation, expectedPages);
        pages.set(observation.pageNumber, observation);
        // WHY：京东频道实测会在 60 张卡片中混入单个非自营商品；来源范围是自营商品，
        // 因此应在目录边界过滤，而不是让无关卡片抹掉同页其余已确认的自营覆盖。
        const selfOperatedCards = observation.cards.filter((card) => card.selfOperated);
        for (const card of selfOperatedCards) cards.set(card.sku, card);
        const requests = observation.pageNumber === 1
          ? catalogRequests(observation.pageCount)
          : selfOperatedCards.map(detailRequest);
        await addRequests(requests);
        if (observation.pageNumber === 1) await addRequests(selfOperatedCards.map(detailRequest));
        return;
      }
      if (observation.kind !== "detail") {
        throw new SourceAccessError(
          "source_abnormal",
          `旧京东目录采集器只接受 catalog/detail，实际收到 ${observation.kind}`,
        );
      }
      fetchedDetails += 1;
      const entry = entryFromDetail(observation, request.url);
      if (entry) entries.push(entry);
    },
    failedRequestHandler(_context, error) {
      terminalFailure ??= error instanceof SourceAccessError
        ? error
        : new SourceAccessError("source_abnormal", error instanceof Error ? error.message : String(error));
    },
  }, config);
  try {
    await crawler.run([{ url: catalogUrl, userData: { kind: "catalog" } }]);
    if (terminalFailure) throw terminalFailure;
    if (!expectedPages || pages.size !== expectedPages || fetchedDetails !== cards.size) {
      throw new SourceAccessError(
        "source_abnormal",
        `京东自营目录分页 ${pages.size}/${expectedPages}，详情 ${fetchedDetails}/${cards.size}`,
      );
    }
    return { cards, entries, fetchedDetails };
  } finally {
    await accessGate.onIdle();
    await crawler.teardown();
    await config.getStorageClient().teardown?.();
  }
}

function requirePacedPolicy(policy: SourceAccessPolicy | undefined) {
  if (!policy) throw new SourceAccessError("source_abnormal", "京东来源缺少显式频控政策");
  const parsed = sourceAccessPolicySchema.parse(policy);
  if (parsed.kind !== "paced_http") {
    throw new SourceAccessError("source_abnormal", "京东来源必须使用 paced_http 频控政策");
  }
  return parsed;
}

function isJdCircuitSignal(error: unknown) {
  return error instanceof SourceAccessError && [
    "access_denied",
    "login_required",
    "verification_required",
    "rate_limited",
    "source_abnormal",
  ].includes(error.code);
}

function validateCatalogPage(page: JdPageObservation & { kind: "catalog" }, expectedPages: number) {
  if (page.pageNumber < 1 || page.pageNumber > expectedPages || page.pageCount !== expectedPages || !page.cards.length) {
    throw new SourceAccessError("source_abnormal", `京东自营目录第 ${page.pageNumber} 页结构异常`);
  }
  if (!page.cards.some((card) => card.selfOperated)) {
    throw new SourceAccessError("source_abnormal", `京东自营目录第 ${page.pageNumber} 页没有自营商品`);
  }
}

function entryFromDetail(
  page: JdPageObservation & { kind: "detail" },
  sourceUrl: string,
): OfficialCatalogEntry | undefined {
  const brand = page.parameters["品牌"]?.trim();
  const manufacturerModel = page.parameters["能效网规格型号"]?.trim().toUpperCase();
  const productType = page.parameters["类型"]?.trim();
  // WHY：真实详情页并不总有“类型”参数，但稳定提供官方面包屑；两者共同确认品类，
  // 同时显式排除冷柜、酒柜和冰吧，不能退回营销标题猜测品类。
  if (!isHouseholdRefrigerator(productType, page.categoryPath)) return undefined;
  if (!brand || !manufacturerModel || !/^[A-Z0-9][A-Z0-9()/.+-]{1,80}$/.test(manufacturerModel)) {
    throw new SourceAccessError("source_abnormal", `京东自营商品 ${page.sku} 缺少详情型号 identity`);
  }
  return { brand, manufacturerModel, sourceItemId: page.sku, sourceUrl, identityStatus: "confirmed" };
}

function isHouseholdRefrigerator(productType: string | undefined, categoryPath: string[]) {
  const categoryText = `${productType ?? ""}\n${categoryPath.join("/")}`;
  if (/(冷柜|冰柜|酒柜|冰吧)/.test(categoryText)) return false;
  return productType === "家用冰箱" || categoryPath.includes("冰箱");
}

function catalogRequests(pageCount: number) {
  return Array.from({ length: pageCount - 1 }, (_, index) => ({
    url: `${catalogUrl}?extAttrValue=expand_name,&electedExtAttrSet=&sort_type=sort_redissale_desc&page=${index + 2}`,
    userData: { kind: "catalog" },
  }));
}

function detailRequest(card: JdCatalogCard) {
  return { url: card.sourceUrl, userData: { kind: "detail" } };
}

function errorForState(state: Exclude<JdPageState, "accessible">) {
  const code: SourceAccessFailureCode = state === "not_found" ? "evidence_not_found" : state;
  return new SourceAccessError(code, `京东官方渠道页面状态：${state}`);
}

function assertAllowed(value: string, allowedOrigins: string[]) {
  const url = new URL(value);
  const allowed = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  if (url.protocol !== "https:" || !allowed.has(url.origin)) {
    throw new SourceAccessError("origin_not_allowed", `来源 origin 未获本地配置允许：${url.origin}`);
  }
}
