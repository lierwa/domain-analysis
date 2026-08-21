import { createHash } from "node:crypto";
import type { CrawlPlanSource, SourcePreparation, SourceProviderEvent } from "@domain-analysis/shared";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { createPacedAccessGate, type PacedAccessGate } from "./pacedAccessGate";
import { SourceAccessError } from "./sourceAccessError";

export interface JdCatalogProviderOptions { endpointUrl: string; userDataDir: string; }

export interface JdCatalogProvider {
  readonly key: string;
  readonly version: string;
  validate(source: CrawlPlanSource): void;
  beginExecution(input: { executionKey: string; sources: readonly CrawlPlanSource[] }): void;
  endExecution(executionKey: string): Promise<void>;
  prepare(source: CrawlPlanSource): Promise<SourcePreparation>;
  preflight(source: CrawlPlanSource): Promise<void>;
  collect(source: CrawlPlanSource, runId: string, signal?: AbortSignal): AsyncIterable<SourceProviderEvent>;
  close(): Promise<void>;
}

export function createJdCatalogProvider(
  options: JdCatalogProviderOptions,
  browserType: Pick<typeof chromium, "connectOverCDP" | "launchPersistentContext"> = chromium,
  accessGateFactory: typeof createPacedAccessGate = createPacedAccessGate,
): JdCatalogProvider {
  const endpoint = new URL(options.endpointUrl);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
    throw new Error("JD CDP endpoint 必须是本机 loopback HTTP");
  }
  if (!endpoint.port) throw new Error("JD CDP endpoint 必须显式配置本机端口");
  let browser: Browser | undefined;
  let ownedContext: BrowserContext | undefined;
  let loginPage: Page | undefined;
  let accessScope: { executionKey: string; gate: PacedAccessGate } | undefined;
  const context = () => ensureBrowserContext(options, endpoint, browserType, {
    get browser() { return browser; },
    set browser(value) { browser = value; },
    get ownedContext() { return ownedContext; },
    set ownedContext(value) { ownedContext = value; },
  });
  return {
    key: "jd.catalog-product",
    version: "1.0.0",
    validate: validateJdSource,
    beginExecution(input) {
      for (const source of input.sources) validateJdSource(source);
      if (accessScope?.executionKey === input.executionKey && !isTerminalGate(accessScope.gate)) return;
      accessScope?.gate.cancel("superseded_execution");
      // WHY：同一 confirmed plan 的 Prepare、Start preflight、目录和详情必须共享时钟；
      // 最长窗口按各来源计划窗口求和，只扩展整个执行寿命，不放宽每分钟和同域间隔。
      accessScope = { executionKey: input.executionKey,
        gate: accessGateFactory(combinedAccessPolicy(input.sources)) };
    },
    async endExecution(executionKey) {
      if (accessScope?.executionKey !== executionKey) return;
      const scope = accessScope;
      accessScope = undefined;
      await scope.gate.onIdle();
    },
    async prepare(source) {
      validateJdSource(source);
      const gate = requireAccessGate(accessScope);
      const readiness = await gate.schedule(`prepare:${source.key}`, async (signal) =>
        checkReadiness(await context(), source.key, source.entryUrls[0]!, loginPage, signal));
      loginPage = readiness.page;
      return readiness.result;
    },
    async preflight(source) {
      validateJdSource(source);
      const gate = requireAccessGate(accessScope);
      const readiness = await gate.schedule(`preflight:${source.key}`, async (signal) =>
        checkReadiness(await context(), source.key, source.entryUrls[0]!, loginPage, signal));
      loginPage = readiness.page;
      if (readiness.result.status === "action_required") {
        throw new SourceAccessError(readiness.result.action, readiness.result.message);
      }
    },
    async *collect(source, _runId, signal) {
      const browserContext = await context();
      const gate = requireAccessGate(accessScope);
      const entry = source.entryUrls[0]!;
      const catalogTarget = source.targets.find((target) => targetOperation(target) === "catalog")!;
      const detailTarget = source.targets.find((target) => targetOperation(target) === "first_matching_product")!;
      const cancel = () => gate.cancel("operator_cancelled");
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        const catalog = await gate.schedule(`catalog:${source.key}`, (gateSignal) =>
          capture(browserContext.newPage(), entry, gateSignal));
        yield captureEvent(catalogTarget.key, "catalog", source.key, entry, catalog);
        if (catalog.state !== "accessible") return;
        yield { type: "target.completed", targetKey: catalogTarget.key };
        const configuration = config(source);
        const excluded = configuration.exclude_text?.split("|").map((item) => item.trim()).filter(Boolean) ?? [];
        const detailUrl = catalog.cards.find((card) => card.text.includes(configuration.include_text!)
          && excluded.every((term) => !card.text.includes(term)))?.url;
        if (!detailUrl) throw new Error("京东目录没有符合 include_text/exclude_text 的商品详情链接");
        const detail = await gate.schedule(`detail:${source.key}`, (gateSignal) =>
          capture(browserContext.newPage(), detailUrl, gateSignal));
        yield captureEvent(detailTarget.key, "product", new URL(detailUrl).pathname, detailUrl, detail);
        if (detail.state === "accessible") yield { type: "target.completed", targetKey: detailTarget.key };
      } finally {
        signal?.removeEventListener("abort", cancel);
      }
    },
    async close() {
      accessScope?.gate.cancel("provider_closed");
      await accessScope?.gate.onIdle().catch(() => undefined);
      await loginPage?.close().catch(() => undefined);
      if (ownedContext) await ownedContext.close().catch(() => undefined);
      loginPage = undefined;
      accessScope = undefined;
      ownedContext = undefined;
      browser = undefined;
    },
  };
}

function validateJdSource(source: CrawlPlanSource) {
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
}

async function ensureBrowserContext(
  options: JdCatalogProviderOptions,
  endpoint: URL,
  browserType: Pick<typeof chromium, "connectOverCDP" | "launchPersistentContext">,
  state: { browser?: Browser; ownedContext?: BrowserContext },
) {
  if (state.ownedContext?.browser()?.isConnected()) return state.ownedContext;
  state.ownedContext = undefined;
  const connected = state.browser?.isConnected() ? state.browser.contexts()[0] : undefined;
  if (connected) return connected;
  try {
    state.browser = await browserType.connectOverCDP(options.endpointUrl, { timeout: 3_000 });
    const connectedContext = state.browser.contexts()[0];
    if (connectedContext) return connectedContext;
  } catch {
    // 端口未启动时进入下面的项目专用 Chrome 启动路径。
  }
  try {
    state.ownedContext = await browserType.launchPersistentContext(options.userDataDir, {
      channel: "chrome",
      headless: false,
      args: [`--remote-debugging-address=${endpoint.hostname === "localhost" ? "127.0.0.1" : endpoint.hostname}`,
        `--remote-debugging-port=${endpoint.port}`],
    });
    state.browser = await browserType.connectOverCDP(options.endpointUrl, { timeout: 5_000 });
    if (!state.browser.contexts()[0]) throw new Error("9222 没有可用浏览器上下文");
    // WHY：CDP 只证明端口可用；页面操作继续走 Playwright 自己启动的高保真 persistent context。
    return state.ownedContext;
  } catch {
    await state.ownedContext?.close().catch(() => undefined);
    state.ownedContext = undefined;
    throw new Error(`无法启动或连接项目专用 Chrome（${endpoint.host}），请关闭占用该端口的其他程序后重试`);
  }
}

async function checkReadiness(
  context: BrowserContext,
  sourceKey: string,
  entryUrl: string,
  previousPage: Page | undefined,
  signal: AbortSignal,
) {
  const page = previousPage && !previousPage.isClosed() ? previousPage : await context.newPage();
  const abort = () => void page.close();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const text = await page.locator("body").innerText().catch(() => "");
    const state = classify(page.url(), response?.status(), text);
    if (state === "accessible") {
      await page.close();
      return { page: undefined, result: { status: "ready", message: "项目专用 Chrome、9222 端口和京东登录状态均已就绪。" } } as const;
    }
    if (state === "login_required" || state === "verification_required") {
      await page.bringToFront();
      return { page, result: { status: "action_required", action: state, sourceKey,
        message: state === "login_required"
          ? "项目专用 Chrome 已打开京东登录页，请扫码登录后点击“已完成，重新检查”。"
          : "项目专用 Chrome 出现京东验证页，请人工完成后点击“已完成，重新检查”。" } } as const;
    }
    await page.close();
    throw new SourceAccessError(state === "source_error" ? "source_abnormal" : state,
      "京东入口当前不可访问，未开始抓取");
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof SourceAccessError) throw error;
    await page.close().catch(() => undefined);
    throw new Error("京东登录状态检查失败，请在项目专用 Chrome 中确认页面可访问后重试");
  } finally {
    signal.removeEventListener("abort", abort);
  }
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
  if (status === 429 || url.includes("frequent")) return "rate_limited" as const;
  if (url.includes("passport.jd.com")) return "login_required" as const;
  if (url.includes("risk_handler") || text.includes("京东验证")) return "verification_required" as const;
  if (status === 401 || status === 403) return "access_denied" as const;
  if (!text.trim()) return "source_error" as const;
  return "accessible" as const;
}

function combinedAccessPolicy(sources: readonly CrawlPlanSource[]) {
  const first = sources[0]?.accessPolicy;
  if (!first) throw new Error("JD 执行至少需要一个来源");
  for (const source of sources.slice(1)) {
    const policy = source.accessPolicy;
    if (policy.version !== first.version || policy.maxRequestsPerMinute !== first.maxRequestsPerMinute
      || policy.minimumIntervalMs !== first.minimumIntervalMs) {
      throw new Error("同一 JD 执行的所有来源必须共享相同低频策略");
    }
  }
  return { ...first, jitterMs: { min: 0, max: 0 }, batchSize: 1, batchCooldownMs: 1,
    maximumRunMs: sources.reduce((total, source) => total + source.accessPolicy.maximumRunMs, 0) };
}

function requireAccessGate(scope: { gate: PacedAccessGate } | undefined) {
  if (!scope) throw new Error("JD Provider 尚未开始 confirmed plan 执行生命周期");
  return scope.gate;
}

function isTerminalGate(gate: PacedAccessGate) {
  return gate.state === "open" || gate.state === "cancelled" || gate.state === "expired";
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
