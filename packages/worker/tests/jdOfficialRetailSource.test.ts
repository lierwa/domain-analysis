import { describe, expect, it } from "vitest";

import {
  createJdOfficialRetailSource,
  type JdPageReader,
} from "../src/jdOfficialRetailSource";

const catalogUrl = "https://www.jd.com/brand/737a81dda3769f80aa8.html";

describe("JD official direct-retail source", () => {
  it("枚举全部自营分页，只以详情规格确认冰箱品牌和厂商型号", async () => {
    const reader = createFixtureReader();
    const source = createJdOfficialRetailSource({
      allowedOrigins: ["https://www.jd.com", "https://item.jd.com"],
      now: () => new Date("2026-08-16T12:00:00.000Z"),
      pageReader: reader,
      accessPolicy: fixtureAccessPolicy(),
    });

    const snapshot = await source.enumerate();

    expect(snapshot).toMatchObject({
      sourceIdentity: "jd-cn-self-operated-refrigerator-channel",
      sourceAuthorityType: "official_direct_retail",
      coverageKind: "official_channel_discovery",
      coverageStatus: "complete",
      declaredItemCount: 3,
      fetchedItemCount: 3,
      acceptedItemCount: 2,
    });
    expect(snapshot.entries.map((entry) => [entry.brand, entry.manufacturerModel])).toEqual([
      ["米家", "MC-186DMD"],
      ["海尔", "BCD-500WGHFD4DW9U1"],
    ]);
    expect(snapshot.entries.some((entry) => entry.manufacturerModel.includes("标题伪型号"))).toBe(false);
  });

  it("登录态失效时返回 typed failure，不把登录页当空目录", async () => {
    const reader: JdPageReader = async (url, kind) => {
      if (kind === "catalog") return catalogPage(1, 1, [card("1001")]);
      return { kind: "detail", state: "login_required", sku: skuOf(url), parameters: {}, categoryPath: [] };
    };
    const source = createJdOfficialRetailSource({
      allowedOrigins: ["https://www.jd.com", "https://item.jd.com"],
      pageReader: reader,
      accessPolicy: fixtureAccessPolicy(),
    });

    await expect(source.enumerate()).rejects.toMatchObject({ code: "login_required" });
  });

  it("目录混入非自营卡片时只过滤该卡片，不丢弃同页自营覆盖", async () => {
    const source = createJdOfficialRetailSource({
      allowedOrigins: ["https://www.jd.com", "https://item.jd.com"],
      pageReader: async (url, kind) => kind === "catalog"
        ? catalogPage(1, 1, [card("1001"), { ...card("1002"), selfOperated: false }])
        : detailPage(skuOf(url), "米家", "MC-186DMD", "家用冰箱"),
      accessPolicy: fixtureAccessPolicy(),
    });

    const snapshot = await source.enumerate();

    expect(snapshot).toMatchObject({
      declaredItemCount: 1,
      fetchedItemCount: 1,
      acceptedItemCount: 1,
    });
    expect(snapshot.entries.map((entry) => entry.sourceItemId)).toEqual(["1001"]);
  });

  it("详情缺少类型参数时依据官方冰箱面包屑接纳，仍排除相邻品类", async () => {
    const source = createJdOfficialRetailSource({
      allowedOrigins: ["https://www.jd.com", "https://item.jd.com"],
      pageReader: async (url, kind) => {
        if (kind === "catalog") return catalogPage(1, 1, [card("1001"), card("1002")]);
        const sku = skuOf(url);
        return sku === "1001"
          ? detailPage(sku, "TCL", "R116L5-B", undefined, ["家用电器", "大 家 电", "冰箱", "TCL"])
          : detailPage(sku, "海尔", "BC/BD-200", undefined, ["家用电器", "大 家 电", "冷柜", "海尔"]);
      },
      accessPolicy: fixtureAccessPolicy(),
    });

    const snapshot = await source.enumerate();

    expect(snapshot.entries.map((entry) => [entry.brand, entry.manufacturerModel])).toEqual([
      ["TCL", "R116L5-B"],
    ]);
  });

  it("没有通过 R-012 的页面 reader 时失败关闭且不启动浏览器", async () => {
    const source = createJdOfficialRetailSource({
      allowedOrigins: ["https://www.jd.com", "https://item.jd.com"],
    });

    await expect(source.enumerate()).rejects.toMatchObject({
      code: "source_abnormal",
      message: "京东生产浏览器 Provider 尚未通过 R-012",
    });
  });

  it("注入页面 reader 但没有显式频控政策时失败关闭", async () => {
    const source = createJdOfficialRetailSource({
      allowedOrigins: ["https://www.jd.com", "https://item.jd.com"],
      pageReader: createFixtureReader(),
    });

    await expect(source.enumerate()).rejects.toMatchObject({
      code: "source_abnormal",
      message: "京东来源缺少显式频控政策",
    });
  });
});

function createFixtureReader(): JdPageReader {
  return async (url, kind) => {
    if (kind === "catalog") {
      const page = Number(new URL(url).searchParams.get("page") ?? "1");
      return page === 1
        ? catalogPage(1, 2, [card("1001"), card("1002")])
        : catalogPage(2, 2, [card("1003")]);
    }
    const sku = skuOf(url);
    if (sku === "1001") return detailPage(sku, "米家", "MC-186DMD", "家用冰箱");
    if (sku === "1002") return detailPage(sku, "海尔", "BC/BD-200", "冷柜");
    return detailPage(sku, "海尔", "BCD-500WGHFD4DW9U1", "家用冰箱");
  };
}

function catalogPage(pageNumber: number, pageCount: number, cards: ReturnType<typeof card>[]) {
  return { kind: "catalog" as const, state: "accessible" as const, pageNumber, pageCount, cards };
}

function detailPage(
  sku: string,
  brand: string,
  model: string,
  type?: string,
  categoryPath = type === "冷柜"
    ? ["家用电器", "大 家 电", "冷柜", brand]
    : ["家用电器", "大 家 电", "冰箱", brand],
) {
  return {
    kind: "detail" as const,
    state: "accessible" as const,
    sku,
    parameters: { 品牌: brand, 能效网规格型号: model, ...(type ? { 类型: type } : {}) },
    categoryPath,
  };
}

function card(sku: string) {
  return {
    sku,
    title: `营销标题伪型号-${sku}`,
    sourceUrl: `https://item.jd.com/${sku}.html`,
    selfOperated: true,
  };
}

function skuOf(url: string) {
  return new URL(url).pathname.match(/\/(\d+)\.html/)?.[1] ?? "";
}

function fixtureAccessPolicy() {
  return {
    kind: "paced_http" as const,
    version: "fixture-v1",
    maxRequestsPerMinute: 1_000,
    minimumIntervalMs: 1,
    jitterMs: { min: 0, max: 0 },
    batchSize: 1_000,
    batchCooldownMs: 1,
    maximumRunMs: 10_000,
  };
}
