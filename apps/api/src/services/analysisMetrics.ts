export function getMetricNumber(metrics: Record<string, unknown> | null, key: string) {
  const value = metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function getCommentCount(metrics: Record<string, unknown> | null) {
  return getMetricNumber(metrics, "comments") || getMetricNumber(metrics, "num_comments");
}

export function getEngagementScore(metrics: Record<string, unknown> | null) {
  return getMetricNumber(metrics, "score") + getCommentCount(metrics) * 2;
}

export function getSubreddit(metrics: Record<string, unknown> | null) {
  const value = metrics?.subreddit;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
