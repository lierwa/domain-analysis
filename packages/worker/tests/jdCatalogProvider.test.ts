import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CrawlPlanSource, SourceRequestAdmissionPort } from "@domain-analysis/shared";
import { afterEach, describe, expect, it } from "vitest";

import { classifyJdResponseRestriction, createJdCatalogProvider } from "../src";
import type { PacedSessionHttpAccess, SessionHttpResult } from "../src/pacedSessionHttpAccess";

describe("JD catalog Provider contract", () => {
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  });

  it("只接受 v2 显式 HTTP 五类 target，Prepare 固定零请求", async () => {
    const provider = createJdCatalogProvider({ storageDirectory: "data/test-jd-queues" });
    const source = jdV2Source();

    expect(provider.version).toBe("2.0.0");
    expect(() => provider.validate(source)).not.toThrow();
    expect(() => provider.validate({ ...source, provider: { ...source.provider, version: "1.0.0" } }))
      .toThrow("2.0.0");
    expect(() => provider.validate({ ...source, targets: source.targets.slice(0, 4) }))
      .toThrow("五类");
    await expect(provider.prepare(source)).rejects.toThrow("真实 HTTP 尚未获准");
    await expect(provider.preflight(source)).rejects.toThrow("真实 HTTP 尚未获准");
    await expect(provider.collect(source, "run-1", unusedAdmission())[Symbol.asyncIterator]().next())
      .rejects.toThrow("真实 HTTP 尚未获准");
  });

  it("目录保存真实商品卡图片 URL，详情只返回客户端骨架时立即失败停止", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "domain-analysis-jd-provider-"));
    const http = fixtureHttpAccess();
    const admission = workLedger();
    const provider = createJdCatalogProvider({ storageDirectory: temporaryDirectory,
      openHttpAccess: () => http });
    const source = jdV2Source();

    await expect(provider.prepare(source)).resolves.toMatchObject({ status: "ready" });
    expect(http.requestedUrls).toEqual([]);
    const events = [];
    let failure: unknown;
    try {
      for await (const event of provider.collect(source, "run-fixture", admission)) events.push(event);
    } catch (error) {
      failure = error;
    }

    const captures = events.filter((event) => event.type === "capture");
    expect(failure).toMatchObject({ code: "source_abnormal" });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("客户端骨架");
    expect(captures).toHaveLength(2);
    expect(captures.every((event) => event.type === "capture"
      && event.resourceReferences?.length === 4)).toBe(true);
    expect(events.filter((event) => event.type === "target.completed")).toHaveLength(0);
    expect(http.requestedUrls).toHaveLength(3);
    expect(new Set(http.requestedUrls).size).toBe(3);
    expect(http.requestedUrls.some((url) => url.includes("/images/"))).toBe(false);
    expect([...admission.workItems.values()].filter((item) => item.status === "completed")).toHaveLength(2);
    expect([...admission.workItems.values()].filter((item) => item.status === "failed")).toHaveLength(1);
  });

  it("把登录、验证、risk_handler 与频控正文分类为 typed restriction", () => {
    const response = (body: string) => ({ url: "https://item.jd.com/1001.html", status: 200,
      headers: { "content-type": "text/html" }, body: Buffer.from(body) });
    expect(classifyJdResponseRestriction(response("<div>risk_handler</div>"))?.code).toBe("verification_required");
    expect(classifyJdResponseRestriction(response(
      `<title>京东-欢迎登录</title><form id="formlogin"><input name="loginname"></form>`,
    ))?.code).toBe("login_required");
    expect(classifyJdResponseRestriction(response("访问频繁，请稍后再试"))?.code).toBe("rate_limited");
    expect(classifyJdResponseRestriction(response("<main>商品详情</main>"))).toBeUndefined();
  });

  it("公共商品页导航中的请登录文案不应冒充登录挑战", () => {
    const body = `<header><a href="https://passport.jd.com/new/login.aspx">你好，请登录</a></header>
      <main><h1>家用平板电视</h1></main>`;
    const restriction = classifyJdResponseRestriction({
      url: "https://www.jd.com/chanpin/450049.html",
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from(body),
    });
    expect(restriction).toBeUndefined();
  });
});

function unusedAdmission(): SourceRequestAdmissionPort {
  return {
    async ensureCaptureWorkItem() { throw new Error("not used"); },
    async startCaptureWorkItem() { throw new Error("not used"); },
    async finishCaptureWorkItem() { throw new Error("not used"); },
    async reserveRequest() { throw new Error("not used"); },
    async finishRequest() { throw new Error("not used"); },
    async getAccessGate() { return null; },
  };
}

function workLedger() {
  const workItems = new Map<string, Awaited<ReturnType<SourceRequestAdmissionPort["ensureCaptureWorkItem"]>>>();
  const at = "2026-08-21T00:00:00.000Z";
  const admission: SourceRequestAdmissionPort & { workItems: typeof workItems } = {
    workItems,
    async ensureCaptureWorkItem(input) {
      const existing = workItems.get(input.workKey);
      if (existing) {
        expect(existing).toMatchObject({ targetKey: input.targetKey, captureUnit: input.captureUnit,
          parentObjectKey: input.parentObjectKey, expectedUnitCount: input.expectedUnitCount });
        return existing;
      }
      const item = { id: `work-${workItems.size + 1}`, ...input, observedUnitCount: 0,
        status: "pending" as const, createdAt: at };
      workItems.set(input.workKey, item);
      return item;
    },
    async startCaptureWorkItem(input) {
      const item = workItems.get(input.workKey)!;
      const started = { ...item, status: "running" as const, startedAt: at };
      workItems.set(input.workKey, started);
      return started;
    },
    async finishCaptureWorkItem(input) {
      const item = workItems.get(input.workKey)!;
      const finished = { ...item, ...input, finishedAt: at };
      workItems.set(input.workKey, finished);
      return finished;
    },
    async reserveRequest() { throw new Error("HTTP fixture owns request admission test separately"); },
    async finishRequest() { throw new Error("HTTP fixture owns request admission test separately"); },
    async getAccessGate() { return null; },
  };
  return admission;
}

function fixtureHttpAccess(): PacedSessionHttpAccess & { requestedUrls: string[] } {
  const requestedUrls: string[] = [];
  return {
    requestedUrls,
    async get(url) {
      requestedUrls.push(url);
      const body = fixtureBody(new URL(url));
      return response(url, body);
    },
    cancel() {}, async onIdle() {}, get state() { return "idle" as const; },
  };
}

function fixtureBody(url: URL) {
  if (url.hostname === "www.jd.com") {
    const products = url.pathname.endsWith("1") ? ["1001", "1002"] : ["1002", "1003"];
    return `<div id="J_goodsList"><ul>${products.map((sku) => `<li class="gl-item" data-sku="${sku}">
      <div class="p-img"><a href="https://item.jd.com/${sku}.html"><img src="//img14.360buyimg.com/n7/${sku}.jpg"></a></div>
      <div class="p-scroll"><img data-lazy-img="//img14.360buyimg.com/n9/${sku}.jpg"></div>
    </li>`).join("")}</ul></div>`;
  }
  if (url.hostname === "item.jd.com") return `<div class="skeleton-screen"></div><div id="root"></div>`;
  throw new Error(`fixture 缺少响应：${url.href}`);
}

function response(url: string, body: string): SessionHttpResult {
  const bytes = Buffer.from(body);
  return { finalUrl: url, status: 200, headers: { "content-type": body.startsWith("{")
    ? "application/json" : "text/html" }, body: bytes, requests: [{ attemptId: `fixture-${url}`,
    url, status: 200, startedAt: "2026-08-21T00:00:00.000Z", finishedAt: "2026-08-21T00:00:00.001Z" }] };
}

export function jdV2Source(): CrawlPlanSource {
  return {
    key: "jd.refrigerator", name: "京东冰箱", publisher: "京东", sourceKind: "retailer",
    sourceCandidateIds: ["candidate-jd"], role: "目录、详情、图片 URL 与评价",
    entryUrls: ["https://www.jd.com/catalog-1", "https://www.jd.com/catalog-2"],
    provider: { key: "jd.catalog-product", version: "2.0.0", configuration: [
      { key: "mode", value: "explicit_http" }, { key: "include_text", value: "冰箱" },
      { key: "exclude_text", value: "二手|冷柜|冰吧" },
    ] },
    accessPolicy: { kind: "paced_http", version: "jd-explicit-http-v2",
      maxRequestsPerMinute: 1, minimumIntervalMs: 60_000, maximumRunMs: 3_600_000 },
    stopPolicy: { requestBudget: 12, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
    rawOutputPolicy: { formats: ["html", "source_json"], retainAssets: false },
    observationLevel: "search_discovered", accessState: "unknown",
    observedAt: "2026-08-21T00:00:00.000Z", targets: targets(), executionBlockers: [],
  };
}

function targets(): CrawlPlanSource["targets"] {
  return [
    target("catalog-pages", "catalog_pages", ["html"]),
    target("store-catalogs", "store_catalogs", ["html"]),
    target("product-details", "product_details", ["html", "source_json"]),
    target("review-summaries", "review_summaries", ["source_json"]),
    { ...target("review-samples", "review_samples", ["source_json"]), providerConfiguration: [
      { key: "operation", value: "review_samples" }, { key: "samples_per_product", value: 50 },
    ] },
  ];
}

function target(key: string, operation: string, rawFormats: CrawlPlanSource["targets"][number]["rawFormats"]) {
  return { key, name: key, taskTopics: ["品牌与型号"], providerConfiguration: [{ key: "operation", value: operation }],
    captureUnit: key, rawFormats, quantity: { mode: "all_available" as const, unit: "个",
      denominator: "前序发现对象", rationale: "逐对象严格对账" }, uniqueKey: "稳定 work key",
    traversal: "由前序响应发现", stopCondition: "全部完成或首次受限" };
}
