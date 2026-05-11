import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
};

// WHY: sources 是平台元数据基础，不是旧 UI 兼容层；当前流程只启动 Reddit，schema 保留未来多平台扩展空间。
export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  requiresLogin: integer("requires_login", { mode: "boolean" }).notNull().default(false),
  crawlerType: text("crawler_type").notNull().default("cheerio"),
  defaultLimit: integer("default_limit").notNull().default(100),
  rateLimitConfig: text("rate_limit_config", { mode: "json" }),
  loginProfileId: text("login_profile_id"),
  ...timestamps
});

// WHY: analysis_projects 是业务实体，替代工程概念 topics，goal 字段支撑 AI 分析上下文。
export const analysisProjects = sqliteTable("analysis_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  goal: text("goal").notNull(),
  language: text("language").notNull(),
  market: text("market").notNull(),
    defaultPlatform: text("default_platform").notNull().default("web"),
  defaultLimit: integer("default_limit").notNull().default(100),
  status: text("status").notNull().default("active"),
  ...timestamps
});

// WHY: analysis_batches 表达一次业务分析意图，子 run 才负责每个平台的实际采集。
export const analysisBatches = sqliteTable(
  "analysis_batches",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => analysisProjects.id),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    goal: text("goal").notNull(),
    includeKeywords: text("include_keywords", { mode: "json" }).notNull(),
    excludeKeywords: text("exclude_keywords", { mode: "json" }).notNull(),
    language: text("language").notNull(),
    market: text("market").notNull(),
    collectedCount: integer("collected_count").notNull().default(0),
    validCount: integer("valid_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    reportId: text("report_id"),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    ...timestamps
  },
  (table) => ({
    projectIdx: index("analysis_batches_project_idx").on(table.projectId),
    statusIdx: index("analysis_batches_status_idx").on(table.status)
  })
);

// WHY: collection_plans 是长期后台采集配置；analysis_runs 只是某次执行结果，不能承载调度策略。
export const collectionPlans = sqliteTable(
  "collection_plans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => analysisProjects.id),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    platform: text("platform").notNull().default("web"),
    includeKeywords: text("include_keywords", { mode: "json" }).notNull(),
    excludeKeywords: text("exclude_keywords", { mode: "json" }).notNull(),
    language: text("language").notNull(),
    market: text("market").notNull(),
    cadence: text("cadence").notNull().default("daily"),
    batchLimit: integer("batch_limit").notNull().default(100),
    maxRunsPerDay: integer("max_runs_per_day").notNull().default(4),
    lastRunAt: text("last_run_at"),
    nextRunAt: text("next_run_at"),
    ...timestamps
  },
  (table) => ({
    projectIdx: index("collection_plans_project_idx").on(table.projectId),
    statusNextRunIdx: index("collection_plans_status_next_run_idx").on(table.status, table.nextRunAt)
  })
);

// WHY: analysis_runs 封装单次分析全周期（配置→采集→清洗→分析→报告），是内容/洞察/报告的根上下文。
export const analysisRuns = sqliteTable(
  "analysis_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => analysisProjects.id),
    analysisBatchId: text("analysis_batch_id").references(() => analysisBatches.id),
    collectionPlanId: text("collection_plan_id").references(() => collectionPlans.id),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    runTrigger: text("run_trigger").notNull().default("manual"),
    includeKeywords: text("include_keywords", { mode: "json" }).notNull(),
    excludeKeywords: text("exclude_keywords", { mode: "json" }).notNull(),
    platform: text("platform").notNull().default("web"),
    limit: integer("run_limit").notNull().default(100),
    collectedCount: integer("collected_count").notNull().default(0),
    validCount: integer("valid_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    analyzedCount: integer("analyzed_count").notNull().default(0),
    reportId: text("report_id"),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    ...timestamps
  },
  (table) => ({
    projectIdx: index("analysis_runs_project_idx").on(table.projectId),
    statusIdx: index("analysis_runs_status_idx").on(table.status)
  })
);

// WHY: crawl_tasks 是 analysis run 的内部运行日志，所有新任务必须挂到具体 run。
export const crawlTasks = sqliteTable(
  "crawl_tasks",
  {
    id: text("id").primaryKey(),
    analysisRunId: text("analysis_run_id")
      .notNull()
      .references(() => analysisRuns.id),
    collectionPlanId: text("collection_plan_id").references(() => collectionPlans.id),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    status: text("status").notNull().default("pending"),
    targetCount: integer("target_count").notNull().default(100),
    collectedCount: integer("collected_count").notNull().default(0),
    validCount: integer("valid_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    scheduledAt: text("scheduled_at"),
    ...timestamps
  },
  (table) => ({
    statusIdx: index("crawl_tasks_status_idx").on(table.status),
    runIdx: index("crawl_tasks_run_idx").on(table.analysisRunId)
  })
);

// WHY: raw_contents 必须带 project/run/task 上下文，避免再次出现全局混杂内容库。
export const rawContents = sqliteTable(
  "raw_contents",
  {
    id: text("id").primaryKey(),
    platform: text("platform").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    analysisProjectId: text("analysis_project_id")
      .notNull()
      .references(() => analysisProjects.id),
    analysisRunId: text("analysis_run_id")
      .notNull()
      .references(() => analysisRuns.id),
    crawlTaskId: text("crawl_task_id")
      .notNull()
      .references(() => crawlTasks.id),
    matchedKeywords: text("matched_keywords", { mode: "json" }).notNull(),
    externalId: text("external_id"),
    url: text("url").notNull(),
    authorName: text("author_name"),
    authorHandle: text("author_handle"),
    text: text("text").notNull(),
    mediaUrls: text("media_urls", { mode: "json" }),
    metricsJson: text("metrics_json", { mode: "json" }),
    publishedAt: text("published_at"),
    capturedAt: text("captured_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    rawJson: text("raw_json", { mode: "json" }),
    rawHtmlPath: text("raw_html_path"),
    screenshotPath: text("screenshot_path"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => ({
    runIdx: index("raw_contents_run_idx").on(table.analysisRunId),
    externalIdx: index("raw_contents_external_idx").on(table.platform, table.externalId)
  })
);

export const cleanedContents = sqliteTable("cleaned_contents", {
  id: text("id").primaryKey(),
  rawContentId: text("raw_content_id")
    .notNull()
    .references(() => rawContents.id),
  analysisRunId: text("analysis_run_id").references(() => analysisRuns.id),
  normalizedText: text("normalized_text").notNull(),
  language: text("language").notNull(),
  isDuplicate: integer("is_duplicate", { mode: "boolean" }).notNull().default(false),
  isAd: integer("is_ad", { mode: "boolean" }).notNull().default(false),
  isIrrelevant: integer("is_irrelevant", { mode: "boolean" }).notNull().default(false),
  qualityScore: integer("quality_score").notNull().default(0),
  engagementScore: integer("engagement_score").notNull().default(0),
  cleanReason: text("clean_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const analyzedContents = sqliteTable("analyzed_contents", {
  id: text("id").primaryKey(),
  rawContentId: text("raw_content_id")
    .notNull()
    .references(() => rawContents.id),
  analysisRunId: text("analysis_run_id").references(() => analysisRuns.id),
  summary: text("summary").notNull(),
  contentType: text("content_type").notNull(),
  topics: text("topics", { mode: "json" }).notNull(),
  entities: text("entities", { mode: "json" }).notNull(),
  intent: text("intent").notNull(),
  sentiment: text("sentiment").notNull(),
  insightScore: integer("insight_score").notNull().default(0),
  opportunityScore: integer("opportunity_score").notNull().default(0),
  contentOpportunity: text("content_opportunity"),
  reason: text("reason").notNull(),
  modelName: text("model_name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

// WHY: reports 只绑定 analysis run，不再保留 topic/date-range 兼容字段。
export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => analysisProjects.id),
    analysisRunId: text("analysis_run_id")
      .notNull()
      .references(() => analysisRuns.id),
    title: text("title").notNull(),
    type: text("type").notNull(),
    contentMarkdown: text("content_markdown").notNull().default(""),
    contentJson: text("content_json", { mode: "json" }),
    status: text("status").notNull().default("draft"),
    ...timestamps
  },
  (table) => ({
    runIdx: index("reports_run_idx").on(table.analysisRunId)
  })
);
