import { z } from "zod";

export const evidenceSchema = z.object({
  source: z.enum(["post_body", "comment", "title", "media_context"]),
  rawContentId: z.string().min(1),
  quote: z.string().min(1),
  url: z.string().url(),
  commentAuthor: z.string().optional()
});

export const postInsightSchema = z.object({
  rawContentId: z.string().min(1),
  problemStatement: z.string().min(1),
  userIntent: z.string().min(1),
  audienceSegment: z.string().min(1),
  needType: z.string().min(1),
  painPoints: z.array(z.string().min(1)).min(1),
  desiredOutcome: z.string().min(1),
  sentiment: z.enum(["positive", "neutral", "concerned", "negative", "mixed", "unknown"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceSchema).min(1),
  recommendedAction: z.string().min(1)
});

export const runInsightThemeSchema = z.object({
  themeName: z.string().min(1),
  whyItMatters: z.string().min(1),
  opportunityType: z.string().min(1),
  demandSignals: z.array(z.string().min(1)).min(1),
  contentIdeas: z.array(z.string().min(1)).default([]),
  productServiceIdeas: z.array(z.string().min(1)).default([]),
  representativePostIds: z.array(z.string().min(1)).default([]),
  riskOrLimitations: z.array(z.string().min(1)).default([])
});

export const runInsightSummarySchema = z.object({
  themes: z.array(runInsightThemeSchema).default([]),
  opportunityTypes: z.array(z.string().min(1)).default([]),
  topDemandSignals: z.array(z.string().min(1)).default([]),
  recommendedNextActions: z.array(z.string().min(1)).default([]),
  dataLimitations: z.array(z.string().min(1)).default([])
});

export const runAiInsightOutputSchema = z.object({
  items: z.array(postInsightSchema),
  summary: runInsightSummarySchema
});

export type Evidence = z.infer<typeof evidenceSchema>;
export type PostInsight = z.infer<typeof postInsightSchema>;
export type RunInsightTheme = z.infer<typeof runInsightThemeSchema>;
export type RunInsightSummary = z.infer<typeof runInsightSummarySchema>;
export type RunAiInsightOutput = z.infer<typeof runAiInsightOutputSchema>;
