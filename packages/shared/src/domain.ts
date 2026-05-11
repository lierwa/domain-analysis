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
export const analysisBatchPlatforms = ["reddit", "x", "youtube", "web"] as const;

// WHY: analysis run 状态机完整描述一次分析的生命周期，避免前后端各自定义导致不一致。
export const analysisRunStatuses = [
  "draft",
  "collecting",
  "collection_failed",
  "no_content",
  "content_ready",
  "analyzing",
  "analysis_failed",
  "insight_ready",
  "reporting",
  "report_ready"
] as const;

// WHY: batch 是一次业务分析意图的聚合状态，子 run 才表示具体平台采集状态。
export const analysisBatchStatuses = [
  "draft",
  "collecting",
  "partial_ready",
  "content_ready",
  "no_content",
  "collection_failed",
  "report_ready"
] as const;

// WHY: report 类型与 run_summary 优先，AI 生成型报告作为后续增强，不在 MVP 假装实现。
export const analysisReportTypes = ["run_summary", "content_opportunities", "keyword_analysis"] as const;
export const projectStatuses = ["active", "paused", "archived"] as const;

// WHY: collection plan 表达长期后台采集意图，避免把一次 analysis run 当成定时任务配置。
export const collectionPlanStatuses = ["active", "paused", "archived"] as const;
export const collectionCadences = ["manual", "hourly", "daily", "weekly"] as const;
export const collectionRunTriggers = ["manual", "scheduled"] as const;

export type TaskStatus = (typeof taskStatuses)[number];
export type Platform = (typeof platforms)[number];
export type AnalysisBatchPlatform = (typeof analysisBatchPlatforms)[number];
export type AnalysisRunStatus = (typeof analysisRunStatuses)[number];
export type AnalysisBatchStatus = (typeof analysisBatchStatuses)[number];
export type AnalysisReportType = (typeof analysisReportTypes)[number];
export type ProjectStatus = (typeof projectStatuses)[number];
export type CollectionPlanStatus = (typeof collectionPlanStatuses)[number];
export type CollectionCadence = (typeof collectionCadences)[number];
export type CollectionRunTrigger = (typeof collectionRunTriggers)[number];
