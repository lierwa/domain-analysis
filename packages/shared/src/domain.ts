export const topicStatuses = ["active", "paused", "archived"] as const;
export const taskStatuses = [
  "pending",
  "running",
  "success",
  "failed",
  "no_content",
  "paused",
  "login_required",
  "rate_limited",
  "parse_failed"
] as const;
export const platforms = ["reddit", "x", "youtube", "pinterest", "web"] as const;
export const sentiments = ["positive", "neutral", "negative", "mixed"] as const;
export const reportTypes = [
  "topic_trend",
  "keyword_analysis",
  "platform_content",
  "high_value_digest",
  "opportunity"
] as const;
export const crawlFrequencies = ["manual", "hourly", "daily", "weekly"] as const;

export type TopicStatus = (typeof topicStatuses)[number];
export type TaskStatus = (typeof taskStatuses)[number];
export type Platform = (typeof platforms)[number];
export type Sentiment = (typeof sentiments)[number];
export type ReportType = (typeof reportTypes)[number];
export type CrawlFrequency = (typeof crawlFrequencies)[number];
