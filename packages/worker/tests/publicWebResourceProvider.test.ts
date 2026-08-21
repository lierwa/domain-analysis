import { Readable } from "node:stream";

import type { CrawlPlanSource, SourceRequestAdmissionPort } from "@domain-analysis/shared";
import { describe, expect, it, vi } from "vitest";

import {
  assertPublicAddress,
  assertPublicHttpsUrl,
  createPublicResourceTransport,
  createPublicWebResourceProvider,
  pinnedHttpsRequestOptions,
  readBoundedBody,
} from "../src";

describe("公共原始资源 Provider", () => {
  it("逐 target 读取冻结 URL，并返回可对账的 capture/completed 事件", async () => {
    const requested: string[] = [];
    const provider = createPublicWebResourceProvider({
      now: () => new Date("2026-08-20T00:00:00.000Z"),
      request: async (url) => {
        requested.push(url.href);
        if (url.pathname === "/robots.txt") return response(200, "User-agent: *\nAllow: /");
        return response(200, `<html>${url.pathname}</html>`, "text/html; charset=utf-8");
      },
    });
    const events = [];
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

  it("只按计划中的唯一链接文字跟进一次同源附件", async () => {
    const requested: string[] = [];
    const provider = createPublicWebResourceProvider({
      request: async (url) => {
        requested.push(url.href);
        if (url.pathname === "/robots.txt") return response(200, "User-agent: *\nAllow: /");
        if (url.pathname === "/product") return response(200,
          '<a href="/manual.pdf">查看说明书</a>', "text/html; charset=utf-8");
        return response(200, "%PDF", "application/pdf");
      },
    });
    const linked = linkedSource();
    const events = await collect(provider.collect(linked, "run-1", fakeAdmission()));

    expect(requested).toEqual([
      "https://example.com/robots.txt",
      "https://example.com/product",
      "https://example.com/manual.pdf",
    ]);
    expect(events.map((event) => [event.type, event.targetKey])).toEqual([
      ["capture", "official.product"], ["target.completed", "official.product"],
      ["capture", "official.manual"], ["target.completed", "official.manual"],
    ]);
    expect(events[2]).toMatchObject({ type: "capture", snapshot: { payload: { kind: "asset" } } });
  });

  it("拒绝私网、凭证、redirect/retry 和超出字节上限", async () => {
    expect(() => assertPublicHttpsUrl("https://127.0.0.1/manual")).toThrow("非公网地址");
    expect(() => assertPublicHttpsUrl("https://user:secret@example.com/manual")).toThrow("凭证");
    expect(() => assertPublicAddress("::1", 6)).toThrow("非公网地址");
    expect(() => assertPublicAddress("8.8.8.8", 4)).not.toThrow();
    expect(pinnedHttpsRequestOptions(new URL("https://example.com/manual"), "93.184.216.34"))
      .toMatchObject({ hostname: "93.184.216.34", servername: "example.com", path: "/manual",
        headers: { host: "example.com" } });
    await expect(readBoundedBody(Readable.from([Buffer.alloc(3), Buffer.alloc(3)]), 5))
      .rejects.toThrow("超过最大字节");
  });

  it("Fake-IP 环境通过可信 DoH 取得公网地址，并把代理连接固定到该地址", async () => {
    const requestPinned = vi.fn(async () => response(200, "ok"));
    const transport = createPublicResourceTransport({
      lookup: async () => [{ address: "198.18.0.9", family: 4 }],
      resolveViaDoh: async () => [{ address: "23.199.232.87", family: 4 }],
      requestPinned,
      proxyEnv: { https_proxy: "http://127.0.0.1:7890" },
    });

    await expect(transport(new URL("https://www.fda.gov/manual"), 10_000))
      .resolves.toMatchObject({ statusCode: 200 });
    expect(requestPinned).toHaveBeenCalledWith(expect.objectContaining({
      url: new URL("https://www.fda.gov/manual"),
      address: "23.199.232.87",
      maximumBytes: 10_000,
    }));
  });

  it("robots 与 target 每个 HTTP hop 都先进入持久准入，gate 按 origin 共享", async () => {
    const admission = fakeAdmission();
    const provider = createPublicWebResourceProvider({
      request: async (url) => url.pathname === "/robots.txt"
        ? response(200, "User-agent: *\nAllow: /")
        : response(200, "<html>ok</html>", "text/html; charset=utf-8"),
    });

    await collect(provider.collect(source(), "run-1", admission));

    expect(admission.reserveRequest).toHaveBeenCalledTimes(3);
    expect(admission.reserveRequest.mock.calls.map(([input]) => [input.gateKey, input.requestedUrl]))
      .toEqual([
        ["public.web-resource@1.0.0:https://example.com", "https://example.com/robots.txt"],
        ["public.web-resource@1.0.0:https://example.com", "https://example.com/manual"],
        ["public.web-resource@1.0.0:https://example.com", "https://example.com/principles"],
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
    value.stopPolicy.requestBudget = 2;
    value.targets = [target("homepage", "https://example.com")];

    expect(() => provider.validate(value)).not.toThrow();
  });
});

function source(): CrawlPlanSource {
  return {
    key: "public.docs", name: "公开资料", publisher: "示例机构", sourceKind: "technical_publisher",
    sourceCandidateIds: ["candidate-docs"], role: "保存官网与原理原文",
    entryUrls: ["https://example.com/manual", "https://example.com/principles"],
    provider: { key: "public.web-resource", version: "1.0.0", configuration: [
      { key: "mode", value: "exact_https" }, { key: "maximum_bytes", value: 100_000 },
    ] },
    accessPolicy: { kind: "paced_http", version: "public-v1", maxRequestsPerMinute: 10,
      minimumIntervalMs: 1, maximumRunMs: 10_000 },
    stopPolicy: { requestBudget: 3, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
    rawOutputPolicy: { formats: ["html", "document"], retainAssets: true },
    observationLevel: "search_discovered", accessState: "unknown", observedAt: "2026-08-20T00:00:00.000Z",
    targets: [target("official.manual", "https://example.com/manual"),
      target("technical.principles", "https://example.com/principles")], executionBlockers: [],
  };
}

function target(key: string, url: string) {
  return { key, name: key, taskTopics: [key], providerConfiguration: [{ key: "url", value: url }],
    captureUnit: "精确公开资源响应", rawFormats: ["HTML"],
    quantity: { mode: "target_count" as const, targetCount: 1, unit: "份", denominator: "计划冻结 URL",
      rationale: "保留一份不可变原始响应" }, uniqueKey: "URL", traversal: "只访问冻结 URL",
    stopCondition: "取得一次响应或发生访问限制" };
}

function linkedSource(): CrawlPlanSource {
  const value = source();
  value.entryUrls = ["https://example.com/product"];
  value.stopPolicy.requestBudget = 3;
  value.targets = [target("official.product", "https://example.com/product"), {
    ...target("official.manual", "https://example.com/manual.pdf"),
    providerConfiguration: [
      { key: "from_target", value: "official.product" },
      { key: "link_text", value: "查看说明书" },
    ],
  }];
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
