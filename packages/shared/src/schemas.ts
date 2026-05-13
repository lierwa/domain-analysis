import { z } from "zod";
import {
  analysisBatchPlatforms,
  analysisBatchStatuses,
  analysisReportTypes,
  analysisRunStatuses,
  collectionCadences,
  collectionPlanStatuses,
  collectionRunTriggers,
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
  pagesCollected: z.number().int().min(0).optional(),
  stopReason: z.string().optional(),
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
  defaultPlatform: z.enum(platforms).default("web"),
  defaultLimit: z.number().int().min(1).max(500),
  status: z.enum(projectStatuses),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const platformLimitSchema = z.object({
  platform: z.enum(analysisBatchPlatforms),
  limit: z.number().int().min(1).max(500)
});

export const analysisBatchSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  name: z.string().min(1).max(200),
  status: z.enum(analysisBatchStatuses),
  goal: z.string().min(1).max(1000),
  includeKeywords: z.array(z.string().min(1)),
  excludeKeywords: z.array(z.string().min(1)),
  language: z.string().min(2).max(12),
  market: z.string().min(2).max(64),
  collectedCount: z.number().int().min(0),
  validCount: z.number().int().min(0),
  duplicateCount: z.number().int().min(0),
  runCount: z.number().int().min(0).optional(),
  reportId: idSchema.optional(),
  errorMessage: z.string().optional(),
  startedAt: isoDateSchema.optional(),
  finishedAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const collectionPlanSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  name: z.string().min(1).max(160),
  status: z.enum(collectionPlanStatuses),
  platform: z.enum(platforms),
  includeKeywords: z.array(z.string().min(1)).min(1),
  excludeKeywords: z.array(z.string().min(1)),
  language: z.string().min(2).max(12),
  market: z.string().min(2).max(64),
  cadence: z.enum(collectionCadences),
  batchLimit: z.number().int().min(1).max(500),
  maxRunsPerDay: z.number().int().min(1).max(24),
  lastRunAt: isoDateSchema.optional(),
  nextRunAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

export const createCollectionPlanInputSchema = z.object({
  projectId: idSchema,
  name: z.string().min(1).max(160),
  platform: z.enum(platforms).default("web"),
  includeKeywords: z.array(z.string().min(1)).min(1),
  excludeKeywords: z.array(z.string().min(1)).default([]),
  language: z.string().min(2).max(12),
  market: z.string().min(2).max(64),
  cadence: z.enum(collectionCadences).default("daily"),
  batchLimit: z.number().int().min(1).max(500).default(100),
  maxRunsPerDay: z.number().int().min(1).max(24).default(4)
});

export const collectionRunTriggerSchema = z.enum(collectionRunTriggers);

export const analysisRunSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  analysisBatchId: idSchema.optional(),
  name: z.string().min(1).max(200),
  status: z.enum(analysisRunStatuses),
  includeKeywords: z.array(z.string().min(1)),
  excludeKeywords: z.array(z.string().min(1)),
  platform: z.enum(platforms),
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
  mediaUrls: z.array(z.string().url()).nullable().optional(),
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
  platform: z.enum(platforms),
  goal: z.string().min(1).max(1000),
  includeKeywords: z.array(z.string().min(1)).min(1),
  excludeKeywords: z.array(z.string().min(1)).default([]),
  language: z.string().min(2).max(12),
  market: z.string().min(2).max(64),
  limit: z.number().int().min(1).max(500).default(100)
});

export const createAnalysisBatchInputSchema = z
  .object({
    projectId: idSchema.optional(),
    projectName: z.string().min(1).max(120).optional(),
    goal: z.string().min(1).max(1000),
    includeKeywords: z.array(z.string().min(1)).min(1),
    excludeKeywords: z.array(z.string().min(1)).default([]),
    language: z.string().min(2).max(12),
    market: z.string().min(2).max(64),
    platformLimits: z.array(platformLimitSchema).min(1).max(4)
  })
  .superRefine((input, ctx) => {
    const platformsSeen = new Set<string>();
    for (const [index, item] of input.platformLimits.entries()) {
      if (!platformsSeen.has(item.platform)) {
        platformsSeen.add(item.platform);
        continue;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["platformLimits", index, "platform"],
        message: "Platform can only appear once in a batch"
      });
    }
  });

export type AnalysisBatchDto = z.infer<typeof analysisBatchSchema>;
export type PlatformLimitDto = z.infer<typeof platformLimitSchema>;
export type AnalysisProjectDto = z.infer<typeof analysisProjectSchema>;
export type CollectionPlanDto = z.infer<typeof collectionPlanSchema>;
export type CreateCollectionPlanInput = z.infer<typeof createCollectionPlanInputSchema>;
export type CollectionRunTriggerDto = z.infer<typeof collectionRunTriggerSchema>;
export type AnalysisRunDto = z.infer<typeof analysisRunSchema>;
export type RunContentDto = z.infer<typeof runContentSchema>;
export type RunReportDto = z.infer<typeof runReportSchema>;
export type CreateAnalysisRunInput = z.infer<typeof createAnalysisRunInputSchema>;
export type CreateAnalysisBatchInput = z.infer<typeof createAnalysisBatchInputSchema>;
