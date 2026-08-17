import { describe, expect, it } from "vitest";

import {
  createHaierOfficialCatalogSource,
  createLeaderOfficialCatalogSource,
  createMideaOfficialCatalogSource,
  createTclOfficialCatalogSource,
} from "../src/officialCatalogSources";
import { createHisenseGroupOfficialCatalogSource } from "../src/hisenseGroupOfficialCatalogSource";
import { createMeilingOfficialCatalogSource } from "../src/meilingOfficialCatalogSource";
import { createKonkaFrestecOfficialCatalogSource } from "../src/konkaFrestecOfficialCatalogSource";
import { createSiemensOfficialCatalogSource } from "../src/siemensOfficialCatalogSource";
import { createRoyalstarOfficialChannelSource } from "../src/royalstarOfficialChannelSource";

describe("official catalog sources", () => {
  it("枚举海尔全部分页并保留厂商型号 identity", async () => {
    const source = createHaierOfficialCatalogSource({
      allowedOrigins: ["https://www.haier.com"],
      now: () => new Date("2026-08-16T12:00:00.000Z"),
      pageLoader: async (_url, page) => ({
        page: {
          data: page === 1
            ? [haierRow(1, "BCD-500", "//www.haier.com/cooling/1.shtml"), haierRow(2, "BCD-501", "//www.haier.com/cooling/2.shtml")]
            : [haierRow(3, "BCD-502", "//www.haier.com/cooling/3.shtml")],
          total: "3",
          totalPage: 2,
        },
      }),
    });

    const snapshot = await source.enumerate();
    expect(snapshot).toMatchObject({
      declaredItemCount: 3,
      fetchedItemCount: 3,
      acceptedItemCount: 3,
      coverageKind: "independent_brand_catalog",
    });
    expect(snapshot.entries.map((entry) => entry.manufacturerModel)).toEqual(["BCD-500", "BCD-501", "BCD-502"]);
  });

  it("美的目录排除冷柜但保留同型号的两个 SKU 供总体层去重", async () => {
    const source = createMideaOfficialCatalogSource({
      allowedOrigins: ["https://www.midea.cn"],
      pageLoader: async () => ({
        errcode: 0,
        data: {
          total: 3,
          vecSkuInfoList: [
            mideaRow(1, 1, "美的", "MR-457WUSPZE"),
            mideaRow(2, 1, "美的", "MR-457WUSPZE"),
            mideaRow(3, 2, "美的", "BD-100"),
          ],
        },
      }),
    });

    const snapshot = await source.enumerate();
    expect(snapshot).toMatchObject({
      declaredItemCount: 3,
      fetchedItemCount: 3,
      acceptedItemCount: 2,
      coverageKind: "multi_brand_official_catalog",
    });
    expect(snapshot.entries).toHaveLength(2);
    expect(new Set(snapshot.entries.map((entry) => entry.manufacturerModel))).toEqual(new Set(["MR-457WUSPZE"]));
  });

  it("统帅独立官网复用同族分页协议但保留独立品牌 identity", async () => {
    const source = createLeaderOfficialCatalogSource({
      allowedOrigins: ["https://www.leader.com.cn"],
      pageLoader: async (_url, page) => ({
        page: {
          data: page === 1
            ? [leaderRow(1, "LC2-160WS9"), leaderRow(2, "LTD-520WS9U1")]
            : [leaderRow(3, "BCD-500WLLFDG9Y9U1")],
          total: "3",
          totalPage: 2,
        },
      }),
    });

    const snapshot = await source.enumerate();
    expect(snapshot).toMatchObject({
      declaredItemCount: 3,
      fetchedItemCount: 3,
      acceptedItemCount: 3,
      coverageKind: "independent_brand_catalog",
      coverageStatus: "complete",
    });
    expect(snapshot.entries.map((entry) => [entry.brand, entry.manufacturerModel])).toEqual([
      ["统帅", "LC2-160WS9"],
      ["统帅", "LTD-520WS9U1"],
      ["统帅", "BCD-500WLLFDG9Y9U1"],
    ]);
  });

  it("网络请求前拒绝未授权官网 origin", async () => {
    const source = createHaierOfficialCatalogSource({ allowedOrigins: ["https://www.midea.cn"] });
    await expect(source.enumerate()).rejects.toMatchObject({ code: "origin_not_allowed" });
  });

  it("从 TCL 官方目录数据读取详情型号，并在标题不完整时使用官方详情页 slug", async () => {
    const source = createTclOfficialCatalogSource({
      allowedOrigins: ["https://www.tcl.com"],
      propertyLoader: async () => JSON.stringify({
        allProducts: [{
          classField: {
            productSet: [
              tclProduct("/cn/zh/refrigerators/q10ss", "格物冰箱 R555Q10-SS", "格物冰箱 R555Q10-SS"),
              tclProductWithoutVisibility("/cn/zh/refrigerators/r415p10-uq", "P10超薄平嵌冰箱", "P10超薄平嵌冰箱"),
            ],
          },
        }],
      }),
    });
    const snapshot = await source.enumerate();
    expect(snapshot.entries.map((entry) => entry.manufacturerModel)).toEqual(["R555Q10-SS", "R415P10-UQ"]);
  });

  it("海信集团目录按声明数读取详情，保留跨页重复并拒绝只出现在图片名中的型号", async () => {
    const pages = new Map([
      ["https://www.hisense.com/productcat/54.html", `共找到4个产品
        <a href="/product/1.html">一</a><a href="/product/2.html">二</a>
        <a href="/product/3.html">三</a><a href="/product/4.html">四</a>`],
      ["https://www.hisense.com/product/1.html", "<title>海信官网-海信冰箱 BCD-500V5CZKQD</title>"],
      ["https://www.hisense.com/product/2.html", "<meta name=\"description\" content=\"海信冰箱 BCD-500V5CZKQD 灰\">"],
      ["https://www.hisense.com/product/3.html", "<meta name=\"keywords\" content=\"容声冰箱 BCD-505Q50CZLBD\">"],
      ["https://www.hisense.com/product/4.html", "<h1 class=\"fs-32 title\">海信222冰箱</h1><img alt=\"BCD-222WTDGS.jpg\">"],
    ]);
    const source = createHisenseGroupOfficialCatalogSource({
      allowedOrigins: ["https://www.hisense.com"],
      htmlLoader: async (url) => pages.get(url)!,
    });

    const snapshot = await source.enumerate();
    expect(snapshot).toMatchObject({
      declaredItemCount: 4,
      fetchedItemCount: 4,
      acceptedItemCount: 3,
      coverageKind: "multi_brand_official_catalog",
      coverageStatus: "partial",
    });
    expect(snapshot.entries.map((entry) => [entry.brand, entry.manufacturerModel])).toEqual([
      ["海信", "BCD-500V5CZKQD"],
      ["海信", "BCD-500V5CZKQD"],
      ["容声", "BCD-505Q50CZLBD"],
    ]);
  });

  it("美菱官方商城读取全部分页，保留 SKU 并规范化厂商明确写出的型号", async () => {
    const source = createMeilingOfficialCatalogSource({
      allowedOrigins: ["https://mlmall.meiling.com"],
      now: () => new Date("2026-08-16T12:00:00.000Z"),
      pageLoader: async (page) => meilingPage(page),
    });

    const snapshot = await source.enumerate();
    expect(snapshot).toMatchObject({
      declaredItemCount: 4,
      fetchedItemCount: 4,
      acceptedItemCount: 4,
      coverageKind: "independent_brand_catalog",
      coverageStatus: "complete",
    });
    expect(snapshot.entries.map((entry) => entry.manufacturerModel)).toEqual([
      "BCD-401WP9BT",
      "BCD-401WP9BT",
      "BCD-505WSPU9BDZ",
      "400WP9BT",
    ]);
  });

  it("康佳集团冰箱总类目读取详情显式品牌型号，并排除冷柜", async () => {
    const pages = new Map([
      ["https://www.konka.com/list.html?cat_id=28", `<div class="goods-list">
        <a href="/item-1758.html"></a><a href="/item-1707.html"></a><a href="/item-1709.html"></a>
      </div><script></script>`],
      ["https://www.konka.com/item-1758.html", konkaProduct("新飞", "BCD-640WGQ8E")],
      ["https://www.konka.com/item-1707.html", konkaProduct("KONKA", "BCD-418WUP4-V")],
      ["https://www.konka.com/item-1709.html", konkaProduct("KONKA", "BD/BC-211DGLCEX")],
    ]);
    const source = createKonkaFrestecOfficialCatalogSource({
      allowedOrigins: ["https://www.konka.com"],
      now: () => new Date("2026-08-16T12:00:00.000Z"),
      htmlLoader: async (url) => pages.get(url)!,
    });

    const snapshot = await source.enumerate();
    expect(snapshot).toMatchObject({
      declaredItemCount: 3,
      fetchedItemCount: 3,
      acceptedItemCount: 2,
      coverageKind: "multi_brand_official_catalog",
      coverageStatus: "complete",
    });
    expect(snapshot.entries.map((entry) => [entry.brand, entry.manufacturerModel])).toEqual([
      ["新飞", "BCD-640WGQ8E"],
      ["康佳", "BCD-418WUP4-V"],
    ]);
  });

  it("西门子官方在售目录读取完整分母，并排除酒柜和独立冷冻箱", async () => {
    const source = createSiemensOfficialCatalogSource({
      allowedOrigins: ["https://www.siemens-home.bsh-group.cn"],
      pageLoader: async () => ({
        code: 0,
        message: "success",
        data: {
          total: 4,
          rows: [
            siemensRow("KF89BV156C", "多门冰箱 KF89BV156C", "5"),
            siemensRow("KS36VAI32C", "独立式冷藏箱 KS36VAI32C", "3"),
            siemensRow("GS36NAI32C", "独立冷冻箱 GS36NAI32C", "3"),
            siemensRow("KW3UVA5TSC", "Freestanding wine cooler KW3UVA5TSC", "6"),
          ],
        },
      }),
    });

    const snapshot = await source.enumerate();
    expect(snapshot).toMatchObject({
      declaredItemCount: 4,
      fetchedItemCount: 4,
      acceptedItemCount: 2,
      coverageKind: "independent_brand_catalog",
      coverageStatus: "complete",
    });
    expect(snapshot.entries.map((entry) => entry.manufacturerModel)).toEqual(["KF89BV156C", "KS36VAI32C"]);
  });

  it("荣事达官网当前产品中心按声明数发现型号，但不冒充独立完整目录", async () => {
    const source = createRoyalstarOfficialChannelSource({
      allowedOrigins: ["https://www.rsdgroup.com.cn"],
      now: () => new Date("2026-08-16T12:00:00.000Z"),
      htmlLoader: async () => `
        <a href="view.aspx?prono=2745"><img src="product.jpg"></a>
        <a href="view.asp?prono=2745">BCD-271WGP</a>
        <div>第1/1页&nbsp;共1条信息</div>
      `,
    });

    const snapshot = await source.enumerate();
    expect(snapshot).toMatchObject({
      declaredItemCount: 1,
      fetchedItemCount: 1,
      acceptedItemCount: 1,
      coverageKind: "official_channel_discovery",
      coverageStatus: "partial",
    });
    expect(snapshot.entries).toEqual([expect.objectContaining({
      brand: "荣事达",
      manufacturerModel: "BCD-271WGP",
      sourceItemId: "2745",
    })]);
  });
});

function haierRow(metaDataId: number, modelno: string, docPubUrl: string) {
  return { metaDataId, modelno, docPubUrl, psale: "0" };
}

function mideaRow(lSkuId: number, lCategoryId: number, strBrandName: string, nModel: string) {
  return {
    lSkuId,
    lCategoryId,
    nOnSale: 1,
    strBrandName,
    nModel,
    strLink: `https://m.midea.cn/next/detail/${lSkuId}`,
  };
}

function leaderRow(metaDataId: number, modelno: string) {
  return {
    metaDataId,
    modelno,
    docPubUrl: `https://www.leader.com.cn/cooling/${metaDataId}.shtml`,
    psale: "0",
  };
}

function tclProduct(productPage: string, productTitle: string, bannerDesc: string) {
  return {
    productDataPath: `/content/tcl${productPage}/item`,
    productInfo: { productPage, productTitle, bannerDesc, hideInProductList: false },
  };
}

function tclProductWithoutVisibility(productPage: string, productTitle: string, bannerDesc: string) {
  const product = tclProduct(productPage, productTitle, bannerDesc);
  const { hideInProductList: _omitted, ...productInfo } = product.productInfo;
  return { ...product, productInfo };
}

function meilingPage(page: number) {
  const names = page === 1
    ? ["BCD-401WP9BT墨玉锦", "BCD-401WP9BT星云灰"]
    : ["BCD—505WSPU9BDZ玉釉白", "400WP9BT星夜灰"];
  return {
    resultCode: "1",
    resultMsg: "success",
    basePageObj: {
      currentPage: page,
      totalPages: 2,
      totalRows: 4,
      hasNextPage: page === 1,
      dataList: names.map((skuname, index) => ({
        id: page * 10 + index,
        skucode: `SKU-${page}-${index}`,
        skuname,
        isonline: "Y",
      })),
    },
  };
}

function siemensRow(vib: string, name: string, groupId: string) {
  return { vib, name, groupId, isOnSale: "1", goodId: 1 };
}

function konkaProduct(brand: string, model: string) {
  const encodedBrand = JSON.stringify(brand).slice(1, -1).replaceAll(/[^\u0000-\u007f]/g, (value) =>
    `\\u${value.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `"marketable":"true","params":{"\\u57fa\\u672c\\u53c2\\u6570":{"\\u54c1\\u724c":"${encodedBrand}","\\u578b\\u53f7":"${model}"}}`;
}
