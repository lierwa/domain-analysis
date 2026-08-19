import { createHash } from "node:crypto";
import type { CrawlPlanSource, SourceSnapshotCommit } from "@domain-analysis/shared";
import { chromium, type Browser, type Page } from "playwright-core";
import { createPacedAccessGate } from "./pacedAccessGate";

export interface JdCatalogProviderOptions { endpointUrl: string; }

export interface JdCatalogProvider {
  readonly key: string;
  readonly version: string;
  validate(source: CrawlPlanSource): void;
  preflight(source: CrawlPlanSource): Promise<void>;
  collect(source: CrawlPlanSource, runId: string, signal?: AbortSignal): AsyncIterable<Omit<SourceSnapshotCommit, "runId">>;
}

export function createJdCatalogProvider(options: JdCatalogProviderOptions): JdCatalogProvider {
  const endpoint = new URL(options.endpointUrl);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
    throw new Error("JD CDP endpoint 必须是本机 loopback HTTP");
  }
  let browser: Browser | undefined;
  const connect = async () => browser ??= await chromium.connectOverCDP(options.endpointUrl);
  return {
    key: "jd.catalog-product",
    version: "1.0.0",
    validate(source) {
      const configuration = config(source);
      if (configuration.mode !== "cdp") throw new Error("JD Provider 只接受已验证的 cdp 配置");
      if (!configuration.include_text) throw new Error("JD Provider 必须配置 include_text");
      for (const value of source.entryUrls) if (new URL(value).hostname !== "www.jd.com") throw new Error("JD 入口必须属于 www.jd.com");
      if (!source.rawOutputPolicy.formats.includes("html")) throw new Error("JD 首版必须保留源站 HTML");
    },
    async preflight(source) {
      this.validate(source);
      const connected = await connect();
      if (!connected.contexts()[0]) throw new Error("已连接 Chrome 没有可用上下文");
    },
    async *collect(source, _runId, signal) {
      const connected = await connect();
      const context = connected.contexts()[0];
      if (!context) throw new Error("已连接 Chrome 没有可用上下文");
      const entry = source.entryUrls[0]!;
      const gate = createPacedAccessGate({ ...source.accessPolicy, jitterMs: { min: 0, max: 0 }, batchSize: 1, batchCooldownMs: 1 });
      if (signal) signal.addEventListener("abort", () => gate.cancel("operator_cancelled"), { once: true });
      const catalog = await gate.schedule("catalog", () => capture(context.newPage(), entry, signal));
      yield commit("catalog", source.key, entry, catalog);
      if (catalog.state !== "accessible") return;
      const configuration = config(source);
      const excluded = configuration.exclude_text?.split("|").map((item) => item.trim()).filter(Boolean) ?? [];
      const detailUrl = catalog.cards.find((card) => card.text.includes(configuration.include_text!)
        && excluded.every((term) => !card.text.includes(term)))?.url;
      if (!detailUrl) throw new Error("京东目录没有符合 include_text/exclude_text 的商品详情链接");
      if (source.stopPolicy.requestBudget < 2) return;
      const detail = await gate.schedule("detail", () => capture(context.newPage(), detailUrl, signal));
      yield commit("product", new URL(detailUrl).pathname, detailUrl, detail);
      await gate.onIdle();
    },
  };
}

async function capture(pagePromise: Promise<Page>, url: string, signal?: AbortSignal) {
  const page = await pagePromise;
  const abort = () => void page.close();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const finalUrl = page.url();
    const text = await page.locator("body").innerText().catch(() => "");
    const state = classify(finalUrl, response?.status(), text);
    const html = await page.content();
    const cards = state === "accessible" ? await page.locator('a[href*="item.jd.com/"]').evaluateAll((items) => {
      const unique = new Map<string, { url: string; text: string }>();
      for (const item of items) {
        const url = (item as HTMLAnchorElement).href;
        if (!/\/\d+\.html/.test(url)) continue;
        const container = item.closest("li") ?? item.parentElement;
        unique.set(url, { url, text: container?.textContent?.replace(/\s+/g, " ").trim() ?? item.textContent?.trim() ?? "" });
      }
      return [...unique.values()];
    }) : [];
    return { state, finalUrl, status: response?.status(), html, cards };
  } finally {
    signal?.removeEventListener("abort", abort);
    await page.close().catch(() => undefined);
  }
}

function config(source: CrawlPlanSource) {
  return Object.fromEntries(source.provider.configuration.map((item) => [item.key, String(item.value)])) as {
    mode?: string; include_text?: string; exclude_text?: string;
  };
}

function classify(url: string, status: number | undefined, text: string) {
  if (status === 429 || url.includes("frequent")) return "access_denied" as const;
  if (url.includes("passport.jd.com")) return "login_required" as const;
  if (url.includes("risk_handler") || text.includes("京东验证")) return "verification_required" as const;
  if (status === 401 || status === 403) return "access_denied" as const;
  if (!text.trim()) return "source_error" as const;
  return "accessible" as const;
}

function commit(kind: string, externalKey: string, requestedUrl: string, result: Awaited<ReturnType<typeof capture>>): Omit<SourceSnapshotCommit, "runId"> {
  const bytes = Buffer.byteLength(result.html);
  const contentHash = createHash("sha256").update(result.html).digest("hex");
  return {
    idempotencyKey: `${kind}-${contentHash}`,
    object: { sourceIdentity: "jd", kind, externalKey },
    observation: { requestedUrl, finalUrl: result.finalUrl, observedAt: new Date().toISOString(),
      state: result.state, httpStatus: result.status, responseHeaders: {} },
    payload: result.state === "accessible" ? { kind: "inline_text", mediaType: "text/html", charset: "utf-8", text: result.html, bytes, contentHash } : undefined,
  };
}
