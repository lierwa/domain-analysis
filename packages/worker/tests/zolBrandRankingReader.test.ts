import { describe, expect, it, vi } from "vitest";

import type { RawPublicResponse } from "../src/publicResourceTransport";
import { createZolBrandRankingReader, parseZolBrandRanking } from "../src/zolBrandRankingReader";

const rankingUrl = new URL("https://top.zol.com.cn/compositor/359/manu_attention.html");

describe("ZOL 品牌排行榜读取", () => {
  it("从 Capture Task 排行榜候选反查并验证同门类官方链路后读取榜单", async () => {
    const categoryUrl = "https://detail.zol.com.cn/icebox/";
    const hubUrl = "https://top.zol.com.cn/compositor/icebox.html";
    const responses = new Map([
      [categoryUrl, response(`<a href="//top.zol.com.cn/compositor/icebox.html">排行</a>`, categoryUrl)],
      [hubUrl, response(`<a href="//top.zol.com.cn/compositor/359/manu_attention.html">冰箱品牌排行</a>`, hubUrl)],
      [rankingUrl.href, response(rankingHtml())],
    ]);
    const reader = createZolBrandRankingReader({ request: async (url) => {
      const value = responses.get(url.href);
      if (!value) throw new Error(`意外 URL：${url.href}`);
      return value;
    } });

    const result = await reader.discoverAndRead({ rankingUrl: rankingUrl.href });

    expect(result.categoryUrl).toBe(categoryUrl);
    expect(result.categorySlug).toBe("icebox");
    expect(result.rankingUrl).toBe(rankingUrl.href);
    expect(result.evidenceUrls).toEqual([categoryUrl, hubUrl, rankingUrl.href]);
    expect(result.rows).toHaveLength(2);
  });

  it("DoH 瞬态失败只重试一次后继续官方链路核验", async () => {
    vi.useFakeTimers();
    try {
      const categoryUrl = "https://detail.zol.com.cn/icebox/";
      const hubUrl = "https://top.zol.com.cn/compositor/icebox.html";
      const responses = new Map([
        [categoryUrl, response(`<a href="//top.zol.com.cn/compositor/icebox.html">排行</a>`, categoryUrl)],
        [hubUrl, response(`<a href="//top.zol.com.cn/compositor/359/manu_attention.html">冰箱品牌排行</a>`, hubUrl)],
        [rankingUrl.href, response(rankingHtml())],
      ]);
      let rankingAttempts = 0;
      const reader = createZolBrandRankingReader({ request: async (url) => {
        if (url.href === rankingUrl.href && ++rankingAttempts === 1) {
          throw new Error("可信 DoH 查询失败：DNS status 2");
        }
        const value = responses.get(url.href);
        if (!value) throw new Error(`意外 URL：${url.href}`);
        return value;
      } });

      const pending = reader.discoverAndRead({ rankingUrl: rankingUrl.href });
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toMatchObject({ categorySlug: "icebox", rows: expect.any(Array) });
      expect(rankingAttempts).toBe(2);
    } finally { vi.useRealTimers(); }
  });

  it("按页面名次读取品牌综合评分和同门类目录", () => {
    const result = parseZolBrandRanking(response(rankingHtml()), rankingUrl, "icebox");

    expect(result).toEqual({
      rankingUrl: rankingUrl.href,
      title: "冰箱品牌排行榜",
      rows: [
        { rank: 1, name: "海尔", comprehensiveScore: 99.5, key: "haier",
          catalogUrl: "https://detail.zol.com.cn/icebox/haier/" },
        { rank: 2, name: "美的", comprehensiveScore: 95.2, key: "midea",
          catalogUrl: "https://detail.zol.com.cn/icebox/midea/" },
      ],
    });
  });

  it("品牌目录不属于当前门类时失败关闭", () => {
    expect(() => parseZolBrandRanking(response(rankingHtml().replace(
      "/icebox/midea/", "/digital_tv/midea/",
    )), rankingUrl, "icebox")).toThrow("品牌目录与当前门类不一致");
  });

  it("缺少综合评分列时不能形成排行榜事实", () => {
    expect(() => parseZolBrandRanking(response(rankingHtml().replace(
      "品牌综合评分", "关注指数",
    )), rankingUrl, "icebox")).toThrow("缺少名次、品牌或品牌综合评分列");
  });
});

function response(html: string, finalUrl = rankingUrl.href): RawPublicResponse {
  return { statusCode: 200, finalUrl,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: Uint8Array.from(Buffer.from(html)) };
}

function rankingHtml() {
  return `<!doctype html><html><body><div class="section">
    <div class="section__head"><h3>冰箱品牌排行榜</h3></div>
    <div class="rank-list brand-rank-list">
      <div class="rank-list__head">
        <div class="rank-list__cell">排名</div><div class="rank-list__cell">品牌</div>
        <div class="rank-list__cell">品牌综合评分</div>
      </div>
      <div class="rank-list__item">
        <div class="rank-list__cell cell-1"><div class="rank__number number-n1"></div></div>
        <div class="rank-list__cell cell-2"><a class="name" href="//detail.zol.com.cn/icebox/haier/">海尔</a></div>
        <div class="rank-list__cell cell-3"><div class="score"><span>99.5分</span></div></div>
      </div>
      <div class="rank-list__item">
        <div class="rank-list__cell cell-1">2</div>
        <div class="rank-list__cell cell-2"><a class="name" href="//detail.zol.com.cn/icebox/midea/">美的</a></div>
        <div class="rank-list__cell cell-3"><div class="score"><span>95.2分</span></div></div>
      </div>
    </div>
  </div></body></html>`;
}
