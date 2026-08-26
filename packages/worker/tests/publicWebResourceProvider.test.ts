import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import type { CrawlPlanSource, SourceProviderEvent, SourceRequestAdmissionPort } from "@domain-analysis/shared";
import { describe, expect, it, vi } from "vitest";

import {
  assertPublicAddress,
  assertPublicHttpsUrl,
  createPublicWebResourceProvider,
  readBoundedBody,
  resolvePublicTarget,
} from "../src";

describe("公共原始资源 Provider", () => {
  it("逐 target 读取冻结 URL，并返回可对账的 capture/completed 事件", async () => {
    const requested: string[] = [];
    const provider = createPublicWebResourceProvider({
      now: () => new Date("2026-08-20T00:00:00.000Z"),
      request: async (url) => {
        requested.push(url.href);
        if (url.pathname === "/robots.txt") return response(200, "User-agent: *\nAllow: /");
        return response(200, `<html><body>${url.pathname} ${"official manual principles technical ".repeat(20)}</body></html>`,
          "text/html; charset=utf-8");
      },
    });
    const events: SourceProviderEvent[] = [];
    for await (const event of provider.collect(source(), "run-1", fakeAdmission())) events.push(event);

    expect(requested).toEqual([
      "https://example.com/robots.txt",
      "https://example.com/manual",
      "https://example.com/principles",
    ]);
    expect(events.map((event) => [event.type, event.targetKey])).toEqual([
      ["capture", "official.manual"], ["target.completed", "official.manual"],
      ["capture", "technical.principles"], ["target.completed", "technical.principles"],
    ]);
  });

  it("按 HTML 标准识别非 UTF-8 正文，并让内联文本的字节数与哈希对账", async () => {
    const bytes = Buffer.concat([
      Buffer.from('<html><head><meta charset="windows-1252"></head><body>caf', "ascii"),
      Buffer.from([0xe9]),
      Buffer.from(` ${"official manual ".repeat(20)}</body></html>`, "ascii"),
    ]);
    const provider = createPublicWebResourceProvider({
      request: async (url) => url.pathname === "/robots.txt"
        ? response(200, "User-agent: *\nAllow: /")
        : { statusCode: 200, headers: { "content-type": "text/html" }, body: Uint8Array.from(bytes) },
    });

    const events = await collect(provider.collect(singleManualSource(), "run-1", fakeAdmission()));
    const capture = events.find((event) => event.type === "capture");
    const expected = `<html><head><meta charset="windows-1252"></head><body>café ${"official manual ".repeat(20)}</body></html>`;

    expect(capture).toMatchObject({ snapshot: { payload: {
      kind: "inline_text", charset: "windows-1252", text: expected,
      bytes: Buffer.byteLength(expected),
      contentHash: createHash("sha256").update(expected).digest("hex"),
    } } });
  });

  it("HTTP charset 与 HTML meta 冲突且标准解码损坏时，选择无替换字符的正文编码", async () => {
    const bytes = Buffer.concat([
      Buffer.from('<html><head><meta charset="windows-1252"></head><body>caf', "ascii"),
      Buffer.from([0xe9]),
      Buffer.from(` ${"official manual ".repeat(20)}</body></html>`, "ascii"),
    ]);
    const provider = createPublicWebResourceProvider({
      request: async (url) => url.pathname === "/robots.txt"
        ? response(200, "User-agent: *\nAllow: /")
        : { statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" },
            body: Uint8Array.from(bytes) },
    });

    const events = await collect(provider.collect(singleManualSource(), "run-1", fakeAdmission()));
    const capture = events.find((event) => event.type === "capture");

    expect(capture).toMatchObject({ snapshot: { payload: {
      kind: "inline_text", charset: "windows-1252",
      text: `<html><head><meta charset="windows-1252"></head><body>café ${"official manual ".repeat(20)}</body></html>`,
    } } });
  });

  it("保留源站 GBK 原字节后，按响应声明还原中文正文", async () => {
    const prefix = Buffer.from('<html><head><meta charset="GBK"></head><body>', "ascii");
    const chinese = Buffer.from("b5e7cad320c6b7c5c620b2fac6b720", "hex");
    const suffix = Buffer.from(`${"official model parameters ".repeat(20)}</body></html>`, "ascii");
    const provider = createPublicWebResourceProvider({
      request: async (url) => url.pathname === "/robots.txt"
        ? response(200, "User-agent: *\nAllow: /")
        : { statusCode: 200, headers: { "content-type": "text/html; charset=GBK" },
            body: Uint8Array.from(Buffer.concat([prefix, chinese, suffix])) },
    });
    const value = singleManualSource();
    value.targets[0]!.taskTopics = ["电视", "品牌", "产品"];

    const events = await collect(provider.collect(value, "run-1", fakeAdmission()));
    const capture = events.find((event) => event.type === "capture");

    expect(capture).toMatchObject({ snapshot: { payload: {
      kind: "inline_text", charset: "GBK",
    } } });
    expect(capture?.snapshot.payload?.kind === "inline_text"
      ? capture.snapshot.payload.text : "").toContain("电视 品牌 产品");
  });

  it("传输编码可无损解码时，保留正文本身合法的替换字符", async () => {
    const text = `<html><head><meta charset="windows-1252"></head><body>� ${"official manual ".repeat(20)}</body></html>`;
    const provider = createPublicWebResourceProvider({
      request: async (url) => url.pathname === "/robots.txt"
        ? response(200, "User-agent: *\nAllow: /")
        : response(200, text, "text/html; charset=utf-8"),
    });

    const events = await collect(provider.collect(singleManualSource(), "run-1", fakeAdmission()));
    const capture = events.find((event) => event.type === "capture");

    expect(capture).toMatchObject({ snapshot: { payload: {
      kind: "inline_text", charset: "UTF-8", text,
    } } });
  });

  it("robots 禁止时记录 target access_denied 且不请求正文", async () => {
    const requested: string[] = [];
    const provider = createPublicWebResourceProvider({
      request: async (url) => {
        requested.push(url.href);
        return response(200, "User-agent: *\nDisallow: /manual");
      },
    });
    const events = [];
    for await (const event of provider.collect(source(), "run-1", fakeAdmission())) events.push(event);

    expect(requested).toEqual(["https://example.com/robots.txt"]);
    expect(events).toMatchObject([{ type: "capture", targetKey: "official.manual",
      snapshot: { observation: { state: "access_denied" } } }]);
  });

  it("site route 把 sitemap 与 HTML 链接放进持久队列，并只以内容验收通过页完成 target", async () => {
    const requested: string[] = [];
    const queueStorageDirectory = await mkdtemp(path.join(tmpdir(), "public-site-provider-"));
    const provider = createPublicWebResourceProvider({
      queueStorageDirectory,
      request: async (url) => {
        requested.push(url.href);
        if (url.pathname === "/robots.txt") return response(200,
          "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml");
        if (url.pathname === "/sitemap.xml") return response(200,
          '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/tvs/second</loc></url></urlset>',
          "application/xml");
        if (url.pathname === "/tvs") return response(200,
          `<html><body>TCL 电视 65Q8E 55Q7E ${"官方型号与规格 ".repeat(80)}<a href="/tvs/second">电视型号</a><a href="/about">TCL 电视企业新闻</a></body></html>`,
          "text/html; charset=utf-8");
        if (url.pathname === "/about") return response(200,
          `<html><body>TCL 电视 2026 ${"企业新闻与品牌动态 ".repeat(80)}</body></html>`,
          "text/html; charset=utf-8");
        return response(200, `<html><body>TCL 电视 75C12 65C12 ${"产品参数与型号 ".repeat(80)}</body></html>`,
          "text/html; charset=utf-8");
      },
    });
    try {
      const site = siteSource();
      const events = await collect(provider.collect(site, "run-1", fakeAdmission(), undefined, {
        queueRunId: "run-1", accessPolicy: { kind: "paced_http", version: "public-v2",
          maxRequestsPerMinute: 10, minimumIntervalMs: 1, jitterMs: { min: 0, max: 0 },
          batchSize: 10, batchCooldownMs: 60_000, maximumRunMs: 10_000 },
      }));
      expect(requested).toEqual(expect.arrayContaining([
        "https://example.com/robots.txt", "https://example.com/sitemap.xml",
        "https://example.com/tvs", "https://example.com/tvs/second", "https://example.com/about",
      ]));
      expect(events.filter((event) => event.type === "capture"
        && event.snapshot.observation.contentAssessment?.status === "accepted")).toHaveLength(2);
      expect(events.filter((event) => event.type === "capture"
        && event.snapshot.observation.contentAssessment?.status === "rejected")).toHaveLength(1);
      expect(events.at(-1)).toEqual({ type: "target.completed", targetKey: "official.catalog" });
    } finally {
      await rm(queueStorageDirectory, { recursive: true, force: true });
    }
  });

  it("site route 失败后显式继续时复用原持久队列并领取未完成页面", async () => {
    const queueStorageDirectory = await mkdtemp(path.join(tmpdir(), "public-site-resume-"));
    let seedAttempts = 0;
    const provider = createPublicWebResourceProvider({ queueStorageDirectory, request: async (url) => {
      if (url.pathname === "/robots.txt") return response(200, "User-agent: *\nAllow: /");
      if (url.pathname === "/sitemap.xml") return response(404, "missing");
      seedAttempts += 1;
      return seedAttempts === 1 ? response(403, "restricted") : response(200,
        `<html><body>TCL 电视 65Q8E 55Q7E ${"产品型号与规格 ".repeat(80)}</body></html>`, "text/html");
    } });
    const value = siteSource();
    value.provider.configuration = [
      { key: "mode", value: "planned_routes" }, { key: "maximum_bytes", value: 100_000 },
      { key: "maximum_pages_per_target", value: 1 },
    ];
    value.targets[0]!.providerConfiguration = [
      { key: "route", value: "site" }, { key: "url", value: "https://example.com/tvs" },
      { key: "required_terms", value: ["TCL", "电视"] }, { key: "maximum_depth", value: 1 },
      { key: "minimum_accepted_pages", value: 1 },
    ];
    try {
      const first = await collect(provider.collect(value, "run-first", fakeAdmission(), undefined, {
        queueRunId: "run-root", accessPolicy: { kind: "paced_http", version: "public-v2",
          maxRequestsPerMinute: 10, minimumIntervalMs: 1, jitterMs: { min: 0, max: 0 },
          batchSize: 10, batchCooldownMs: 60_000, maximumRunMs: 10_000 },
      }));
      expect(first).toContainEqual(expect.objectContaining({ type: "capture",
        snapshot: expect.objectContaining({ observation: expect.objectContaining({ state: "access_denied" }) }) }));

      const resumed = await collect(provider.collect(value, "run-second", fakeAdmission(), undefined, {
        resumedFromRunId: "run-first", queueRunId: "run-root",
        accessPolicy: { kind: "paced_http", version: "public-v2",
          maxRequestsPerMinute: 10, minimumIntervalMs: 1, jitterMs: { min: 0, max: 0 },
          batchSize: 10, batchCooldownMs: 60_000, maximumRunMs: 10_000 },
      }));
      expect(resumed.at(-1)).toEqual({ type: "target.completed", targetKey: "official.catalog" });
      expect(seedAttempts).toBe(2);
    } finally {
      await rm(queueStorageDirectory, { recursive: true, force: true });
    }
  }, 15_000);

  it("exact 品牌页面即使 2xx 且正文很长，缺少商品证据也拒绝完成", async () => {
    const provider = createPublicWebResourceProvider({ request: async (url) => url.pathname === "/robots.txt"
      ? response(200, "User-agent: *\nAllow: /")
      : response(200, `<html><body>示例机构 ${"企业新闻与品牌动态 ".repeat(80)}</body></html>`, "text/html") });
    const value = source();
    value.sourceKind = "brand_official";
    value.entryUrls = ["https://example.com/manual"];
    value.targets = [value.targets[0]!];
    value.stopPolicy.requestBudget = 4;
    const events: SourceProviderEvent[] = [];

    await expect(async () => {
      for await (const event of provider.collect(value, "run-1", fakeAdmission())) events.push(event);
    }).rejects.toThrow("内容验收未达标");
    expect(events[0]).toMatchObject({ type: "capture", snapshot: { observation: {
      contentAssessment: { status: "rejected" },
    } } });
  });

  it("拒绝私网、凭证并保留有界响应读取", async () => {
    expect(() => assertPublicHttpsUrl("https://127.0.0.1/manual")).toThrow("非公网地址");
    expect(() => assertPublicHttpsUrl("https://user:secret@example.com/manual")).toThrow("凭证");
    expect(() => assertPublicAddress("::1", 6)).toThrow("非公网地址");
    expect(() => assertPublicAddress("8.8.8.8", 4)).not.toThrow();
    await expect(readBoundedBody(Readable.from([Buffer.alloc(3), Buffer.alloc(3)]), 5))
      .rejects.toThrow("超过最大字节");
  });

  it("到达计划 maximumRunMs 时取消在途请求，不让来源无限悬挂", async () => {
    const provider = createPublicWebResourceProvider({ request: async (url, _maximumBytes, signal) => {
      if (url.pathname === "/robots.txt") return response(200, "User-agent: *\nAllow: /");
      await delay(100, undefined, { signal });
      return response(200, "不应到达");
    } });
    const value = singleManualSource();
    value.accessPolicy.maximumRunMs = 5;

    await expect(collect(provider.collect(value, "run-1", fakeAdmission())))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("Fake-IP 环境只有在可信代理存在时才通过 DoH 取得公网地址", async () => {
    const lookup = async () => [{ address: "198.18.0.9", family: 4 as const }];
    const resolveViaDoh = async () => [{ address: "23.199.232.87", family: 4 as const }];

    await expect(resolvePublicTarget("www.fda.gov", lookup, resolveViaDoh, true))
      .resolves.toEqual({ address: "23.199.232.87", family: 4 });
    await expect(resolvePublicTarget("www.fda.gov", lookup, resolveViaDoh, false))
      .rejects.toThrow("没有配置受信任 HTTPS 代理");
  });

  it("同源 redirect 的每一跳发送前独立预留 attempt，并保存最终 URL", async () => {
    const admission = fakeAdmission();
    const provider = createPublicWebResourceProvider({
      request: async (url, _maximumBytes, _signal, onRedirect) => {
        if (url.pathname === "/robots.txt") return response(200, "User-agent: *\nAllow: /");
        const toUrl = new URL("https://example.com/final-manual");
        const hop = { fromUrl: url, toUrl, statusCode: 302, headers: { location: toUrl.href } };
        await onRedirect?.({ type: "response", hop });
        await onRedirect?.({ type: "request", toUrl });
        return { ...response(200, `<html><body>manual ${"official manual content ".repeat(20)}</body></html>`, "text/html; charset=utf-8"),
          finalUrl: toUrl.href };
      },
    });

    const oneTarget = source();
    oneTarget.entryUrls = ["https://example.com/manual"];
    oneTarget.targets = [oneTarget.targets[0]!];
    oneTarget.stopPolicy.requestBudget = 4;
    const events = await collect(provider.collect(oneTarget, "run-1", admission));

    expect(admission.reserveRequest.mock.calls.map(([input]) => ({
      url: input.requestedUrl, parent: input.redirectParentAttemptId,
    }))).toEqual([
      { url: "https://example.com/robots.txt", parent: undefined },
      { url: "https://example.com/manual", parent: undefined },
      { url: "https://example.com/final-manual", parent: "attempt-2" },
    ]);
    expect(events[0]).toMatchObject({ type: "capture", snapshot: { observation: {
      requestedUrl: "https://example.com/manual",
      finalUrl: "https://example.com/final-manual",
    } } });
  });

  it("非法 redirect 在第二跳出网前停止，但保留首跳 HTTP 状态且不伪造第二次请求", async () => {
    const admission = fakeAdmission();
    const provider = createPublicWebResourceProvider({
      request: async (url, _maximumBytes, _signal, onRedirect) => {
        if (url.pathname === "/robots.txt") return response(200, "User-agent: *\nAllow: /");
        const toUrl = new URL("http://example.com/downgrade");
        await onRedirect?.({ type: "response", hop: {
          fromUrl: url, toUrl, statusCode: 301, headers: { location: toUrl.href },
        } });
        throw new Error("公共资源只允许 HTTPS");
      },
    });
    const oneTarget = source();
    oneTarget.entryUrls = ["https://example.com/manual"];
    oneTarget.targets = [oneTarget.targets[0]!];

    await expect(collect(provider.collect(oneTarget, "run-1", admission)))
      .rejects.toThrow("公共资源只允许 HTTPS");
    expect(admission.reserveRequest).toHaveBeenCalledTimes(2);
    expect(admission.finishRequest).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-2", state: "completed", httpStatus: 301,
    }));
    expect(admission.finishRequest).not.toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-2", state: "failed",
    }));
  });

  it("robots 与 target 每个 HTTP hop 都先进入持久准入，gate 按 origin 共享", async () => {
    const admission = fakeAdmission();
    const provider = createPublicWebResourceProvider({
      request: async (url) => url.pathname === "/robots.txt"
        ? response(200, "User-agent: *\nAllow: /")
        : response(200, `<html><body>${url.pathname} ${"official manual principles technical ".repeat(20)}</body></html>`, "text/html; charset=utf-8"),
    });

    await collect(provider.collect(source(), "run-1", admission));

    expect(admission.reserveRequest).toHaveBeenCalledTimes(3);
    expect(admission.reserveRequest.mock.calls.map(([input]) => [input.gateKey, input.requestedUrl]))
      .toEqual([
        ["public.web-resource@2.0.0:https://example.com", "https://example.com/robots.txt"],
        ["public.web-resource@2.0.0:https://example.com", "https://example.com/manual"],
        ["public.web-resource@2.0.0:https://example.com", "https://example.com/principles"],
      ]);
    expect(admission.finishRequest).toHaveBeenCalledTimes(3);
  });

  it("拒绝不可对账的 target 数量和计划未声明的附件输出", async () => {
    const provider = createPublicWebResourceProvider({
      request: async (url) => url.pathname === "/robots.txt"
        ? response(200, "User-agent: *\nAllow: /")
        : response(200, "%PDF", "application/pdf"),
    });
    const invalidQuantity = source();
    invalidQuantity.targets[0]!.quantity = { mode: "sample", targetCount: 2, unit: "份",
      denominator: "冻结 URL", rationale: "错误夹具" };
    expect(() => provider.validate(invalidQuantity)).toThrow("target_count=1");

    const extraConfiguration = source();
    extraConfiguration.provider.configuration.push({ key: "selector", value: "a" });
    expect(() => provider.validate(extraConfiguration)).toThrow("必须且只能包含");

    const undeclaredAsset = source();
    undeclaredAsset.rawOutputPolicy = { formats: ["html"], retainAssets: false };
    await expect(collect(provider.collect(undeclaredAsset, "run-1", fakeAdmission())))
      .rejects.toThrow("未声明 document");
  });

  it("把根 URL 与带尾斜杠的规范化 URL 视为同一个精确入口", () => {
    const provider = createPublicWebResourceProvider();
    const value = source();
    value.entryUrls = ["https://example.com"];
    value.stopPolicy.requestBudget = 4;
    value.targets = [target("homepage", "https://example.com")];

    expect(() => provider.validate(value)).not.toThrow();
  });
});

function source(): CrawlPlanSource {
  return {
    key: "public.docs", name: "公开资料", publisher: "示例机构", sourceKind: "technical_publisher",
    sourceCandidateIds: ["candidate-docs"], role: "保存官网与原理原文",
    entryUrls: ["https://example.com/manual", "https://example.com/principles"],
    provider: { key: "public.web-resource", version: "2.0.0", configuration: [
      { key: "mode", value: "planned_routes" }, { key: "maximum_bytes", value: 100_000 },
      { key: "maximum_pages_per_target", value: 40 },
    ] },
    accessPolicy: { kind: "paced_http", version: "public-v1", maxRequestsPerMinute: 10,
      minimumIntervalMs: 1, maximumRunMs: 10_000 },
    stopPolicy: { requestBudget: 6, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
    rawOutputPolicy: { formats: ["html", "document"], retainAssets: true },
    observationLevel: "search_discovered", accessState: "unknown", observedAt: "2026-08-20T00:00:00.000Z",
    targets: [target("official.manual", "https://example.com/manual"),
      target("technical.principles", "https://example.com/principles")], executionBlockers: [],
  };
}

function singleManualSource() {
  const value = source();
  value.entryUrls = ["https://example.com/manual"];
  value.targets = [value.targets[0]!];
  value.stopPolicy.requestBudget = 4;
  return value;
}

function target(key: string, url: string) {
  return { key, name: key, taskTopics: [key], providerConfiguration: [
    { key: "route", value: "exact" }, { key: "url", value: url }],
    captureUnit: "精确公开资源响应", rawFormats: ["HTML"],
    quantity: { mode: "target_count" as const, targetCount: 1, unit: "份", denominator: "计划冻结 URL",
      rationale: "保留一份不可变原始响应" }, uniqueKey: "URL", traversal: "只访问冻结 URL",
    stopCondition: "取得一次响应或发生访问限制" };
}

function siteSource(): CrawlPlanSource {
  const value = source();
  value.sourceKind = "brand_official";
  value.entryUrls = ["https://example.com/tvs"];
  value.stopPolicy = { requestBudget: 20, noNewUniqueKeysLimit: 20, stopOnAccessRestriction: true };
  value.rawOutputPolicy = { formats: ["html", "text", "source_json"], retainAssets: false };
  value.provider.configuration = [
    { key: "mode", value: "planned_routes" }, { key: "maximum_bytes", value: 100_000 },
    { key: "maximum_pages_per_target", value: 4 },
  ];
  value.targets = [{ ...target("official.catalog", "https://example.com/tvs"),
    providerConfiguration: [
      { key: "route", value: "site" }, { key: "url", value: "https://example.com/tvs" },
      { key: "required_terms", value: ["TCL", "电视"] }, { key: "maximum_depth", value: 2 },
      { key: "minimum_accepted_pages", value: 2 },
    ], quantity: { mode: "all_available", unit: "页", denominator: "计划内最多 4 页",
      rationale: "只计内容验收通过页面" } }];
  return value;
}

function response(statusCode: number, body: string, contentType = "text/plain") {
  return { statusCode, headers: { "content-type": contentType }, body: new TextEncoder().encode(body) };
}

async function collect<T>(iterable: AsyncIterable<T>) {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

function fakeAdmission() {
  let attempt = 0;
  return {
    ensureCaptureWorkItem: vi.fn(async (input) => input as never),
    startCaptureWorkItem: vi.fn(async (input) => input as never),
    finishCaptureWorkItem: vi.fn(async (input) => input as never),
    reserveRequest: vi.fn(async (input) => ({ status: "admitted" as const, attempt: {
      id: `attempt-${++attempt}`, runId: input.runId, targetKey: input.targetKey,
      workKey: input.workKey, requestedUrl: input.requestedUrl,
      state: "started", startedAt: "2026-08-21T00:00:00.000Z",
    } as never })),
    finishRequest: vi.fn(async (input) => input as never),
    getAccessGate: vi.fn(async () => null),
  } satisfies SourceRequestAdmissionPort;
}
