interface ReportRunInput {
  name: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  validCount: number;
  collectedCount: number;
  duplicateCount: number;
}

interface ReportContentInput {
  authorName?: string;
  authorHandle?: string;
  url: string;
  text: string;
  metricsJson: Record<string, unknown> | null;
  publishedAt?: string;
}

// WHY: deterministic 报告是独立纯函数，拆出 service 编排层，避免业务流程文件继续膨胀。
// TRADE-OFF: 这里暂不引入模板引擎，MVP 保持零运行时依赖并便于测试快照内容。
export function buildDeterministicReport(run: ReportRunInput, contents: ReportContentInput[]): string {
  const topAuthors = getTopAuthors(contents, 10);
  const highEngagement = getHighEngagement(contents, 5);

  return `# ${run.name} – Analysis Report

## Overview

| Metric | Value |
|--------|-------|
| Collected | ${run.collectedCount} |
| Valid | ${run.validCount} |
| Duplicates | ${run.duplicateCount} |
| Include keywords | ${run.includeKeywords.join(", ")} |
| Exclude keywords | ${run.excludeKeywords.join(", ") || "—"} |

## Top Authors

${topAuthors.map((a) => `- **${a.name}** (${a.count} posts)`).join("\n") || "_No author data_"}

## High Engagement Samples

${highEngagement
  .map(
    (c, i) => `### ${i + 1}. ${c.authorName ?? "Unknown"}
> ${c.text.slice(0, 300)}${c.text.length > 300 ? "…" : ""}

[Source](${c.url})${c.publishedAt ? ` · ${c.publishedAt.slice(0, 10)}` : ""}
`
  )
  .join("\n") || "_No samples available_"}

---
_Generated ${new Date().toISOString().slice(0, 10)} · ${run.validCount} samples_
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

function getHighEngagement(contents: ReportContentInput[], limit: number) {
  return [...contents]
    .sort((a, b) => getEngagementScore(b.metricsJson) - getEngagementScore(a.metricsJson))
    .slice(0, limit);
}

function getEngagementScore(metrics: Record<string, unknown> | null): number {
  if (!metrics) return 0;
  const score = (metrics.score as number) ?? 0;
  const comments = (metrics.num_comments as number) ?? 0;
  return score + comments * 2;
}
