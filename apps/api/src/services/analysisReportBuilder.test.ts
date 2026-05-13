import { describe, expect, it } from "vitest";
import { buildDeterministicReport } from "./analysisReportBuilder";

const baseRun = {
  name: "tattoo design, tatto styles – May 13",
  includeKeywords: ["tattoo design", "tatto styles"],
  excludeKeywords: [],
  validCount: 171,
  collectedCount: 200,
  duplicateCount: 29
};

describe("buildDeterministicReport", () => {
  it("generates a readable Chinese report with collection limits", () => {
    const markdown = buildDeterministicReport(baseRun, [
      {
        authorName: "SquitleSkittle",
        url: "https://www.reddit.com/r/tattooadvice/comments/1",
        text: "Advice on next tattoo design and placement on arm?",
        metricsJson: { score: 4, comments: 9, subreddit: "tattooadvice" },
        publishedAt: "2026-05-09T23:49:34.404Z"
      }
    ]);

    expect(markdown).toContain("# tattoo design, tatto styles – May 13 – 中文分析报告");
    expect(markdown).toContain("## 数据概览");
    expect(markdown).toContain("## 采集说明");
    expect(markdown).toContain("优先补充 Reddit 详情页正文");
    expect(markdown).toContain("尚未生成 AI Insights");
    expect(markdown).toContain("## 数据局限");
    expect(markdown).toContain("## 下一步建议");
  });

  it("uses AI summary insights when available", () => {
    const markdown = buildDeterministicReport(baseRun, [], [
      {
        rawContentId: "raw_1",
        contentType: "__run_summary",
        intent: "run_summary",
        topics: ["Placement confidence"],
        opportunityScore: 0,
        analysisJson: {
          summary: {
            themes: [
              {
                themeName: "Placement confidence",
                whyItMatters: "Users need help visualizing fit before booking.",
                opportunityType: "content",
                demandSignals: ["placement questions"],
                contentIdeas: ["Arm placement checklist"],
                productServiceIdeas: ["Placement consult"]
              }
            ],
            recommendedNextActions: ["Collect more comments"],
            dataLimitations: ["Images were not visually analyzed."]
          }
        }
      }
    ]);

    expect(markdown).toContain("Placement confidence");
    expect(markdown).toContain("Collect more comments");
    expect(markdown).toContain("Images were not visually analyzed");
  });

  it("uses reddit comments when ranking high engagement samples", () => {
    const markdown = buildDeterministicReport(baseRun, [
      {
        authorName: "low",
        url: "https://example.com/low",
        text: "Low comments sample",
        metricsJson: { score: 10, comments: 0 }
      },
      {
        authorName: "high",
        url: "https://example.com/high",
        text: "High comments sample",
        metricsJson: { score: 1, comments: 10 }
      }
    ]);

    expect(markdown.indexOf("High comments sample")).toBeLessThan(markdown.indexOf("Low comments sample"));
    expect(markdown).toContain("点赞 1 · 评论 10");
  });

  it("keeps the report readable without author, comments, or published time", () => {
    const markdown = buildDeterministicReport(baseRun, [
      {
        url: "https://example.com/unknown",
        text: "Anonymous sample",
        metricsJson: null
      }
    ]);

    expect(markdown).toContain("未知作者");
    expect(markdown).toContain("点赞 0 · 评论 0");
    expect(markdown).toContain("[查看原帖](https://example.com/unknown)");
  });
});
