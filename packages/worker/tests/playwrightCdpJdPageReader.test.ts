import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connectOverCDP: vi.fn() }));

vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: mocks.connectOverCDP },
}));

import { createPlaywrightCdpJdPageReader } from "../src/playwrightCdpJdPageReader";

describe("Playwright CDP JD page reader", () => {
  beforeEach(() => mocks.connectOverCDP.mockReset());

  it("从真实表面形状读取目录分页、自营标记和商品引用", async () => {
    const fixture = browserFixture({
      pageUrl: "https://www.jd.com/brand/fixture.html?page=2",
      evaluations: {
        readPageSignals: { title: "京东冰箱", bodyText: "商品列表 自营" },
        readCatalogDom: {
          pageText: "2/5",
          totalText: "共5页",
          cards: [
            { href: "https://item.jd.com/1001.html", title: "第一件冰箱", cardText: "第一件冰箱 自营" },
            { href: "https://item.jd.com/1002.html", title: "第二件冰箱", cardText: "第二件冰箱" },
          ],
        },
      },
    });
    mocks.connectOverCDP.mockResolvedValue(fixture.browser);
    const reader = createPlaywrightCdpJdPageReader({
      endpointUrl: "http://127.0.0.1:9223",
      allowedOrigins: ["https://www.jd.com", "https://item.jd.com"],
    });

    await expect(reader(fixture.pageUrl, "catalog")).resolves.toMatchObject({
      kind: "catalog",
      state: "accessible",
      pageNumber: 2,
      pageCount: 5,
      cards: [
        { sku: "1001", selfOperated: true },
        { sku: "1002", selfOperated: false },
      ],
    });
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("把商品详情的全部参数与品类路径投影成 ordered record", async () => {
    const fixture = browserFixture({
      pageUrl: "https://item.jd.com/1001.html",
      evaluations: {
        readPageSignals: { title: "Fixture 冰箱", bodyText: "规格参数" },
        readDetailDom: {
          title: "Fixture 冰箱",
          parameters: [
            { name: "品牌", value: "Fixture" },
            { name: "能效网规格型号", value: "F-100" },
            { name: "容积", value: "100L" },
          ],
          categoryPath: ["家用电器", "冰箱", "Fixture"],
        },
      },
    });
    mocks.connectOverCDP.mockResolvedValue(fixture.browser);
    const reader = createPlaywrightCdpJdPageReader({
      endpointUrl: "http://127.0.0.1:9223",
      allowedOrigins: ["https://item.jd.com"],
    });

    await expect(reader(fixture.pageUrl, "product")).resolves.toMatchObject({
      kind: "product",
      state: "accessible",
      sku: "1001",
      content: {
        kind: "ordered_record",
        fieldGroups: [
          { label: "categoryPath", fields: [{ value: "家用电器" }, { value: "冰箱" }, { value: "Fixture" }] },
          { label: "parameters", fields: [{ name: "品牌", value: "Fixture" }, { name: "能效网规格型号", value: "F-100" }, { name: "容积", value: "100L" }] },
        ],
      },
    });
  });

  it("详情观察严格排除只属于 product 投影的标题字段", async () => {
    const fixture = browserFixture({
      pageUrl: "https://item.jd.com/1001.html",
      evaluations: {
        readPageSignals: { title: "Fixture 冰箱", bodyText: "规格参数" },
        readDetailDom: {
          title: "Fixture 冰箱",
          parameters: [{ name: "品牌", value: "Fixture" }],
          categoryPath: ["家用电器", "冰箱"],
        },
      },
    });
    mocks.connectOverCDP.mockResolvedValue(fixture.browser);
    const reader = createPlaywrightCdpJdPageReader({
      endpointUrl: "http://127.0.0.1:9223",
      allowedOrigins: ["https://item.jd.com"],
    });

    const observation = await reader(fixture.pageUrl, "detail");
    expect(observation).toMatchObject({ kind: "detail", state: "accessible", sku: "1001" });
    expect(observation).not.toHaveProperty("title");
  });

  it("登录跳转返回 typed login_required，不尝试解析页面", async () => {
    const fixture = browserFixture({
      pageUrl: "https://passport.jd.com/new/login.aspx",
      evaluations: {
        readPageSignals: { title: "京东-欢迎登录", bodyText: "扫码登录" },
      },
    });
    mocks.connectOverCDP.mockResolvedValue(fixture.browser);
    const reader = createPlaywrightCdpJdPageReader({
      endpointUrl: "http://127.0.0.1:9223",
      allowedOrigins: ["https://www.jd.com"],
    });

    await expect(reader("https://www.jd.com/brand/fixture.html", "catalog")).resolves.toMatchObject({
      kind: "catalog",
      state: "login_required",
      cards: [],
    });
  });

  it("拒绝连接非本机 CDP 端点", () => {
    expect(() => createPlaywrightCdpJdPageReader({
      endpointUrl: "https://remote.example/devtools",
      allowedOrigins: ["https://www.jd.com"],
    })).toThrow("必须是本机 HTTP loopback");
  });
});

function browserFixture(input: {
  pageUrl: string;
  evaluations: Record<string, unknown>;
}) {
  const close = vi.fn().mockResolvedValue(undefined);
  const page = {
    goto: vi.fn().mockResolvedValue({ status: () => 200 }),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn((fn: { name: string }) => input.evaluations[fn.name]),
    url: vi.fn(() => input.pageUrl),
    close,
  };
  return {
    pageUrl: input.pageUrl,
    close,
    browser: {
      contexts: () => [{ newPage: vi.fn().mockResolvedValue(page) }],
      on: vi.fn(),
    },
  };
}
