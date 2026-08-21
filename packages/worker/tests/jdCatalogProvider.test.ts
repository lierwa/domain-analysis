import type { CrawlPlanSource } from "@domain-analysis/shared";
import { describe, expect, it, vi } from "vitest";

import { createJdCatalogProvider } from "../src";

describe("JD catalog Provider contract", () => {
  it("只接受显式 CDP 与品类 include_text，拒绝把自然语言 traversal 当执行配置", () => {
    const provider = createJdCatalogProvider({
      endpointUrl: "http://127.0.0.1:9222",
      userDataDir: "data/test-jd-profile",
    });
    const source = jdSource();
    expect(() => provider.validate(source)).not.toThrow();
    expect(() => provider.validate({ ...source, provider: { ...source.provider,
      configuration: source.provider.configuration.filter((item) => item.key !== "include_text") } }))
      .toThrow("include_text");
    expect(() => provider.validate({ ...source, entryUrls: [
      ...source.entryUrls, "https://www.jd.com/chanpin/987654.html",
    ] })).toThrow("一个京东入口");
    expect(() => provider.validate({ ...source, provider: { ...source.provider,
      configuration: [...source.provider.configuration, { key: "selector", value: "a" }] } }))
      .toThrow("必须且只能包含");
    expect(() => provider.validate({ ...source, targets: [{ ...source.targets[0]!,
      providerConfiguration: [...source.targets[0]!.providerConfiguration, { key: "selector", value: "a" }] },
    source.targets[1]!] })).toThrow("只能配置 operation");
  });

  it("9222 未启动时拉起独立 Chrome，并在扫码登录前返回人工动作", async () => {
    let finalUrl = "https://passport.jd.com/new/login.aspx";
    const page = {
      goto: vi.fn(async () => ({ status: () => 200 })),
      waitForTimeout: vi.fn(async () => undefined),
      locator: vi.fn(() => ({ innerText: async () => "京东登录" })),
      url: () => finalUrl,
      isClosed: () => false,
      bringToFront: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const context = { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined),
      browser: () => ({ isConnected: () => true }) };
    const browser = { contexts: () => [context], isConnected: () => true };
    const browserType = {
      connectOverCDP: vi.fn()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValue(browser),
      launchPersistentContext: vi.fn(async () => context),
    };
    const provider = createJdCatalogProvider({
      endpointUrl: "http://127.0.0.1:9222",
      userDataDir: "data/test-jd-profile",
    }, browserType as never, immediateGateFactory() as never);
    const source = jdSource();
    provider.beginExecution({ executionKey: "task:plan:v1", sources: [source] });

    await expect(provider.prepare(source)).resolves.toMatchObject({
      status: "action_required", action: "login_required",
    });
    expect(browserType.launchPersistentContext).toHaveBeenCalledWith("data/test-jd-profile",
      expect.objectContaining({ channel: "chrome", headless: false }));
    expect(page.bringToFront).toHaveBeenCalledOnce();

    finalUrl = "https://www.jd.com/chanpin/450039.html";
    await expect(provider.prepare(source)).resolves.toEqual({
      status: "ready", message: "项目专用 Chrome、9222 端口和京东登录状态均已就绪。",
    });
    await provider.close();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("Prepare、Start preflight、目录详情和下一来源共享同一个低频时钟", async () => {
    const navigations: string[] = [];
    const scheduled: string[] = [];
    const gateFactory = immediateGateFactory(scheduled);
    const context = { newPage: vi.fn(async () => fakePage(navigations)) };
    const browser = { contexts: () => [context], isConnected: () => true };
    const browserType = { connectOverCDP: vi.fn(async () => browser),
      launchPersistentContext: vi.fn() };
    const provider = createJdCatalogProvider({ endpointUrl: "http://127.0.0.1:9222",
      userDataDir: "data/test-jd-profile" }, browserType as never, gateFactory as never);
    const first = jdSource();
    const second = { ...jdSource(), key: "jd.refrigerator.second",
      entryUrls: ["https://www.jd.com/chanpin/450040.html"] };
    provider.beginExecution({ executionKey: "task:plan:v1", sources: [first, second] });

    await provider.prepare(first);
    await provider.preflight(first);
    for await (const _event of provider.collect(first, "run-1")) { /* consume */ }
    for await (const _event of provider.collect(second, "run-2")) { /* consume */ }
    await provider.endExecution("task:plan:v1");

    expect(gateFactory).toHaveBeenCalledOnce();
    expect(gateFactory).toHaveBeenCalledWith(expect.objectContaining({
      maxRequestsPerMinute: 2, minimumIntervalMs: 10_000, maximumRunMs: 360_000,
    }));
    expect(scheduled).toEqual([
      "prepare:jd.refrigerator", "preflight:jd.refrigerator",
      "catalog:jd.refrigerator", "detail:jd.refrigerator",
      "catalog:jd.refrigerator.second", "detail:jd.refrigerator.second",
    ]);
    expect(navigations).toHaveLength(6);
  });
});

function immediateGateFactory(scheduled: string[] = []) {
  return vi.fn(() => ({
    schedule: vi.fn(async (id: string, task: (signal: AbortSignal) => Promise<unknown>) => {
      scheduled.push(id);
      return task(new AbortController().signal);
    }),
    cancel: vi.fn(),
    onIdle: vi.fn(async () => undefined),
    state: "idle" as const,
    queued: 0,
    pending: 0,
  }));
}

function fakePage(navigations: string[]) {
  let currentUrl = "about:blank";
  let closed = false;
  return {
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
      navigations.push(url);
      return { status: () => 200 };
    }),
    waitForTimeout: vi.fn(async () => undefined),
    locator: vi.fn(() => ({ innerText: async () => "海尔冰箱",
      evaluateAll: async () => [{ url: "https://item.jd.com/100.html", text: "海尔冰箱" }] })),
    url: () => currentUrl,
    content: async () => "<html><body>海尔冰箱</body></html>",
    isClosed: () => closed,
    bringToFront: vi.fn(async () => undefined),
    close: vi.fn(async () => { closed = true; }),
  };
}

function jdSource(): CrawlPlanSource {
  return {
    key: "jd.refrigerator", name: "京东冰箱", publisher: "京东", sourceKind: "retailer",
    sourceCandidateIds: ["candidate-jd"],
    role: "有界目录与详情", entryUrls: ["https://www.jd.com/chanpin/450039.html"],
    provider: { key: "jd.catalog-product", version: "1.0.0", configuration: [
      { key: "mode", value: "cdp" }, { key: "include_text", value: "冰箱" }, { key: "exclude_text", value: "二手|冷柜|冰吧" },
    ] },
    accessPolicy: { kind: "paced_http", version: "jd-low-frequency-v1", maxRequestsPerMinute: 2, minimumIntervalMs: 10_000, maximumRunMs: 180_000 },
    stopPolicy: { requestBudget: 2, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
    rawOutputPolicy: { formats: ["html"], retainAssets: false },
    observationLevel: "search_discovered", accessState: "unknown", observedAt: "2026-08-20T00:00:00.000Z",
    targets: [{ key: "catalog", name: "目录", taskTopics: ["型号"],
      providerConfiguration: [{ key: "operation", value: "catalog" }], captureUnit: "HTML", rawFormats: ["html"],
      quantity: { mode: "target_count", targetCount: 1, unit: "页", denominator: "入口", rationale: "有界" },
      uniqueKey: "URL", traversal: "Provider 配置驱动", stopCondition: "1 页" },
    { key: "detail", name: "详情", taskTopics: ["型号"],
      providerConfiguration: [{ key: "operation", value: "first_matching_product" }], captureUnit: "HTML", rawFormats: ["html"],
      quantity: { mode: "target_count", targetCount: 1, unit: "页", denominator: "目录首个匹配商品", rationale: "有界" },
      uniqueKey: "URL", traversal: "Provider 配置驱动", stopCondition: "1 页" }], executionBlockers: [],
  };
}
