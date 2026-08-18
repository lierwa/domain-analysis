import {
  chromium,
  type Browser,
  type Page,
  type Response,
} from "playwright-core";

import {
  jdPageObservationSchema,
  type JdPageObservation,
  type JdPageReader,
  type JdPageState,
} from "./jdOfficialRetailSource";
import { SourceAccessError } from "./sourceAccessError";

interface PlaywrightCdpJdPageReaderOptions {
  endpointUrl: string;
  allowedOrigins: string[];
  navigationTimeoutMs?: number;
  surfaceTimeoutMs?: number;
}

interface PageSignals {
  title: string;
  bodyText: string;
}

interface CatalogDomObservation {
  pageText: string;
  totalText: string;
  cards: Array<{ href: string; title: string; cardText: string }>;
}

interface DetailDomObservation {
  title: string;
  parameters: Array<{ name: string; value: string }>;
  categoryPath: string[];
}

export function createPlaywrightCdpJdPageReader(
  options: PlaywrightCdpJdPageReaderOptions,
): JdPageReader {
  assertLoopbackEndpoint(options.endpointUrl);
  const allowedOrigins = new Set(options.allowedOrigins.map((value) => new URL(value).origin));
  const navigationTimeoutMs = options.navigationTimeoutMs ?? 30_000;
  const surfaceTimeoutMs = options.surfaceTimeoutMs ?? 5_000;
  let browserPromise: Promise<Browser> | undefined;

  const browser = () => {
    browserPromise ??= chromium.connectOverCDP(options.endpointUrl).then((connected) => {
      connected.on("disconnected", () => {
        browserPromise = undefined;
      });
      return connected;
    });
    return browserPromise;
  };

  return async (url, kind, signal) => {
    assertAllowed(url, allowedOrigins);
    if (signal?.aborted) throw signal.reason;
    let page: Page | undefined;
    try {
      const connected = await browser();
      const context = connected.contexts()[0];
      if (!context) throw new SourceAccessError("source_abnormal", "已连接 Chrome 没有默认浏览器上下文");
      page = await context.newPage();
      const response = await navigate(page, url, kind, navigationTimeoutMs, surfaceTimeoutMs, signal);
      const state = classifyPage(await page.evaluate(readPageSignals), page.url(), response);
      if (state !== "accessible") return inaccessibleObservation(kind, url, state);
      assertAllowed(page.url(), allowedOrigins);
      return await accessibleObservation(page, url, kind);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (error instanceof SourceAccessError) throw error;
      throw new SourceAccessError(
        "source_abnormal",
        `京东 Chrome Reader 失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await page?.close().catch(() => undefined);
    }
  };
}

async function navigate(
  page: Page,
  url: string,
  kind: Parameters<JdPageReader>[1],
  navigationTimeoutMs: number,
  surfaceTimeoutMs: number,
  signal?: AbortSignal,
) {
  const abort = () => void page.close().catch(() => undefined);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
    const selector = kind === "catalog" || kind === "taxonomy"
      ? "li.sku-detail"
      : kind === "detail" || kind === "product" ? ".attribute .item" : "body";
    // WHY：京东参数区由前端在 DOMContentLoaded 后补齐；只等待目标最小表面，不等待全页网络静默。
    await page.waitForSelector(selector, { state: "attached", timeout: surfaceTimeoutMs }).catch(() => undefined);
    return response;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

async function accessibleObservation(
  page: Page,
  requestedUrl: string,
  kind: Parameters<JdPageReader>[1],
): Promise<JdPageObservation> {
  if (kind === "catalog") {
    return jdPageObservationSchema.parse(catalogObservation(
      await page.evaluate(readCatalogDom),
      requestedUrl,
    ));
  }
  if (kind === "detail" || kind === "product") {
    const detail = detailObservation(await page.evaluate(readDetailDom), requestedUrl);
    if (kind === "detail") return jdPageObservationSchema.parse({
      kind: detail.kind,
      state: detail.state,
      sku: detail.sku,
      parameters: detail.parameters,
      categoryPath: detail.categoryPath,
    });
    return jdPageObservationSchema.parse({
      kind: "product",
      state: "accessible",
      sku: detail.sku,
      content: {
        kind: "ordered_record",
        title: detail.title,
        fieldGroups: [
          ...(detail.categoryPath.length > 0 ? [{
            label: "categoryPath",
            fields: detail.categoryPath.map((value) => ({ name: "层级", value })),
          }] : []),
          { label: "parameters", fields: Object.entries(detail.parameters).map(([name, value]) => ({ name, value })) },
        ],
        blocks: [],
      },
    });
  }
  // WHY：本轮真实门只验证目录和商品详情；未验证的店铺、评价等表面必须 typed fail，不能伪造空内容。
  return inaccessibleObservation(kind, requestedUrl, "source_abnormal");
}

function catalogObservation(raw: CatalogDomObservation, requestedUrl: string) {
  const pageMatch = raw.pageText.match(/(\d+)\s*\/\s*(\d+)/);
  const totalMatch = raw.totalText.match(/共\s*(\d+)\s*页/);
  const pageNumber = Number(pageMatch?.[1] ?? new URL(requestedUrl).searchParams.get("page") ?? "1");
  const pageCount = Number(pageMatch?.[2] ?? totalMatch?.[1] ?? "1");
  const cards = new Map<string, { sku: string; title: string; sourceUrl: string; selfOperated: boolean }>();
  for (const card of raw.cards) {
    const sku = new URL(card.href).pathname.match(/\/(\d+)\.html$/)?.[1];
    if (!sku || !card.title.trim()) continue;
    cards.set(sku, {
      sku,
      title: card.title.trim(),
      sourceUrl: `https://item.jd.com/${sku}.html`,
      selfOperated: card.cardText.includes("自营"),
    });
  }
  if (!Number.isInteger(pageNumber) || !Number.isInteger(pageCount) || cards.size === 0) {
    throw new SourceAccessError("source_abnormal", "京东目录分页或商品卡片结构异常");
  }
  return { kind: "catalog" as const, state: "accessible" as const, pageNumber, pageCount, cards: [...cards.values()] };
}

function detailObservation(raw: DetailDomObservation, requestedUrl: string) {
  const sku = new URL(requestedUrl).pathname.match(/\/(\d+)\.html$/)?.[1];
  if (!sku) throw new SourceAccessError("source_abnormal", "京东详情 URL 缺少数字 SKU");
  const parameters: Record<string, string> = {};
  for (const { name, value } of raw.parameters) {
    const key = name.trim();
    const normalized = value.trim();
    if (!key || !normalized) continue;
    // WHY：详情可能重复展示同名参数；合并不同值可保住原始观察，不让 record 形状静默覆盖。
    parameters[key] = parameters[key] && parameters[key] !== normalized
      ? `${parameters[key]} | ${normalized}`
      : normalized;
  }
  if (Object.keys(parameters).length === 0) {
    throw new SourceAccessError("source_abnormal", `京东详情 ${sku} 没有参数`);
  }
  return {
    kind: "detail" as const,
    state: "accessible" as const,
    sku,
    title: raw.title.trim() || sku,
    parameters,
    categoryPath: [...new Set(raw.categoryPath.map((value) => value.trim()).filter(Boolean))],
  };
}

function classifyPage(signals: PageSignals, finalUrl: string, response: Response | null): JdPageState {
  const url = new URL(finalUrl);
  const status = response?.status();
  if (status === 404) return "not_found";
  if (status === 429 || url.hostname === "pc-frequent-pro.pf.jd.com" || signals.title.includes("频控页")) {
    return "rate_limited";
  }
  if (url.hostname === "passport.jd.com") return "login_required";
  if (url.pathname.includes("/risk_handler/") || signals.bodyText.includes("京东验证")) {
    return "verification_required";
  }
  if (status === 401 || status === 403) return "access_denied";
  if (signals.bodyText.includes("当前页面异常") || signals.bodyText.includes("切换账号")) {
    return "source_abnormal";
  }
  return signals.bodyText.trim() ? "accessible" : "source_abnormal";
}

function inaccessibleObservation(
  kind: Parameters<JdPageReader>[1],
  requestedUrl: string,
  state: Exclude<JdPageState, "accessible">,
): JdPageObservation {
  const sku = new URL(requestedUrl).pathname.match(/\/(\d+)\.html$/)?.[1] ?? "unknown";
  if (kind === "catalog") return { kind, state, pageNumber: 1, pageCount: 1, cards: [] };
  if (kind === "detail") return { kind, state, sku, parameters: {}, categoryPath: [] };
  if (kind === "product" || kind === "reviews") return { kind, state, sku };
  return { kind, state };
}

function assertLoopbackEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new SourceAccessError("source_abnormal", "Chrome CDP 端点必须是本机 HTTP loopback");
  }
}

function assertAllowed(value: string, allowedOrigins: Set<string>) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !allowedOrigins.has(url.origin)) {
    throw new SourceAccessError("origin_not_allowed", `来源 origin 未获本地配置允许：${url.origin}`);
  }
}

function readPageSignals(): PageSignals {
  return { title: document.title, bodyText: document.body?.innerText ?? "" };
}

function readCatalogDom(): CatalogDomObservation {
  return {
    pageText: document.querySelector(".panel-page .page")?.textContent?.trim() ?? "",
    totalText: document.querySelector(".total-page")?.textContent?.trim() ?? "",
    cards: [...document.querySelectorAll("li.sku-detail")].map((card) => {
      const link = card.querySelector<HTMLAnchorElement>("a.price-href[href]");
      return {
        href: link?.href ?? "",
        title: link?.textContent?.trim() ?? "",
        cardText: card.textContent?.trim() ?? "",
      };
    }),
  };
}

function readDetailDom(): DetailDomObservation {
  const parameters = [...document.querySelectorAll(".attribute .item")].flatMap((item) => {
    const label = item.querySelector(".label")?.textContent?.trim()
      ?? item.querySelector(".desc")?.textContent?.trim();
    const value = item.querySelector(".value")?.textContent?.trim()
      ?? item.querySelector(".title")?.textContent?.trim();
    return label && value ? [{ name: label, value }] : [];
  });
  const categoryPath = [...document.querySelectorAll("[class*=crumb] a, [class*=crumb] span")]
    .map((element) => element.textContent?.trim() ?? "")
    .filter(Boolean);
  return { title: document.title, parameters, categoryPath };
}
