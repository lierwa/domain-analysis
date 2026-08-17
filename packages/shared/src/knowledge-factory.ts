import { z } from "zod";

import { evidenceKinds } from "./evidence";
import { knowledgeLayers, sourceAuthorityTypes } from "./product-knowledge";

const idSchema = z.string().min(1).max(240);
const isoDateSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const predicateSchema = z.string().regex(/^[a-z][a-z0-9_.-]+$/);

export const knowledgeSubjectKinds = [
  "foundational_concept",
  "category",
  "brand",
  "model",
  "variant",
  "offer",
  "experience",
] as const;

export const knowledgeSubjectSchema = z.object({
  key: idSchema,
  kind: z.enum(knowledgeSubjectKinds),
  label: z.string().min(1).max(500),
}).strict();

export const knowledgeValueSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    raw: z.string().min(1).max(100_000),
    normalized: z.string().min(1).max(100_000).optional(),
  }).strict(),
  z.object({
    kind: z.literal("decimal"),
    raw: z.string().min(1).max(20_000),
    value: z.number().finite(),
    unitCode: z.string().min(1).max(100),
  }).strict(),
  z.object({
    kind: z.literal("boolean"),
    raw: z.string().min(1).max(20_000),
    value: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal("enum"),
    raw: z.string().min(1).max(20_000),
    value: idSchema,
  }).strict(),
  z.object({
    kind: z.literal("subject_ref"),
    subject: knowledgeSubjectSchema,
  }).strict(),
]);

export const knowledgeDerivationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("deterministic"),
    recipeVersion: idSchema,
  }).strict(),
  z.object({
    kind: z.literal("model"),
    recipeVersion: idSchema,
    modelId: idSchema,
    reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]),
  }).strict(),
]);

const knowledgeClaimCandidateContentSchema = z.object({
  knowledgeNeedId: idSchema,
  subject: knowledgeSubjectSchema,
  knowledgeLayer: z.enum(knowledgeLayers),
  predicate: predicateSchema,
  value: knowledgeValueSchema,
  evidenceIds: z.array(idSchema).min(1),
  limitations: z.array(z.string().min(1).max(2000)),
  derivation: knowledgeDerivationSchema,
  status: z.literal("review_required"),
}).strict();

export const knowledgeClaimCandidateDraftSchema = knowledgeClaimCandidateContentSchema;

export const knowledgeClaimCandidateSchema = z.object({
  id: idSchema,
  batchId: idSchema,
  projectId: idSchema,
  categoryDefinitionVersionId: idSchema,
  createdAt: isoDateSchema,
}).merge(knowledgeClaimCandidateContentSchema).strict();

const conflictAlternativeSchema = z.object({
  value: knowledgeValueSchema,
  evidenceIds: z.array(idSchema).min(1),
}).strict();

const knowledgeConflictContentObjectSchema = z.object({
  knowledgeNeedId: idSchema,
  subject: knowledgeSubjectSchema,
  knowledgeLayer: z.enum(knowledgeLayers),
  predicate: predicateSchema,
  alternatives: z.array(conflictAlternativeSchema).min(2),
  reasonCode: z.enum(["distinct_normalized_values", "identity_collision"]),
  status: z.literal("review_required"),
}).strict();

function validateConflictAlternatives(
  conflict: z.infer<typeof knowledgeConflictContentObjectSchema>,
  context: z.RefinementCtx,
) {
  const values = new Set(conflict.alternatives.map(({ value }) => JSON.stringify(value)));
  if (values.size !== conflict.alternatives.length) {
    context.addIssue({ code: "custom", path: ["alternatives"], message: "冲突值必须互不相同" });
  }
}

export const knowledgeConflictDraftSchema = knowledgeConflictContentObjectSchema
  .superRefine(validateConflictAlternatives);

export const knowledgeConflictSchema = z.object({
  id: idSchema,
  batchId: idSchema,
  projectId: idSchema,
  categoryDefinitionVersionId: idSchema,
  createdAt: isoDateSchema,
}).merge(knowledgeConflictContentObjectSchema).strict().superRefine(validateConflictAlternatives);

const knowledgeUnknownContentSchema = z.object({
  knowledgeNeedId: idSchema,
  subject: knowledgeSubjectSchema,
  question: z.string().min(1).max(2000),
  reasonCode: z.enum([
    "evidence_missing",
    "evidence_insufficient",
    "unmapped_evidence",
    "ambiguous_subject",
    "relationship_side_missing",
  ]),
  evidenceRequestIds: z.array(idSchema).min(1),
  examinedEvidenceIds: z.array(idSchema),
  status: z.literal("unknown"),
}).strict();

export const knowledgeUnknownDraftSchema = knowledgeUnknownContentSchema;

export const knowledgeUnknownSchema = z.object({
  id: idSchema,
  batchId: idSchema,
  projectId: idSchema,
  categoryDefinitionVersionId: idSchema,
  createdAt: isoDateSchema,
}).merge(knowledgeUnknownContentSchema).strict();

export const knowledgeFactoryBatchSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  categoryDefinitionVersionId: idSchema,
  recipeVersion: idSchema,
  inputHash: sha256Schema,
  evidenceRequestIds: z.array(idSchema).min(1),
  status: z.enum(["completed", "failed"]),
  candidateCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
  errorCode: idSchema.optional(),
  createdAt: isoDateSchema,
  finishedAt: isoDateSchema,
}).strict().superRefine((batch, context) => {
  if (batch.status === "failed" && !batch.errorCode) {
    context.addIssue({ code: "custom", path: ["errorCode"], message: "失败批次必须记录错误码" });
  }
  if (batch.status === "completed" && batch.errorCode) {
    context.addIssue({ code: "custom", path: ["errorCode"], message: "成功批次不能携带错误码" });
  }
});

export const runKnowledgeFactorySchema = z.object({
  projectId: idSchema,
  categoryDefinitionVersionId: idSchema,
  recipeVersion: idSchema,
  evidenceRequestIds: z.array(idSchema).min(1),
}).strict().superRefine((input, context) => {
  if (new Set(input.evidenceRequestIds).size !== input.evidenceRequestIds.length) {
    context.addIssue({ code: "custom", path: ["evidenceRequestIds"], message: "证据请求不得重复" });
  }
});

export const knowledgeFactoryBatchViewSchema = z.object({
  batch: knowledgeFactoryBatchSchema,
  candidates: z.array(knowledgeClaimCandidateSchema),
  conflicts: z.array(knowledgeConflictSchema),
  unknowns: z.array(knowledgeUnknownSchema),
}).strict();

export const reviewGroupingSchema = z.object({
  categoryDefinitionVersionId: idSchema,
  knowledgeNeedId: idSchema.optional(),
  reasonCode: idSchema.optional(),
  sourceAuthorityType: z.enum(sourceAuthorityTypes).optional(),
  evidenceKind: z.enum(evidenceKinds).optional(),
}).strict();

export const knowledgeReviewSelectionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("accept_candidates"),
    targetIds: z.array(idSchema).min(1),
  }).strict(),
  z.object({
    action: z.literal("reject_candidates"),
    targetIds: z.array(idSchema).min(1),
  }).strict(),
  z.object({
    action: z.literal("resolve_conflict"),
    targetIds: z.array(idSchema).length(1),
    selectedAlternativeIndex: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    action: z.literal("acknowledge_conflicts"),
    targetIds: z.array(idSchema).min(1),
  }).strict(),
  z.object({
    action: z.literal("acknowledge_unknowns"),
    targetIds: z.array(idSchema).min(1),
  }).strict(),
]).superRefine((selection, context) => {
  if (new Set(selection.targetIds).size !== selection.targetIds.length) {
    context.addIssue({ code: "custom", path: ["targetIds"], message: "审核目标不得重复" });
  }
});

const reviewDecisionContentSchema = z.object({
  batchId: idSchema,
  reviewer: z.string().min(1).max(500),
  rationale: z.string().min(1).max(4000),
  grouping: reviewGroupingSchema,
  selection: knowledgeReviewSelectionSchema,
}).strict();

export const knowledgeReviewDecisionDraftSchema = reviewDecisionContentSchema;

export const knowledgeReviewDecisionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  decidedAt: isoDateSchema,
}).merge(reviewDecisionContentSchema).strict();

export const reviewedKnowledgeEntrySchema = z.object({
  sourceTargetKind: z.enum(["candidate", "conflict"]),
  sourceTargetId: idSchema,
  decisionId: idSchema,
  projectId: idSchema,
  categoryDefinitionVersionId: idSchema,
  knowledgeNeedId: idSchema,
  subject: knowledgeSubjectSchema,
  knowledgeLayer: z.enum(knowledgeLayers),
  predicate: predicateSchema,
  value: knowledgeValueSchema,
  evidenceIds: z.array(idSchema).min(1),
  limitations: z.array(z.string().min(1).max(2000)),
  confirmedAt: isoDateSchema,
}).strict();

const reviewedStateBaseSchema = z.object({
  sourceTargetId: idSchema,
  decisionId: idSchema,
  projectId: idSchema,
  categoryDefinitionVersionId: idSchema,
  knowledgeNeedId: idSchema,
  subject: knowledgeSubjectSchema,
  confirmedAt: isoDateSchema,
}).strict();

export const publishableKnowledgeStateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fact"),
    entry: reviewedKnowledgeEntrySchema,
  }).strict(),
  reviewedStateBaseSchema.extend({
    kind: z.literal("conflict"),
    knowledgeLayer: z.enum(knowledgeLayers),
    predicate: predicateSchema,
    alternatives: z.array(conflictAlternativeSchema).min(2),
    reasonCode: knowledgeConflictContentObjectSchema.shape.reasonCode,
  }).strict(),
  reviewedStateBaseSchema.extend({
    kind: z.literal("unknown"),
    question: z.string().min(1).max(2000),
    reasonCode: knowledgeUnknownContentSchema.shape.reasonCode,
    evidenceRequestIds: z.array(idSchema).min(1),
    evidenceIds: z.array(idSchema),
  }).strict(),
]);

export type KnowledgeSubject = z.infer<typeof knowledgeSubjectSchema>;
export type KnowledgeValue = z.infer<typeof knowledgeValueSchema>;
export type KnowledgeClaimCandidateDraft = z.infer<typeof knowledgeClaimCandidateDraftSchema>;
export type KnowledgeClaimCandidate = z.infer<typeof knowledgeClaimCandidateSchema>;
export type KnowledgeConflictDraft = z.infer<typeof knowledgeConflictDraftSchema>;
export type KnowledgeConflict = z.infer<typeof knowledgeConflictSchema>;
export type KnowledgeUnknownDraft = z.infer<typeof knowledgeUnknownDraftSchema>;
export type KnowledgeUnknown = z.infer<typeof knowledgeUnknownSchema>;
export type KnowledgeFactoryBatch = z.infer<typeof knowledgeFactoryBatchSchema>;
export type RunKnowledgeFactoryInput = z.infer<typeof runKnowledgeFactorySchema>;
export type KnowledgeFactoryBatchView = z.infer<typeof knowledgeFactoryBatchViewSchema>;
export type KnowledgeReviewDecisionDraft = z.infer<typeof knowledgeReviewDecisionDraftSchema>;
export type KnowledgeReviewDecision = z.infer<typeof knowledgeReviewDecisionSchema>;
export type ReviewedKnowledgeEntry = z.infer<typeof reviewedKnowledgeEntrySchema>;
export type PublishableKnowledgeState = z.infer<typeof publishableKnowledgeStateSchema>;
