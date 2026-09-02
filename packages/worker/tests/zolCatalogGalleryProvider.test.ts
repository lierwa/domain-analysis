import type {
  CrawlPlanSource,
  SourceProviderEvent,
  SourceRequestAdmission,
  SourceRequestAdmissionPort,
  SourceRequestAttempt,
} from "@domain-analysis/shared";
import { describe, expect, it, vi } from "vitest";

import type { RawPublicResponse } from "../src/publicResourceTransport";
import { createZolCatalogGalleryProvider } from "../src/zolCatalogGalleryProvider";
import { parseZolCatalogPage, zolProductGroupId } from "../src/zolCatalogParsing";

const catalogs = [
  "https://detail.zol.com.cn/icebox/haier/",
  "https://detail.zol.com.cn/icebox/midea/",
];
describe("ZOL 品牌目录批次参数与图集 Provider", () => {
  it("交错抓取两个品牌各两个型号，并把每个图集的全部不同大图保存为资产", async () => {
    vi.useFakeTimers();
    const admission = createAdmission();
    const provider = createZolCatalogGalleryProvider({
      request: fixtureRequest(),
      now: () => new Date("2026-08-29T00:00:00.000Z"),
    });
    const events: SourceProviderEvent[] = [];

    provider.validate(source());
    const collection = (async () => {
      for await (const event of provider.collect(source(), "run-v1", admission)) events.push(event);
    })();
    await vi.runAllTimersAsync();
    await collection;
    vi.useRealTimers();

    const captures = events.filter((event): event is Extract<SourceProviderEvent, { type: "capture" }> =>
      event.type === "capture");
    const parameterUrls = captures.map((event) => event.snapshot.observation.requestedUrl)
      .filter((url) => url.endsWith("/param.shtml"));
    const galleryCaptures = captures.filter((event) => event.resourceReferences?.length);
    const imageCaptures = captures.filter((event) => event.snapshot.payload?.kind === "asset");

    expect(events.at(-1)).toEqual({
      type: "target.completed",
      targetKey: "zol.icebox.catalog-batch.models",
      observedUnitCount: 4,
    });
    expect(parameterUrls).toEqual([
      "https://detail.zol.com.cn/2115/2114001/param.shtml",
      "https://detail.zol.com.cn/2115/2114011/param.shtml",
      "https://detail.zol.com.cn/2115/2114002/param.shtml",
      "https://detail.zol.com.cn/2115/2114012/param.shtml",
    ]);
    expect(galleryCaptures).toHaveLength(4);
    expect(galleryCaptures.flatMap((event) => event.resourceReferences ?? [])).toHaveLength(8);
    expect(galleryCaptures.flatMap((event) => event.resourceReferences ?? [])
      .every((reference) => reference.sourceUrl.includes("/product/"))).toBe(true);
    expect(imageCaptures).toHaveLength(8);
    expect(imageCaptures.every((event) => event.snapshot.payload?.kind === "asset"
      && event.snapshot.payload.mediaType === "image/jpeg")).toBe(true);
    expect(admission.attempts).toHaveLength(24);
    expect(admission.requestLanes.filter((lane) => lane === "asset")).toHaveLength(9);
    const imageWorkKeys = admission.attempts.filter((attempt) => attempt.workKey.startsWith("asset:image:"))
      .map((attempt) => attempt.workKey);
    expect(new Set(imageWorkKeys).size).toBe(8);
    expect(admission.completedModelWorkKeys).toHaveLength(4);
    expect(admission.attempts.filter((attempt) => attempt.requestedUrl.endsWith("/robots.txt")
      && attempt.origin.includes("zol-img.com.cn")).every((attempt) => attempt.state === "completed")).toBe(true);
  });

  it("拒绝把缺少图片原始格式的计划当作可执行计划", () => {
    const invalid = source();
    invalid.rawOutputPolicy = { formats: ["html", "text"], retainAssets: true };

    expect(() => createZolCatalogGalleryProvider().validate(invalid))
      .toThrow("必须保存 HTML、文本和图片原始附件");
  });

  it("标题声明数量落后于产品 picList 时保留全部有效图片并记录差异", async () => {
    vi.useFakeTimers();
    const provider = createZolCatalogGalleryProvider({ request: fixtureRequest(1) });
    const events: SourceProviderEvent[] = [];

    const collection = (async () => {
      for await (const event of provider.collect(source(), "run-count-mismatch", createAdmission())) events.push(event);
    })();
    await vi.runAllTimersAsync();
    await collection;
    vi.useRealTimers();

    const captures = events.filter((event): event is Extract<SourceProviderEvent, { type: "capture" }> =>
      event.type === "capture");
    expect(events.at(-1)).toMatchObject({ type: "target.completed", observedUnitCount: 4 });
    expect(captures.filter((event) => event.snapshot.payload?.kind === "asset")).toHaveLength(8);
    expect(captures.filter((event) => event.resourceReferences?.length)
      .every((event) => event.snapshot.observation.contentAssessment?.reason.includes("按 picList 保存"))).toBe(true);
  });

  it("恢复时跳过前序已完整完成的型号，但业务分母保持四个型号", async () => {
    vi.useFakeTimers();
    const admission = createAdmission();
    const provider = createZolCatalogGalleryProvider({ request: fixtureRequest() });
    const crawlSource = source();
    if (crawlSource.accessPolicy.kind !== "paced_http") throw new Error("测试策略必须是 paced_http");
    const events: SourceProviderEvent[] = [];
    const collection = (async () => {
      for await (const event of provider.collect(crawlSource, "run-resumed", admission, undefined, {
        queueRunId: "run-v1", resumedFromRunId: "run-v1",
        accessPolicy: { ...crawlSource.accessPolicy, jitterMs: { min: 0, max: 0 },
          batchSize: 1, batchCooldownMs: 5_000 },
        completedWorkKeys: ["model:haier:2114001"],
      })) events.push(event);
    })();
    await vi.runAllTimersAsync();
    await collection;
    vi.useRealTimers();

    const requested = admission.attempts.map((attempt) => attempt.requestedUrl);
    expect(requested).not.toContain("https://detail.zol.com.cn/2115/2114001/param.shtml");
    expect(events.at(-1)).toMatchObject({ type: "target.completed", observedUnitCount: 4 });
    expect(admission.completedModelWorkKeys).toHaveLength(3);
  });

  it("拒绝超过每品牌目标数的型号批次", () => {
    const invalid = source();
    const item = invalid.provider.configuration.find((entry) => entry.key === "model_batch_size")!;
    item.value = 3;

    expect(() => createZolCatalogGalleryProvider().validate(invalid))
      .toThrow("品牌组、型号批次、目标数量、页数或字节上限无效");
  });

  it("按型号 ID 计算参数页分片，并接受其他 ZOL 门类的稳定 slug", () => {
    expect(zolProductGroupId("2114234")).toBe("2115");
    expect(zolProductGroupId("1101178")).toBe("1102");
    expect(zolProductGroupId("357868")).toBe("358");

    const html = '<ul class="pic-mode-box"><li><h3><a href="/digital_tv/index1101178.shtml">乐视超3 X43</a></h3></li></ul>';
    const facts = parseZolCatalogPage(response("https://detail.zol.com.cn/digital_tv/hisense/", html),
      new URL("https://detail.zol.com.cn/digital_tv/hisense/"), 1, "digital_tv");
    expect(facts.models).toEqual([{ id: "1101178", name: "乐视超3 X43",
      url: "https://detail.zol.com.cn/digital_tv/index1101178.shtml" }]);

    const titled = '<ul class="pic-mode-box"><li><h3><a href="/digital_tv/index1228243.shtml" title="方太W25800K-01AG">方太W25800K-01AG 产品容量 25L</a></h3></li></ul>';
    expect(parseZolCatalogPage(response("https://detail.zol.com.cn/digital_tv/fotile/", titled),
      new URL("https://detail.zol.com.cn/digital_tv/fotile/"), 1, "digital_tv").models[0]?.name)
      .toBe("方太W25800K-01AG");

    const television = source();
    const urls = ["https://detail.zol.com.cn/digital_tv/hisense/"];
    television.entryUrls = urls;
    television.provider.configuration.find((item) => item.key === "category_slug")!.value = "digital_tv";
    television.provider.configuration.find((item) => item.key === "brand_catalog_urls")!.value = urls;
    television.provider.configuration.find((item) => item.key === "brand_batch_size")!.value = 3;
    if (television.targets[0]!.quantity.mode !== "target_count") throw new Error("测试 target 必须是目标数量");
    television.targets[0]!.quantity.targetCount = 2;
    expect(() => createZolCatalogGalleryProvider().validate(television)).not.toThrow();
  });

  it("品牌目录不足任务上限时按来源穷尽完成，并返回实际型号数", async () => {
    vi.useFakeTimers();
    const crawlSource = source();
    crawlSource.provider.configuration.find((item) => item.key === "target_models_per_brand")!.value = 3;
    if (crawlSource.targets[0]!.quantity.mode !== "target_count") throw new Error("测试 target 必须是目标数量");
    crawlSource.targets[0]!.quantity.targetCount = 6;
    const events: SourceProviderEvent[] = [];
    const collection = (async () => {
      for await (const event of createZolCatalogGalleryProvider({ request: fixtureRequest() })
        .collect(crawlSource, "run-exhausted", createAdmission())) events.push(event);
    })();
    await vi.runAllTimersAsync();
    await collection;
    vi.useRealTimers();

    expect(events.at(-1)).toEqual({ type: "target.completed",
      targetKey: "zol.icebox.catalog-batch.models", observedUnitCount: 4 });
    expect(events.some((event) => event.type === "capture"
      && event.snapshot.observation.contentAssessment?.reason.includes("来源目录已穷尽"))).toBe(true);
  });

  it("单个型号的 DNS 重试耗尽后记录失败并继续后续型号", async () => {
    vi.useFakeTimers();
    try {
      const baseRequest = fixtureRequest();
      const admission = createAdmission();
      let failedParameterAttempts = 0;
      const provider = createZolCatalogGalleryProvider({ request: async (url) => {
        if (url.pathname === "/2115/2114001/param.shtml" && failedParameterAttempts < 2) {
          failedParameterAttempts += 1;
          throw new Error("可信 DoH 查询失败：DNS status 2");
        }
        return baseRequest(url);
      } });
      const events: SourceProviderEvent[] = [];
      const collection = (async () => {
        for await (const event of provider.collect(source(), "run-transient-model", admission)) events.push(event);
      })();

      await vi.runAllTimersAsync();
      await collection;

      expect(failedParameterAttempts).toBe(2);
      expect(admission.failedModelWorkKeys).toEqual(["model:haier:2114001"]);
      expect(admission.failedModelReasons[0]).toContain("DNS status 2");
      expect(admission.completedModelWorkKeys).toHaveLength(3);
      expect(events.at(-1)).toMatchObject({ type: "target.completed", observedUnitCount: 4 });
      expect(admission.attempts.some((attempt) =>
        attempt.requestedUrl.endsWith("/2115/2114012/param.shtml"))).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("单个品牌目录的临时失败不阻断后续品牌", async () => {
    vi.useFakeTimers();
    try {
      const baseRequest = fixtureRequest();
      const admission = createAdmission();
      let failedCatalogAttempts = 0;
      const provider = createZolCatalogGalleryProvider({ request: async (url) => {
        if (url.href === catalogs[0] && failedCatalogAttempts < 2) {
          failedCatalogAttempts += 1;
          throw new Error("可信 DoH 查询失败：DNS status 2");
        }
        return baseRequest(url);
      } });
      const events: SourceProviderEvent[] = [];
      const collection = (async () => {
        for await (const event of provider.collect(source(), "run-transient-brand", admission)) events.push(event);
      })();

      await vi.runAllTimersAsync();
      await collection;

      expect(failedCatalogAttempts).toBe(2);
      expect(admission.failedWorkKeys).toContain("page:brand:haier:1");
      expect(admission.completedModelWorkKeys).toEqual([
        "model:midea:2114011", "model:midea:2114012",
      ]);
      expect(events.at(-1)).toMatchObject({ type: "target.completed", observedUnitCount: 2 });
    } finally { vi.useRealTimers(); }
  });

  it("单个品牌目录返回 404 时记录该品牌并继续后续品牌", async () => {
    vi.useFakeTimers();
    try {
      const baseRequest = fixtureRequest();
      const admission = createAdmission();
      const provider = createZolCatalogGalleryProvider({ request: async (url) =>
        url.href === catalogs[0]
          ? { statusCode: 404, headers: { "content-type": "text/html" },
            body: new Uint8Array(), finalUrl: url.href }
          : baseRequest(url) });
      const events: SourceProviderEvent[] = [];
      const collection = (async () => {
        for await (const event of provider.collect(source(), "run-missing-brand", admission)) events.push(event);
      })();

      await vi.runAllTimersAsync();
      await collection;

      expect(events.some((event) => event.type === "capture"
        && event.snapshot.observation.requestedUrl === catalogs[0]
        && event.snapshot.observation.state === "not_found")).toBe(true);
      expect(admission.attempts.filter((attempt) => attempt.requestedUrl === catalogs[0])).toHaveLength(2);
      expect(admission.completedModelWorkKeys).toEqual([
        "model:midea:2114011", "model:midea:2114012",
      ]);
      expect(events.at(-1)).toMatchObject({ type: "target.completed", observedUnitCount: 2 });
    } finally { vi.useRealTimers(); }
  });

  it("型号图集局部结构异常只结束当前型号并继续后续型号", async () => {
    vi.useFakeTimers();
    try {
      const baseRequest = fixtureRequest();
      const admission = createAdmission();
      const provider = createZolCatalogGalleryProvider({ request: async (url) => {
        if (url.pathname === "/2115/2114001/pic.shtml") {
          return response(url.href, "<html>当前型号没有图集分区</html>");
        }
        if (url.pathname === "/picture_index_1/index211401101_0_p2114011.shtml") {
          return response(url.href, "<html>当前型号大图详情没有 picList</html>");
        }
        return baseRequest(url);
      } });
      const events: SourceProviderEvent[] = [];
      const collection = (async () => {
        for await (const event of provider.collect(source(), "run-gallery-model-failure", admission)) events.push(event);
      })();

      await vi.runAllTimersAsync();
      await collection;

      expect(admission.failedModelWorkKeys).toEqual([
        "model:haier:2114001", "model:midea:2114011",
      ]);
      expect(admission.completedModelWorkKeys).toHaveLength(2);
      expect(events.at(-1)).toMatchObject({ type: "target.completed", observedUnitCount: 4 });
      expect(admission.attempts.some((attempt) =>
        attempt.requestedUrl.endsWith("/2115/2114012/param.shtml"))).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("源站明确暂无图片时完成型号并保留零图片结果", async () => {
    vi.useFakeTimers();
    try {
      const baseRequest = fixtureRequest();
      const admission = createAdmission();
      const provider = createZolCatalogGalleryProvider({ request: async (url) => {
        if (url.pathname === "/2115/2114001/pic.shtml") {
          return response(url.href, '<main><p class="nopic">暂无图片</p></main>');
        }
        return baseRequest(url);
      } });
      const events: SourceProviderEvent[] = [];
      const collection = (async () => {
        for await (const event of provider.collect(source(), "run-source-no-images", admission)) events.push(event);
      })();

      await vi.runAllTimersAsync();
      await collection;

      expect(admission.failedModelWorkKeys).toEqual([]);
      expect(admission.completedModelWorkKeys).toHaveLength(4);
      expect(events.filter((event) => event.type === "capture"
        && event.snapshot.payload?.kind === "asset")).toHaveLength(6);
      expect(events.at(-1)).toMatchObject({ type: "target.completed", observedUnitCount: 4 });
    } finally { vi.useRealTimers(); }
  });

  it("型号页面结构无法绑定时停止当前来源运行", async () => {
    const baseRequest = fixtureRequest();
    const admission = createAdmission();
    const provider = createZolCatalogGalleryProvider({ request: async (url) => {
      if (url.pathname === "/2115/2114001/param.shtml") return response(url.href, "<html>结构已变化</html>");
      return baseRequest(url);
    } });
    const collect = async () => {
      for await (const _event of provider.collect(source(), "run-structural-failure", admission)) { /* consume */ }
    };

    await expect(collect()).rejects.toMatchObject({ category: "plan_revision_required" });
    expect(admission.attempts.some((attempt) =>
      attempt.requestedUrl.endsWith("/2115/2114011/param.shtml"))).toBe(false);
  });
});

function source(): CrawlPlanSource {
  return {
    key: "zol.icebox.catalog-batch",
    name: "ZOL 冰箱双品牌目录批次",
    publisher: "ZOL 中关村在线",
    sourceKind: "other",
    sourceCandidateIds: [],
    role: "双品牌参数与图集",
    entryUrls: catalogs,
    provider: { key: "zol.catalog-gallery", version: "1.2.0", configuration: [
      { key: "mode", value: "zol_catalog_batch" },
      { key: "category_slug", value: "icebox" },
      { key: "brand_catalog_urls", value: catalogs },
      { key: "brand_batch_size", value: 2 },
      { key: "model_batch_size", value: 2 },
      { key: "target_models_per_brand", value: 2 },
      { key: "maximum_catalog_pages", value: 30 },
      { key: "maximum_html_bytes", value: 25_000_000 },
      { key: "maximum_image_bytes", value: 10_000_000 },
    ] },
    accessPolicy: { kind: "paced_http", version: "zol-catalog-gallery-v2", maxRequestsPerMinute: 12,
      minimumIntervalMs: 5_000, maximumRunMs: 10_800_000,
      assetPolicy: { maxRequestsPerMinute: 30, minimumIntervalMs: 2_000,
        concurrency: 2, queueCapacity: 100 } },
    stopPolicy: { requestBudget: 200, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
    rawOutputPolicy: { formats: ["html", "text", "image"], retainAssets: true },
    observationLevel: "search_discovered",
    accessState: "public",
    observedAt: "2026-08-29T00:00:00.000Z",
    targets: [{ key: "zol.icebox.catalog-batch.models", name: "四型号参数与图集",
      taskTopics: ["品牌", "型号", "参数", "图片"],
      captureUnit: "一个型号的参数页、图集页和全部不同商品图",
      rawFormats: ["HTML", "IMAGE", "TEXT"],
      quantity: { mode: "target_count", targetCount: 4, unit: "型号",
        denominator: "海尔、美的品牌目录各前两个型号", rationale: "正式执行前验证" },
      uniqueKey: "品牌 key + 产品 ID；图片 URL + 内容哈希",
      traversal: "品牌目录 → 参数页 → 图集页 → 原图",
      stopCondition: "限制、结构异常或预算耗尽立即停止",
      providerConfiguration: [{ key: "route", value: "zol_catalog_batch" }],
    }],
    executionBlockers: [],
  };
}

function fixtureRequest(declaredImageCount = 2) {
  return async (url: URL): Promise<RawPublicResponse> => {
    if (url.pathname === "/robots.txt") return url.hostname.endsWith("zol-img.com.cn")
      ? { statusCode: 403, headers: { "content-type": "text/plain" }, body: new Uint8Array(), finalUrl: url.href }
      : response(url.href, "User-agent: *\nAllow: /\n", "text/plain");
    if (/\.(?:jpe?g)$/i.test(url.pathname)) {
      return { statusCode: 200, headers: { "content-type": "image/jpeg" },
        body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), finalUrl: url.href };
    }
    return response(url.href, fixtureHtml(url.href, declaredImageCount));
  };
}

function fixtureHtml(url: string, declaredImageCount: number) {
  for (const catalog of catalogs) {
    if (url === catalog) {
      const prefix = catalog.includes("haier") ? "211400" : "211401";
      return `<ul class="pic-mode-box">
        <li><a class="pic" href="/icebox/index${prefix}1.shtml"><img alt="型号 ${prefix}1"></a><h3><a href="/icebox/index${prefix}1.shtml">型号 ${prefix}1</a></h3></li>
        <li><a class="pic" href="/icebox/index${prefix}2.shtml"><img alt="型号 ${prefix}2"></a><h3><a href="/icebox/index${prefix}2.shtml">型号 ${prefix}2</a></h3></li>
      </ul><span class="small-page-active">1/1</span>`;
    }
  }
  const parameter = url.match(/\/\d+\/(\d+)\/param\.shtml$/);
  if (parameter) return `<table><tr><td class="hd">基本参数</td></tr>
    <tr><td class="hd">技术参数</td></tr></table><a href="/2115/${parameter[1]}/pic.shtml">产品图片</a>`;
  const gallery = url.match(/\/\d+\/(\d+)\/pic\.shtml$/);
  if (gallery) return `<main class="gallery"><div class="section">
    <div class="section-header"><h3>产品外观 (${declaredImageCount}张)</h3></div><ul class="picture-list">
      <li><a class="imgwrap" href="/picture_index_1/index${gallery[1]}01_0_p${gallery[1]}.shtml">缩略图</a></li>
      <li><a class="more" href="/picture_index_1/index${gallery[1]}01_0_p${gallery[1]}.shtml">查看大图</a></li>
    </ul></div><div id="samePro"><a href="/other/pic.shtml">相关产品</a></div></main>`;
  const picture = url.match(/\/picture_index_1\/index(\d+)01_0_p(\d+)\.shtml$/);
  if (picture) return `<script>var picList = [
    {"proId":${picture[2]},"picSrc":"https://2e.zol-img.com.cn/product/${picture[2]}_100x75/1/front.jpg","hash":"front","extName":"jpg","sizeInfo":{"source":["1200","900"]},"className":"产品外观"},
    {"proId":${picture[2]},"picSrc":"https://2e.zol-img.com.cn/product/${picture[2]}_100x75/2/side.jpg","hash":"side","extName":"jpg","sizeInfo":{"source":["1200","900"]},"className":"产品外观"},
    {"proId":${picture[2]},"picSrc":"https://2e.zol-img.com.cn/product/${picture[2]}_100x75/1/front.jpg","hash":"front","extName":"jpg","sizeInfo":{"source":["1200","900"]},"className":"白色"},
    {"proId":9999,"picSrc":"https://2e.zol-img.com.cn/product/other_100x75/3/wrong.jpg","hash":"wrong","extName":"jpg","sizeInfo":{"source":["1200","900"]},"className":"相关产品"}
  ];</script><div id="samePro"><img src="https://2e.zol-img.com.cn/product/other/recommended.jpg"></div>`;
  throw new Error(`unexpected fixture URL: ${url}`);
}

function response(finalUrl: string, body: string, mediaType = "text/html; charset=UTF-8"): RawPublicResponse {
  return { statusCode: 200, headers: { "content-type": mediaType },
    body: new TextEncoder().encode(body), finalUrl };
}

function createAdmission() {
  const attempts: SourceRequestAttempt[] = [];
  const requestLanes: Array<"asset" | undefined> = [];
  const completedModelWorkKeys: string[] = [];
  const failedModelWorkKeys: string[] = [];
  const failedModelReasons: string[] = [];
  const failedWorkKeys: string[] = [];
  const admission: SourceRequestAdmissionPort & { attempts: SourceRequestAttempt[];
    requestLanes: Array<"asset" | undefined>; completedModelWorkKeys: string[];
    failedModelWorkKeys: string[]; failedModelReasons: string[]; failedWorkKeys: string[] } = {
    attempts,
    requestLanes,
    completedModelWorkKeys,
    failedModelWorkKeys,
    failedModelReasons,
    failedWorkKeys,
    async ensureCaptureWorkItem() { return undefined as never; },
    async startCaptureWorkItem() { return undefined as never; },
    async finishCaptureWorkItem(input) {
      if (input.workKey.startsWith("model:") && input.status === "completed") {
        completedModelWorkKeys.push(input.workKey);
      }
      if (input.workKey.startsWith("model:") && input.status === "failed") {
        failedModelWorkKeys.push(input.workKey);
        failedModelReasons.push(input.terminationReason ?? "");
      }
      if (input.status === "failed") failedWorkKeys.push(input.workKey);
      return undefined as never;
    },
    async reserveRequest(input): Promise<SourceRequestAdmission> {
      requestLanes.push(input.requestLane);
      const attempt = { id: `attempt-${attempts.length + 1}`, runId: input.runId,
        targetKey: input.targetKey, workKey: input.workKey, gateKey: input.gateKey,
        requestedUrl: input.requestedUrl, origin: `${new URL(input.requestedUrl).origin}/`,
        startedAt: "2026-08-29T00:00:00.000Z", state: "started" as const } satisfies SourceRequestAttempt;
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
