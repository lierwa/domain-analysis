import { getCommentCount, getEngagementScore, getMetricNumber, getSubreddit } from "./analysisMetrics";

interface ReportRunInput {
  name: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  validCount: number;
  collectedCount: number;
  duplicateCount: number;
}

interface ReportContentInput {
  id?: string;
  authorName?: string;
  authorHandle?: string;
  url: string;
  text: string;
  metricsJson: Record<string, unknown> | null;
  publishedAt?: string;
}

interface ReportInsightInput {
  rawContentId: string;
  contentType: string;
  intent: string;
  topics: string[];
  opportunityScore: number;
  contentOpportunity?: string;
  analysisJson?: Record<string, unknown> | null;
}

// WHY: deterministic 报告是独立纯函数，拆出 service 编排层，避免业务流程文件继续膨胀。
// TRADE-OFF: 这里暂不引入模板引擎或 AI provider，MVP 保持零运行时依赖并便于测试快照内容。
export function buildDeterministicReport(
  run: ReportRunInput,
  contents: ReportContentInput[],
  insights: ReportInsightInput[] = []
): string {
  const topAuthors = getTopAuthors(contents, 10);
  const highEngagement = getHighEngagement(contents, 5);
  const keywordStats = getKeywordStats(run.includeKeywords, contents);
  const opportunitySummary = formatOpportunitySummary(insights);

  return `# ${run.name} – 中文分析报告

## 数据概览

| 指标 | 数值 |
|--------|-------|
| 采集总量 | ${run.collectedCount} |
| 有效内容 | ${run.validCount} |
| 重复内容 | ${run.duplicateCount} |
| 包含关键词 | ${run.includeKeywords.join(", ")} |
| 排除关键词 | ${run.excludeKeywords.join(", ") || "无"} |

## 采集说明

当前采集会优先补充 Reddit 详情页正文、图片 URL 和 Top comments。
如果部分帖子详情页抓取失败，报告和 Insights 会在数据局限中明确说明，
不会把搜索卡片摘要伪装成完整语义。

## 热门作者

${formatTopAuthors(topAuthors)}

## 业务机会摘要

${opportunitySummary}

## 关键词命中

${formatKeywordStats(keywordStats)}

## 高互动样本

${formatHighEngagement(highEngagement)}

## 数据局限

- 当前样本只代表搜索结果页能看到的内容，不等同于完整帖子语义。
- 图片、帖子正文详情和评论楼层暂未进入本报告，因此不适合判断视觉风格细节或完整用户需求。
- 高互动排序只使用已采集到的点赞和评论数，缺失字段会按 0 处理。

## 下一步建议

- 先用本报告筛出值得继续追踪的 subreddit、作者和高互动话题。
- 下一轮优先补充帖子详情页采集，写入完整正文和图片 URL。
- 等详情数据稳定后，再接入 Insights 做主题、痛点、意图和内容机会分析。

---
_生成时间 ${new Date().toISOString().slice(0, 10)} · 基于 ${run.validCount} 条有效样本_
`;
}

function getTopAuthors(contents: Array<{ authorName?: string; authorHandle?: string }>, limit: number) {
  const counts = new Map<string, number>();
  for (const c of contents) {
    const name = c.authorName ?? c.authorHandle;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function getKeywordStats(keywords: string[], contents: ReportContentInput[]) {
  return keywords.map((keyword) => {
    const lowerKeyword = keyword.toLowerCase();
    const count = contents.filter((content) => content.text.toLowerCase().includes(lowerKeyword)).length;
    return { keyword, count };
  });
}

function getHighEngagement(contents: ReportContentInput[], limit: number) {
  return [...contents]
    .sort((a, b) => getEngagementScore(b.metricsJson) - getEngagementScore(a.metricsJson))
    .slice(0, limit);
}

function formatTopAuthors(topAuthors: Array<{ name: string; count: number }>) {
  return topAuthors.map((a) => `- **${a.name}**：${a.count} 条`).join("\n") || "_暂无作者数据_";
}

function formatOpportunitySummary(insights: ReportInsightInput[]) {
  const summary = getAiSummary(insights);
  if (!summary) {
    return "_尚未生成 AI Insights。本报告只提供数据概览，不输出业务机会判断。_";
  }
  const themeLines = summary.themes.map((theme) => [
    `- **${theme.themeName}**：${theme.whyItMatters}`,
    `  - 机会类型：${theme.opportunityType}`,
    `  - 需求信号：${theme.demandSignals.join("、") || "暂无"}`,
    `  - 内容建议：${theme.contentIdeas.join("、") || "暂无"}`,
    `  - 产品/服务建议：${theme.productServiceIdeas.join("、") || "暂无"}`
  ].join("\n"));
  return [
    ...themeLines,
    "",
    `推荐下一步：${summary.recommendedNextActions.join("、") || "继续补充详情数据"}`,
    "",
    `数据限制：${summary.dataLimitations.join("、") || "暂无"}`
  ].join("\n");
}

function getAiSummary(insights: ReportInsightInput[]) {
  const summaryRow = insights.find((item) => item.contentType === "__run_summary");
  const value = summaryRow?.analysisJson?.summary;
  if (!value || typeof value !== "object") return null;
  return value as {
    themes: Array<{
      themeName: string;
      whyItMatters: string;
      opportunityType: string;
      demandSignals: string[];
      contentIdeas: string[];
      productServiceIdeas: string[];
    }>;
    recommendedNextActions: string[];
    dataLimitations: string[];
  };
}

function formatKeywordStats(stats: Array<{ keyword: string; count: number }>) {
  return stats.map((stat) => `- **${stat.keyword}**：${stat.count} 条`).join("\n") || "_暂无关键词数据_";
}

function formatHighEngagement(contents: ReportContentInput[]) {
  if (!contents.length) return "_暂无可展示样本_";
  return contents.map(formatSample).join("\n");
}

function formatSample(content: ReportContentInput, index: number) {
  const author = content.authorName ?? content.authorHandle ?? "未知作者";
  const score = getMetricNumber(content.metricsJson, "score");
  const comments = getCommentCount(content.metricsJson);
  const date = content.publishedAt ? ` · ${content.publishedAt.slice(0, 10)}` : "";
  const subreddit = getSubreddit(content.metricsJson);
  const subredditText = subreddit ? ` · r/${subreddit}` : "";
  const text = truncateText(content.text, 300);

  return `### ${index + 1}. ${author}
点赞 ${score} · 评论 ${comments}${subredditText}${date}

> ${text}

[查看原帖](${content.url})
`;
}

function truncateText(text: string, limit: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}
