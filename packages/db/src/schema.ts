import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
};

export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  language: text("language").notNull(),
  market: text("market").notNull(),
  status: text("status").notNull().default("active"),
  ...timestamps
});

export const queries = sqliteTable(
  "queries",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id").notNull().references(() => topics.id),
    name: text("name").notNull(),
    includeKeywords: text("include_keywords", { mode: "json" }).notNull(),
    excludeKeywords: text("exclude_keywords", { mode: "json" }).notNull(),
    platforms: text("platforms", { mode: "json" }).notNull(),
    language: text("language").notNull(),
    frequency: text("frequency").notNull().default("manual"),
    limitPerRun: integer("limit_per_run").notNull().default(100),
    status: text("status").notNull().default("active"),
    ...timestamps
  },
  (table) => ({
    topicIdx: index("queries_topic_idx").on(table.topicId)
  })
);

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

export const crawlTasks = sqliteTable(
  "crawl_tasks",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id").notNull().references(() => topics.id),
    queryId: text("query_id").notNull().references(() => queries.id),
    sourceId: text("source_id").notNull().references(() => sources.id),
    status: text("status").notNull().default("pending"),
    targetCount: integer("target_count").notNull().default(100),
    collectedCount: integer("collected_count").notNull().default(0),
    validCount: integer("valid_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    ...timestamps
  },
  (table) => ({
    statusIdx: index("crawl_tasks_status_idx").on(table.status),
    topicIdx: index("crawl_tasks_topic_idx").on(table.topicId)
  })
);

export const rawContents = sqliteTable(
  "raw_contents",
  {
    id: text("id").primaryKey(),
    platform: text("platform").notNull(),
    sourceId: text("source_id").notNull().references(() => sources.id),
    queryId: text("query_id").notNull().references(() => queries.id),
    topicId: text("topic_id").notNull().references(() => topics.id),
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
    topicIdx: index("raw_contents_topic_idx").on(table.topicId),
    externalIdx: index("raw_contents_external_idx").on(table.platform, table.externalId)
  })
);

export const cleanedContents = sqliteTable("cleaned_contents", {
  id: text("id").primaryKey(),
  rawContentId: text("raw_content_id").notNull().references(() => rawContents.id),
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
  rawContentId: text("raw_content_id").notNull().references(() => rawContents.id),
  summary: text("summary").notNull(),
  contentType: text("content_type").notNull(),
  topics: text("topics", { mode: "json" }).notNull(),
  entities: text("entities", { mode: "json" }).notNull(),
  intent: text("intent").notNull(),
  sentiment: text("sentiment").notNull(),
  insightScore: integer("insight_score").notNull().default(0),
  opportunityScore: integer("opportunity_score").notNull().default(0),
  reason: text("reason").notNull(),
  modelName: text("model_name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const trendSnapshots = sqliteTable("trend_snapshots", {
  id: text("id").primaryKey(),
  topicId: text("topic_id").notNull().references(() => topics.id),
  dateRangeStart: text("date_range_start").notNull(),
  dateRangeEnd: text("date_range_end").notNull(),
  volumeTotal: integer("volume_total").notNull().default(0),
  volumeByPlatform: text("volume_by_platform", { mode: "json" }).notNull(),
  sentimentDistribution: text("sentiment_distribution", { mode: "json" }).notNull(),
  topTopics: text("top_topics", { mode: "json" }).notNull(),
  topKeywords: text("top_keywords", { mode: "json" }).notNull(),
  topContents: text("top_contents", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id").notNull().references(() => topics.id),
    title: text("title").notNull(),
    type: text("type").notNull(),
    dateRangeStart: text("date_range_start").notNull(),
    dateRangeEnd: text("date_range_end").notNull(),
    contentMarkdown: text("content_markdown").notNull(),
    contentJson: text("content_json", { mode: "json" }),
    status: text("status").notNull().default("draft"),
    ...timestamps
  },
  (table) => ({
    topicIdx: index("reports_topic_idx").on(table.topicId)
  })
);
