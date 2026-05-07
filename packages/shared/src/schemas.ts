import { z } from "zod";
import {
  analysisReportTypes,
  analysisRunStatuses,
  platforms,
  projectStatuses,
  taskStatuses
} from "./domain";

const isoDateSchema = z.string().datetime();
const idSchema = z.string().min(1);

// WHY: source 是平台元数据基础，未来可扩展多平台；当前采集 service 只启动 Reddit。
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
  analysisRunId: idSchema,
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

export type SourceDto = z.infer<typeof sourceSchema>;
export type CrawlTaskDto = z.infer<typeof crawlTaskSchema>;

// WHY: Analysis Project/Run 是当前业务实体，所有采集内容和报告都挂在 run 上。
export const analysisProjectSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  goal: z.string().min(1).max(1000),
  language: z.string().min(2).max(12),
  market: z.string().min(2).max(64),
  defaultPlatform: z.literal("reddit"),
  defaultLimit: z.number().int().min(1).max(500),
  status: z.enum(projectStatuses),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const analysisRunSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  name: z.string().min(1).max(200),
  status: z.enum(analysisRunStatuses),
  includeKeywords: z.array(z.string().min(1)),
  excludeKeywords: z.array(z.string().min(1)),
  platform: z.literal("reddit"),
  limit: z.number().int().min(1).max(500),
  collectedCount: z.number().int().min(0),
  validCount: z.number().int().min(0),
  duplicateCount: z.number().int().min(0),
  analyzedCount: z.number().int().min(0),
  reportId: idSchema.optional(),
  errorMessage: z.string().optional(),
  startedAt: isoDateSchema.optional(),
  finishedAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const runContentSchema = z.object({
  id: idSchema,
  analysisProjectId: idSchema,
  analysisRunId: idSchema,
  crawlTaskId: idSchema,
  platform: z.enum(platforms),
  sourceId: idSchema,
  authorName: z.string().optional(),
  authorHandle: z.string().optional(),
  url: z.string().url(),
  text: z.string().min(1),
  matchedKeywords: z.array(z.string()),
  metricsJson: z.record(z.unknown()).nullable(),
  publishedAt: isoDateSchema.optional(),
  capturedAt: z.string().min(1)
});

export const runReportSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  analysisRunId: idSchema,
  title: z.string().min(1).max(200),
  type: z.enum(analysisReportTypes),
  status: z.enum(["draft", "ready", "failed"]),
  contentMarkdown: z.string(),
  contentJson: z.record(z.unknown()).optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const createAnalysisRunInputSchema = z.object({
  projectId: idSchema.optional(),
  projectName: z.string().min(1).max(120).optional(),
  goal: z.string().min(1).max(1000),
  includeKeywords: z.array(z.string().min(1)).min(1),
  excludeKeywords: z.array(z.string().min(1)).default([]),
  language: z.string().min(2).max(12),
  market: z.string().min(2).max(64),
  limit: z.number().int().min(1).max(500).default(100)
});

export type AnalysisProjectDto = z.infer<typeof analysisProjectSchema>;
export type AnalysisRunDto = z.infer<typeof analysisRunSchema>;
export type RunContentDto = z.infer<typeof runContentSchema>;
export type RunReportDto = z.infer<typeof runReportSchema>;
export type CreateAnalysisRunInput = z.infer<typeof createAnalysisRunInputSchema>;
