import { z } from "zod";
import {
  crawlFrequencies,
  platforms,
  reportTypes,
  sentiments,
  taskStatuses,
  topicStatuses
} from "./domain";

const isoDateSchema = z.string().datetime();
const idSchema = z.string().min(1);

export const topicSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  language: z.string().min(2).max(12),
  market: z.string().min(2).max(64),
  status: z.enum(topicStatuses),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const querySchema = z.object({
  id: idSchema,
  topicId: idSchema,
  name: z.string().min(1).max(120),
  includeKeywords: z.array(z.string().min(1)).min(1),
  excludeKeywords: z.array(z.string().min(1)).default([]),
  platforms: z.array(z.enum(platforms)).min(1),
  language: z.string().min(2).max(12),
  frequency: z.enum(crawlFrequencies),
  limitPerRun: z.number().int().min(1).max(500),
  status: z.enum(topicStatuses),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const sourceSchema = z.object({
  id: idSchema,
  platform: z.enum(platforms),
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  requiresLogin: z.boolean(),
  crawlerType: z.enum(["cheerio", "playwright"]),
  defaultLimit: z.number().int().min(1).max(500),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const crawlTaskSchema = z.object({
  id: idSchema,
  topicId: idSchema,
  queryId: idSchema,
  sourceId: idSchema,
  status: z.enum(taskStatuses),
  targetCount: z.number().int().min(1),
  collectedCount: z.number().int().min(0),
  validCount: z.number().int().min(0),
  duplicateCount: z.number().int().min(0),
  errorMessage: z.string().optional(),
  startedAt: isoDateSchema.optional(),
  finishedAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const analyzedContentSchema = z.object({
  rawContentId: idSchema,
  summary: z.string().min(1),
  contentType: z.string().min(1),
  topics: z.array(z.string().min(1)),
  entities: z.array(z.string().min(1)),
  intent: z.string().min(1),
  sentiment: z.enum(sentiments),
  insightScore: z.number().min(0).max(100),
  opportunityScore: z.number().min(0).max(100),
  reason: z.string().min(1),
  modelName: z.string().min(1)
});

export const rawContentSchema = z.object({
  id: idSchema,
  platform: z.enum(platforms),
  sourceId: idSchema,
  queryId: idSchema,
  topicId: idSchema,
  externalId: z.string().optional(),
  url: z.string().url(),
  authorName: z.string().optional(),
  authorHandle: z.string().optional(),
  text: z.string().min(1),
  metricsJson: z.record(z.unknown()).nullable(),
  publishedAt: isoDateSchema.optional(),
  capturedAt: z.string().min(1),
  rawJson: z.record(z.unknown()).nullable(),
  createdAt: z.string().min(1)
});

export const reportSchema = z.object({
  id: idSchema,
  topicId: idSchema,
  title: z.string().min(1).max(200),
  type: z.enum(reportTypes),
  dateRangeStart: isoDateSchema,
  dateRangeEnd: isoDateSchema,
  contentMarkdown: z.string().min(1),
  status: z.enum(["draft", "ready", "failed"]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export type TopicDto = z.infer<typeof topicSchema>;
export type QueryDto = z.infer<typeof querySchema>;
export type SourceDto = z.infer<typeof sourceSchema>;
export type CrawlTaskDto = z.infer<typeof crawlTaskSchema>;
export type RawContentDto = z.infer<typeof rawContentSchema>;
export type AnalyzedContentDto = z.infer<typeof analyzedContentSchema>;
export type ReportDto = z.infer<typeof reportSchema>;
