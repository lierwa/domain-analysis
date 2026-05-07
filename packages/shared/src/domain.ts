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
export const platforms = ["reddit", "x", "youtube", "tiktok", "pinterest", "web"] as const;

// WHY: analysis run 状态机完整描述一次分析的生命周期，避免前后端各自定义导致不一致。
export const analysisRunStatuses = [
  "draft",
  "collecting",
  "collection_failed",
  "content_ready",
  "analyzing",
  "analysis_failed",
  "insight_ready",
  "reporting",
  "report_ready"
] as const;

// WHY: report 类型与 run_summary 优先，AI 生成型报告作为后续增强，不在 MVP 假装实现。
export const analysisReportTypes = ["run_summary", "content_opportunities", "keyword_analysis"] as const;
export const projectStatuses = ["active", "paused", "archived"] as const;

export type TaskStatus = (typeof taskStatuses)[number];
export type Platform = (typeof platforms)[number];
export type AnalysisRunStatus = (typeof analysisRunStatuses)[number];
export type AnalysisReportType = (typeof analysisReportTypes)[number];
export type ProjectStatus = (typeof projectStatuses)[number];
