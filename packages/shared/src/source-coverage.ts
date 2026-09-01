import { z } from "zod";

const idSchema = z.string().min(1).max(240);
const isoDateSchema = z.string().datetime({ offset: true });

export const publicResearchSourceKinds = [
  "regulator",
  "standards_body",
  "technical_publisher",
  "industry_organization",
  "brand_official",
] as const;

export const publicResearchFacets = [
  "operating_principle",
  "core_components",
  "safety_and_regulation",
  "performance_and_testing",
  "use_and_maintenance",
  "category_specific",
] as const;

export const requiredSourceCoverageFacets = [
  "operating_principle",
  "core_components",
  "safety_and_regulation",
  "performance_and_testing",
  "use_and_maintenance",
] as const;

export const sourceCoverageFamilies = [
  "standards_and_regulation",
  "professional_technical",
  "brand_official",
] as const;

export const sourceCoverageFamilyKinds = {
  standards_and_regulation: ["regulator", "standards_body"],
  professional_technical: ["technical_publisher", "industry_organization"],
  brand_official: ["brand_official"],
} as const satisfies Record<(typeof sourceCoverageFamilies)[number], readonly (typeof publicResearchSourceKinds)[number][]>;

export const completedSourceReferenceSchema = z.object({
  providerKey: z.literal("zol.catalog-gallery"),
  sourceBatchId: idSchema,
  reason: z.string().trim().min(1).max(2_000),
}).strict();

const coverageDimensionSchema = z.object({
  acceptedSourceCount: z.number().int().nonnegative(),
  distinctOriginCount: z.number().int().nonnegative(),
  minimumAcceptedSources: z.number().int().positive(),
  minimumDistinctOrigins: z.number().int().positive(),
  status: z.enum(["satisfied", "gap"]),
}).strict();

export const sourceCoverageAssessmentSchema = z.object({
  policyVersion: z.literal("source-coverage-v1"),
  status: z.enum(["satisfied", "gaps", "in_progress"]),
  productCatalog: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("satisfied"),
      reference: completedSourceReferenceSchema,
      // WHY：历史 v7 覆盖快照没有目录计数，保持只读；新投影必须实际写入这些字段。
      brandCount: z.number().int().positive().optional(),
      modelCount: z.number().int().positive().optional(),
      coveredModelCount: z.number().int().positive().optional(),
      acceptedSnapshotCount: z.number().int().positive().optional(),
    }).strict(),
    z.object({ status: z.literal("gap") }).strict(),
  ]),
  acceptedSources: z.array(z.object({
    sourceKey: idSchema,
    url: z.string().url().max(2_048),
    origin: z.string().url().max(2_048),
    publisher: z.string().trim().min(1).max(500),
    sourceKind: z.enum(publicResearchSourceKinds),
    facets: z.array(z.enum(publicResearchFacets)).min(1).max(20),
    facetEvidenceBasis: z.literal("confirmed_plan_topic_mapping").optional(),
    planId: idSchema,
    planVersion: z.number().int().positive(),
    runId: idSchema,
    snapshotId: idSchema,
  }).strict()).max(500),
  attemptedUrls: z.array(z.string().url().max(2_048)).max(1_000),
  families: z.array(coverageDimensionSchema.extend({
    key: z.enum(sourceCoverageFamilies),
  }).strict()).length(sourceCoverageFamilies.length),
  facets: z.array(coverageDimensionSchema.extend({
    key: z.enum(requiredSourceCoverageFacets),
  }).strict()).length(requiredSourceCoverageFacets.length),
  gaps: z.array(z.object({
    kind: z.enum(["product_catalog", "family", "facet"]),
    key: z.string().min(1).max(120),
    missingSources: z.number().int().nonnegative(),
    missingOrigins: z.number().int().nonnegative(),
    targetCandidateCount: z.number().int().positive(),
    targetOriginCount: z.number().int().positive(),
  }).strict()).max(20),
  unfinishedExecutionIds: z.array(idSchema).max(500),
  assessedAt: isoDateSchema,
}).strict();

export type PublicResearchSourceKind = (typeof publicResearchSourceKinds)[number];
export type PublicResearchFacet = (typeof publicResearchFacets)[number];
export type RequiredSourceCoverageFacet = (typeof requiredSourceCoverageFacets)[number];
export type SourceCoverageFamily = (typeof sourceCoverageFamilies)[number];
export type CompletedSourceReference = z.infer<typeof completedSourceReferenceSchema>;
export type SourceCoverageAssessment = z.infer<typeof sourceCoverageAssessmentSchema>;
