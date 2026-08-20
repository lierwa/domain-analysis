import { createHash } from "node:crypto";
import type { CrawlPlanSource, SourceProviderEvent } from "@domain-analysis/shared";
import { chromium, type Browser, type Page } from "playwright-core";
import { createPacedAccessGate } from "./pacedAccessGate";

export interface JdCatalogProviderOptions { endpointUrl: string; }

export interface JdCatalogProvider {
  readonly key: string;
  readonly version: string;
  validate(source: CrawlPlanSource): void;
  preflight(source: CrawlPlanSource): Promise<void>;
  collect(source: CrawlPlanSource, runId: string, signal?: AbortSignal): AsyncIterable<SourceProviderEvent>;
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
      if (source.provider.key !== "jd.catalog-product" || source.provider.version !== "1.0.0") {
        throw new Error("JD Provider 绑定必须是 jd.catalog-product@1.0.0");
      }
      const configurationKeys = source.provider.configuration.map((item) => item.key).sort();
      if (configurationKeys.join(",") !== "exclude_text,include_text,mode") {
        throw new Error("JD Provider 配置必须且只能包含 mode、include_text 与 exclude_text");
      }
      const configuration = config(source);
      if (configuration.mode !== "cdp") throw new Error("JD Provider 只接受已验证的 cdp 配置");
      if (!configuration.include_text) throw new Error("JD Provider 必须配置 include_text");
      if (source.entryUrls.length !== 1) throw new Error("JD Provider 每个来源只接受一个京东入口");
      for (const value of source.entryUrls) {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.hostname !== "www.jd.com" || url.port || url.username || url.password) {
          throw new Error("JD 入口必须是无凭证的 www.jd.com HTTPS URL");
        }
      }
      if (source.sourceKind !== "retailer") throw new Error("JD Provider 只承担零售来源");
      if (source.rawOutputPolicy.formats.join(",") !== "html" || source.rawOutputPolicy.retainAssets) {
        throw new Error("JD 首版只保留源站 HTML 且不下载附件");
      }
      const operations = source.targets.map((target) => targetOperation(target));
      if (operations.filter((value) => value === "catalog").length !== 1
        || operations.filter((value) => value === "first_matching_product").length !== 1
        || operations.length !== 2) {
        throw new Error("JD Provider 当前只接受一个 catalog target 和一个 first_matching_product target");
      }
      for (const target of source.targets) {
        if (target.quantity.mode !== "target_count" || target.quantity.targetCount !== 1) {
          throw new Error(`JD 首个有界 target 只能抓取 1 个单元：${target.key}`);
        }
      }
      if (source.stopPolicy.requestBudget !== 2) throw new Error("JD 首个有界来源请求预算必须为 2");
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
      const catalogTarget = source.targets.find((target) => targetOperation(target) === "catalog")!;
      const detailTarget = source.targets.find((target) => targetOperation(target) === "first_matching_product")!;
      const gate = createPacedAccessGate({ ...source.accessPolicy, jitterMs: { min: 0, max: 0 }, batchSize: 1, batchCooldownMs: 1 });
      if (signal) signal.addEventListener("abort", () => gate.cancel("operator_cancelled"), { once: true });
      const catalog = await gate.schedule("catalog", () => capture(context.newPage(), entry, signal));
      yield captureEvent(catalogTarget.key, "catalog", source.key, entry, catalog);
      if (catalog.state !== "accessible") return;
      yield { type: "target.completed", targetKey: catalogTarget.key };
      const configuration = config(source);
      const excluded = configuration.exclude_text?.split("|").map((item) => item.trim()).filter(Boolean) ?? [];
      const detailUrl = catalog.cards.find((card) => card.text.includes(configuration.include_text!)
        && excluded.every((term) => !card.text.includes(term)))?.url;
      if (!detailUrl) throw new Error("京东目录没有符合 include_text/exclude_text 的商品详情链接");
      const detail = await gate.schedule("detail", () => capture(context.newPage(), detailUrl, signal));
      yield captureEvent(detailTarget.key, "product", new URL(detailUrl).pathname, detailUrl, detail);
      if (detail.state === "accessible") yield { type: "target.completed", targetKey: detailTarget.key };
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

function captureEvent(targetKey: string, kind: string, externalKey: string, requestedUrl: string,
  result: Awaited<ReturnType<typeof capture>>): Extract<SourceProviderEvent, { type: "capture" }> {
  const bytes = Buffer.byteLength(result.html);
  const contentHash = createHash("sha256").update(result.html).digest("hex");
  return {
    type: "capture", targetKey, assets: [], snapshot: {
      idempotencyKey: `${targetKey}-${contentHash}`,
      object: { sourceIdentity: "jd", kind, externalKey },
      observation: { requestedUrl, finalUrl: result.finalUrl, observedAt: new Date().toISOString(),
        state: result.state, httpStatus: result.status, responseHeaders: {} },
      payload: result.state === "accessible" ? { kind: "inline_text", mediaType: "text/html", charset: "utf-8", text: result.html, bytes, contentHash } : undefined,
    },
  };
}

function targetOperation(target: CrawlPlanSource["targets"][number]) {
  if (target.providerConfiguration.length !== 1 || target.providerConfiguration[0]?.key !== "operation") {
    throw new Error(`JD target ${target.key} 必须且只能配置 operation`);
  }
  const values = Object.fromEntries(target.providerConfiguration.map((item) => [item.key, item.value]));
  if (values.operation !== "catalog" && values.operation !== "first_matching_product") {
    throw new Error(`JD target operation 不支持：${target.key}`);
  }
  return values.operation;
}
