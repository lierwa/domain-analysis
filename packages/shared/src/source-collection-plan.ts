import { z } from "zod";

import { sourceAuthorityTypes } from "./product-knowledge";
import { sourceAccessPolicySchema } from "./source-dataset";
import { sourceCollectionWorkItemSchema } from "./source-collection-pipeline";

const idSchema = z.string().min(1).max(240);
const isoDateSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const sourceCollectionPlanIssueCodes = [
  "confirmed_brief_missing",
  "source_entrypoint_missing",
  "source_assignment_missing",
  "planning_rule_missing",
  "planning_rule_ambiguous",
  "knowledge_need_missing",
  "local_read_not_allowed",
  "evidence_storage_not_allowed",
] as const;

export const sourceCollectionPlanIssueSchema = z.object({
  code: z.enum(sourceCollectionPlanIssueCodes),
  message: z.string().min(1).max(2000),
  sourceReferenceId: idSchema.optional(),
  requestedUrl: z.string().url().optional(),
}).strict();

export const sourceCollectionPlanBatchSchema = z.object({
  key: idSchema,
  providerKey: idSchema,
  accessPolicy: sourceAccessPolicySchema,
  workItems: z.array(sourceCollectionWorkItemSchema).min(1).max(100_000),
}).strict();

export const sourceCollectionPlanLaneSchema = z.object({
  collectionLaneId: idSchema,
  sourceAuthorityType: z.enum(sourceAuthorityTypes),
  status: z.enum(["ready", "partial", "waiting"]),
  batches: z.array(sourceCollectionPlanBatchSchema),
  issues: z.array(sourceCollectionPlanIssueSchema),
}).strict().superRefine((lane, context) => {
  if (lane.status === "ready" && (lane.batches.length === 0 || lane.issues.length > 0)) {
    context.addIssue({ code: "custom", message: "ready 路线必须有批次且不能有问题" });
  }
  if (lane.status === "partial" && (lane.batches.length === 0 || lane.issues.length === 0)) {
    context.addIssue({ code: "custom", message: "partial 路线必须同时有批次和问题" });
  }
  if (lane.status === "waiting" && (lane.batches.length > 0 || lane.issues.length === 0)) {
    context.addIssue({ code: "custom", message: "waiting 路线只能包含待解决问题" });
  }
});

export const sourceCollectionPlanContentSchema = z.object({
  recipeVersion: idSchema,
  confirmedBriefId: idSchema,
  lanes: z.array(sourceCollectionPlanLaneSchema).min(1),
}).strict();

export const sourceCollectionPlanSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  projectRevision: z.number().int().positive(),
  categoryDefinitionVersionId: idSchema,
  confirmedScopeVersionId: idSchema,
  collectionBoardVersionId: idSchema,
  contentHash: sha256Schema,
  content: sourceCollectionPlanContentSchema,
  createdAt: isoDateSchema,
}).strict();

export type SourceCollectionPlanIssue = z.infer<typeof sourceCollectionPlanIssueSchema>;
export type SourceCollectionPlanBatch = z.infer<typeof sourceCollectionPlanBatchSchema>;
export type SourceCollectionPlanLane = z.infer<typeof sourceCollectionPlanLaneSchema>;
export type SourceCollectionPlanContent = z.infer<typeof sourceCollectionPlanContentSchema>;
export type SourceCollectionPlan = z.infer<typeof sourceCollectionPlanSchema>;
