import type {
  CrawlPlanSource,
  SourceRequestAdmission,
  SourceRequestAdmissionPort,
  SourceRequestAttempt,
  SourceProviderEvent,
} from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import {
  calculateP1,
  createZolCategoryProvider,
  parseZolCatalogPage,
  parseZolCategoryPage,
  parseZolParameterPage,
  parseZolRankingPage,
} from "../src/zolCategoryProvider";
import type { RawPublicResponse } from "../src/publicResourceTransport";
import { normalizePublicRedirectUrl } from "../src/publicResourceTransport";

const categoryUrl = "https://detail.zol.com.cn/icebox/";
const rankingUrl = "https://top.zol.com.cn/compositor/359/manu_attention.html";
const catalogUrl = "https://detail.zol.com.cn/icebox/haier/";

describe("ZOL V0 category provider", () => {
  it("只把同主机的 HTTP canonical Location 安全规范化回 HTTPS", () => {
    const from = new URL("https://detail.zol.com.cn/2115/2100766/param.shtml");
    expect(normalizePublicRedirectUrl(from,
      new URL("http://detail.zol.com.cn/2101/2100766/param.shtml")).href)
      .toBe("https://detail.zol.com.cn/2101/2100766/param.shtml");
    const crossOrigin = new URL("http://other.example/2101/2100766/param.shtml");
    expect(normalizePublicRedirectUrl(from, crossOrigin)).toBe(crossOrigin);
  });

  it("按门类、品牌榜、品牌分页和参数页形成 7 页面闭环，并保存同源 robots 证据", async () => {
    const request = fixtureRequest();
    const admission = createAdmission();
    const provider = createZolCategoryProvider({ request, now: () => new Date("2026-08-28T00:00:00.000Z") });
    const source = zolSource();

    provider.validate(source);
    const events: SourceProviderEvent[] = [];
    for await (const event of provider.collect(source, "run-fixture", admission)) events.push(event);

    const captures = events.filter((event): event is Extract<SourceProviderEvent, { type: "capture" }> => event.type === "capture");
    const pageCaptures = captures.filter((event) => event.snapshot.observation.contentAssessment?.status !== "supporting");
    expect(events.at(-1)).toEqual({ type: "target.completed", targetKey: "zol.v0.pages" });
    expect(captures).toHaveLength(9);
    expect(pageCaptures).toHaveLength(7);
    expect(captures.filter((event) => event.snapshot.observation.contentAssessment?.status === "supporting"))
      .toHaveLength(2);
    expect(pageCaptures.map((event) => event.snapshot.observation.requestedUrl)).toEqual([
      categoryUrl, rankingUrl, catalogUrl, `${catalogUrl}2.html`,
      "https://detail.zol.com.cn/2115/1001/param.shtml",
      "https://detail.zol.com.cn/2115/1002/param.shtml",
      "https://detail.zol.com.cn/2115/1003/param.shtml",
    ]);
    expect(admission.attempts).toHaveLength(9);
    expect(admission.attempts.every((attempt) => attempt.gateKey.startsWith("zol.category@0.1.0:"))).toBe(true);

    const ranking = parseZolRankingPage(response(rankingUrl, rankingHtml()));
    const category = parseZolCategoryPage(response(categoryUrl, categoryHtml()));
    expect(calculateP1(category, ranking)).toMatchObject({
      coverage: 0.96,
      brands: [{ key: "haier" }, { key: "midea" }],
    });
    expect(parseZolCatalogPage(response(catalogUrl, catalogHtml(1)), new URL(catalogUrl), 1).pageCount).toBe(16);
    expect(parseZolParameterPage(response(
      "https://detail.zol.com.cn/2115/1001/param.shtml", parameterHtml(),
    ), "1001").sections).toEqual(["基本参数", "技术参数", "功能特点"]);
    expect(pageCaptures.every((event) => event.snapshot.payload?.kind === "inline_text")).toBe(true);
    expect(pageCaptures.every((event) => event.snapshot.observation.contentAssessment?.status === "accepted")).toBe(true);
    expect(pageCaptures.find((event) => event.snapshot.observation.requestedUrl === `${catalogUrl}2.html`)
      ?.snapshot.lineage).toEqual({ workKey: "page:catalog:2", discoveryKind: "html_link", depth: 1,
      parentUrl: catalogUrl });
    expect(pageCaptures.find((event) => event.snapshot.observation.requestedUrl.endsWith("/1001/param.shtml"))
      ?.snapshot.lineage).toEqual({ workKey: "page:param:1001", discoveryKind: "html_link", depth: 2,
      parentUrl: catalogUrl });
  });

  it("结构失败时先发出 rejected 原始快照，再停止执行", async () => {
    const admission = createAdmission();
    const provider = createZolCategoryProvider({
      request: fixtureRequest({ [`${catalogUrl}2.html`]: "<html><body>结构变化</body></html>" }),
      now: () => new Date("2026-08-28T00:00:00.000Z"),
    });
    const events: SourceProviderEvent[] = [];
    await expect((async () => {
      for await (const event of provider.collect(zolSource(), "run-structure-failure", admission)) events.push(event);
    })()).rejects.toThrow("品牌目录第 2 页没有可识别的型号 ID");

    const failedPage = events.find((event): event is Extract<SourceProviderEvent, { type: "capture" }> =>
      event.type === "capture" && event.snapshot.observation.requestedUrl === `${catalogUrl}2.html`);
    expect(failedPage?.snapshot.payload?.kind).toBe("inline_text");
    expect(failedPage?.snapshot.observation.contentAssessment).toMatchObject({
      status: "rejected", matchedSignals: ["catalog_page_2_structure"],
    });
    expect(events.some((event) => event.type === "target.completed")).toBe(false);
  });
});

function zolSource(): CrawlPlanSource {
  return {
    key: "zol.icebox.v0", name: "ZOL 冰箱 V0", publisher: "ZOL 中关村在线", sourceKind: "other",
    sourceCandidateIds: [], role: "门类品牌发现、P1、品牌分页与型号参数原文",
    entryUrls: [categoryUrl, rankingUrl],
    provider: { key: "zol.category", version: "0.1.0", configuration: [
      { key: "mode", value: "zol_v0" }, { key: "category_id", value: "2115" },
      { key: "category_url", value: categoryUrl }, { key: "ranking_url", value: rankingUrl },
      { key: "parameter_pages", value: 3 }, { key: "maximum_bytes", value: 25_000_000 },
    ] },
    accessPolicy: { kind: "paced_http", version: "zol-v0-1", maxRequestsPerMinute: 2,
      minimumIntervalMs: 30_000, maximumRunMs: 600_000 },
    stopPolicy: { requestBudget: 18, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
    rawOutputPolicy: { formats: ["html", "text"], retainAssets: false },
    observationLevel: "search_discovered", accessState: "public", observedAt: "2026-08-28T00:00:00.000Z",
    targets: [{ key: "zol.v0.pages", name: "ZOL V0 七页面原始响应", taskTopics: ["品牌", "型号", "参数"],
      captureUnit: "ZOL 原始 HTML/robots 响应", rawFormats: ["HTML", "TEXT"],
      quantity: { mode: "target_count", targetCount: 7, unit: "页面",
        denominator: "1 门类 + 1 品牌榜 + 2 品牌列表页 + 3 型号参数页", rationale: "ZOL V0" },
      uniqueKey: "ZOL URL 与型号 ID", traversal: "门类 → P1 → 首个 P1 品牌两页列表 → 三个型号参数页",
      stopCondition: "任何访问限制或结构失败立即停止", providerConfiguration: [{ key: "route", value: "zol_v0" }] }],
    executionBlockers: [],
  };
}

function createAdmission() {
  const attempts: SourceRequestAttempt[] = [];
  const admission: SourceRequestAdmissionPort & { attempts: SourceRequestAttempt[] } = {
    attempts,
    async ensureCaptureWorkItem() { return undefined as never; },
    async startCaptureWorkItem() { return undefined as never; },
    async finishCaptureWorkItem() { return undefined as never; },
    async reserveRequest(input): Promise<SourceRequestAdmission> {
      const attempt = {
        id: `attempt-${attempts.length + 1}`, runId: input.runId, targetKey: input.targetKey, workKey: input.workKey,
        gateKey: input.gateKey, requestedUrl: input.requestedUrl, origin: `${new URL(input.requestedUrl).origin}/`,
        startedAt: new Date("2026-08-28T00:00:00.000Z").toISOString(), state: "started" as const,
      } satisfies SourceRequestAttempt;
      attempts.push(attempt);
      return { status: "admitted", attempt };
    },
    async finishRequest(input) {
      const attempt = attempts.find((item) => item.id === input.attemptId)!;
      Object.assign(attempt, input);
      return attempt;
    },
    async getAccessGate() { return null; },
  };
  return admission;
}

function fixtureRequest(overrides: Record<string, string> = {}) {
  return async (url: URL): Promise<RawPublicResponse> => {
    const robots = url.pathname === "/robots.txt";
    const html = robots ? "User-agent: *\nAllow: /\n" : overrides[url.href] ?? fixtureBody(url.href);
    return response(url.href, html, robots ? "text/plain" : "text/html; charset=GBK");
  };
}

function fixtureBody(url: string) {
  if (url === categoryUrl) return categoryHtml();
  if (url === rankingUrl) return rankingHtml();
  if (url === catalogUrl) return catalogHtml(1);
  if (url === `${catalogUrl}2.html`) return catalogHtml(2);
  if (url.endsWith("/param.shtml")) return parameterHtml();
  throw new Error(`unexpected fixture URL: ${url}`);
}

function response(finalUrl: string, body: string, mediaType = "text/html; charset=GBK"): RawPublicResponse {
  return { statusCode: 200, headers: { "content-type": mediaType }, body: new TextEncoder().encode(body), finalUrl };
}

function categoryHtml() {
  return `<div id="J_BrandAll"><a data-link="1" href="/icebox/haier/">Haier 海尔</a>
    <a href="/icebox/midea/">Midea 美的</a><a href="/icebox/haier/">重复海尔</a></div>`;
}

function rankingHtml() {
  return `<ul>
    <li class="rank-list__item"><div class="cell-2"><a class="name" href="https://detail.zol.com.cn/icebox/haier/">Haier</a></div>
      <div class="cell-3">99.5</div><div class="cell-5"><span style="width:61%"></span></div><div class="cell-7">[共 741 款]</div></li>
    <li class="rank-list__item"><div class="cell-2"><a class="name" href="https://detail.zol.com.cn/icebox/midea/">Midea</a></div>
      <div class="cell-3">94.1</div><div class="cell-5"><span style="width:35%"></span></div><div class="cell-7">[共 436 款]</div></li>
  </ul>`;
}

function catalogHtml(page: number) {
  const models = page === 1
    ? [["1001", "海尔冰箱 1001"], ["1002", "海尔冰箱 1002"]]
    : [["1002", "海尔冰箱 1002"], ["1003", "海尔冰箱 1003"]];
  return `<div class="sort-box"><span class="total">共 743 款</span></div><span class="small-page-active">${page}/16</span>
    <ul id="J_PicMode">${models.map(([id, name]) => `<li><a class="pic" href="/icebox/index${id}.shtml"><img alt="${name}"></a><h3><a href="/icebox/index${id}.shtml">${name}</a></h3></li>`).join("")}</ul>`;
}

function parameterHtml() {
  return `<table><tr><td class="hd">基本参数</td></tr><tr><td class="hd">技术参数</td></tr>
    <tr><td class="hd">功能特点</td></tr></table>`;
}
