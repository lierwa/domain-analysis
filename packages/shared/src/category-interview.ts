import { z } from "zod";

import {
  categoryAttributeSchema,
  collectionAccessModes,
  collectionStopConditions,
  decisionDimensionSchema,
  knowledgeLayers,
  sourceAuthorityTypes,
} from "./product-knowledge";
import { sourceCollectionRequestSchema } from "./source-collection-pipeline";

const idSchema = z.string().min(1);
const isoDateSchema = z.string().datetime();
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const revisionSchema = z.number().int().positive();
const urlSchema = z.string().min(1).max(4000).superRefine((value, context) => {
  // WHY：领域层仍严格验证 URL；避免把 response-format 不支持的 `format: uri` 泄漏到模型 seam。
  if (!URL.canParse(value)) context.addIssue({ code: "custom", message: "来源 URL 无效" });
});

export const interviewPhases = ["active", "brief_ready", "confirmed"] as const;
export const interviewTurnStates = ["idle", "running", "interrupted", "failed"] as const;

export const interviewSessionSchema = z.object({
  id: idSchema,
  categoryHint: z.string().min(1).max(120),
  phase: z.enum(interviewPhases),
  turnState: z.enum(interviewTurnStates),
  revision: revisionSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict();

export const normalizedInterviewMessageSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  sequence: z.number().int().positive(),
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(40_000),
  deliveryStatus: z.enum(["completed", "interrupted", "failed"]),
  error: z.string().min(1).max(2000).optional(),
  createdAt: isoDateSchema,
}).strict();

export const interviewDecisionSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  key: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
  question: z.string().min(1).max(1000),
  selection: z.string().min(1).max(2000),
  rationale: z.string().min(1).max(4000),
  status: z.enum(["proposed", "confirmed", "superseded"]),
  sourceMessageId: idSchema,
  supersedesDecisionId: idSchema.optional(),
  createdAt: isoDateSchema,
  confirmedAt: isoDateSchema.optional(),
}).strict().superRefine((decision, context) => {
  if (decision.status === "confirmed" && !decision.confirmedAt) {
    context.addIssue({ code: "custom", path: ["confirmedAt"], message: "已确认决定必须记录确认时间" });
  }
});

export const interviewUnresolvedItemSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  key: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
  description: z.string().min(1).max(2000),
  owner: z.enum(["system", "user"]),
  status: z.enum(["open", "resolved"]),
  resolution: z.string().min(1).max(4000).optional(),
  createdAt: isoDateSchema,
  resolvedAt: isoDateSchema.optional(),
}).strict();

const knowledgeNeedSchema = z.object({
  id: idSchema,
  question: z.string().min(1).max(1000),
  knowledgeLayers: z.array(z.enum(knowledgeLayers)).min(1),
  priority: z.enum(["must", "should", "could"]),
}).strict();

const interviewTargetSchema = z.object({
  key: z.string().min(1).max(200),
  kind: z.enum(["foundational_concept", "category", "brand", "model", "variant"]),
  label: z.string().min(1).max(200),
  parentKey: z.string().min(1).max(200).nullable().optional()
    .transform((value) => value ?? undefined),
  disposition: z.enum(["included", "excluded"]),
  reason: z.string().min(1).max(1000),
}).strict();

const factReferenceSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(500),
  url: urlSchema,
  sourceAuthorityType: z.enum(sourceAuthorityTypes),
  observedAt: isoDateSchema,
}).strict();

const investigatedFactKinds = [
  "brand",
  "model",
  "parameter",
  "component",
  "mechanism",
  "source_entrypoint",
] as const;

const investigatedFactSchema = z.object({
  id: idSchema,
  kind: z.enum(investigatedFactKinds),
  statement: z.string().min(1).max(2000),
  factReferenceIds: z.array(idSchema).min(1),
}).strict();

const interviewCollectionLaneSchema = z.object({
  id: idSchema,
  sourceAuthorityType: z.enum(sourceAuthorityTypes),
  accessMode: z.enum(collectionAccessModes),
  targetKeys: z.array(idSchema).min(1),
  knowledgeLayers: z.array(z.enum(knowledgeLayers)).min(1),
  refreshPolicy: z.enum(["manual", "on_source_change", "daily", "weekly", "monthly"]),
  stopConditions: z.array(z.enum(collectionStopConditions)).min(1),
}).strict();

const sourceAssignmentSchema = z.object({
  collectionLaneId: idSchema,
  factReferenceId: idSchema,
  knowledgeNeedIds: z.array(idSchema).min(1),
  request: sourceCollectionRequestSchema.optional(),
}).strict();

export const categoryResearchBriefContentSchema = z.object({
  category: z.object({
    code: z.string().regex(/^[a-z][a-z0-9_-]+$/),
    label: z.string().min(1).max(120),
    market: z.string().min(2).max(64),
  }).strict(),
  objective: z.string().min(1).max(2000),
  audience: z.string().min(1).max(1000),
  priorityScenarios: z.array(z.string().min(1).max(500)).min(1),
  excludedScope: z.array(z.string().min(1).max(500)),
  knowledgeNeeds: z.array(knowledgeNeedSchema).min(1),
  categoryFramework: z.object({
    attributes: z.array(categoryAttributeSchema).min(1),
    decisionDimensions: z.array(decisionDimensionSchema).min(1),
    competencyQuestions: z.array(z.string().min(1).max(500)).min(1),
  }).strict(),
  targetPopulation: z.object({
    populationLayers: z.array(z.enum([
      "regulatory_registry",
      "official_current_catalog",
      "licensed_market_priority",
    ])).min(1),
    targets: z.array(interviewTargetSchema).min(1),
  }).strict(),
  sourcePolicy: z.object({
    authorityTypes: z.array(z.enum(sourceAuthorityTypes)).min(1),
    accessModes: z.array(z.enum(collectionAccessModes)).min(1),
    freshnessPolicy: z.enum(["manual", "on_source_change", "daily", "weekly", "monthly"]),
    stopConditions: z.array(z.enum(collectionStopConditions)).min(1),
  }).strict(),
  collectionLanes: z.array(interviewCollectionLaneSchema).min(1),
  // TRADE-OFF：历史任务书没有该关系时保持可读，但确认新任务书与 Planner 执行均失败关闭，禁止猜测证明范围。
  sourceAssignments: z.array(sourceAssignmentSchema).default([]),
  acceptanceCriteria: z.array(z.string().min(1).max(1000)).min(1),
  decisionIds: z.array(idSchema).min(1),
  factReferences: z.array(factReferenceSchema).min(1),
  investigatedFacts: z.array(investigatedFactSchema).min(investigatedFactKinds.length),
}).strict().superRefine((brief, context) => {
  const referenceIds = new Set(brief.factReferences.map(({ id }) => id));
  for (const kind of investigatedFactKinds) {
    if (!brief.investigatedFacts.some((fact) => fact.kind === kind)) {
      context.addIssue({
        code: "custom",
        path: ["investigatedFacts"],
        message: `任务书缺少 ${kind} 前置调查事实`,
      });
    }
  }
  for (const [index, fact] of brief.investigatedFacts.entries()) {
    for (const referenceId of fact.factReferenceIds) {
      if (!referenceIds.has(referenceId)) {
        context.addIssue({
          code: "custom",
          path: ["investigatedFacts", index, "factReferenceIds"],
          message: `调查事实引用了不存在的来源：${referenceId}`,
        });
      }
    }
  }
  validateSourceAssignments(brief, context);
});

function validateSourceAssignments(
  brief: z.infer<typeof categoryResearchBriefContentSchema> extends infer T ? T : never,
  context: z.RefinementCtx,
) {
  const lanes = new Map(brief.collectionLanes.map((lane) => [lane.id, lane]));
  const references = new Map(brief.factReferences.map((reference) => [reference.id, reference]));
  const needs = new Map(brief.knowledgeNeeds.map((need) => [need.id, need]));
  const keys = new Set<string>();
  for (const [index, assignment] of brief.sourceAssignments.entries()) {
    const key = `${assignment.collectionLaneId}\u0000${assignment.factReferenceId}`;
    if (keys.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["sourceAssignments", index],
        message: "同一路线与来源只能有一条知识需求分配",
      });
    }
    keys.add(key);
    const lane = lanes.get(assignment.collectionLaneId);
    const reference = references.get(assignment.factReferenceId);
    if (!lane || !reference) {
      context.addIssue({
        code: "custom",
        path: ["sourceAssignments", index],
        message: "来源分配引用了不存在的路线或来源",
      });
      continue;
    }
    if (lane.sourceAuthorityType !== reference.sourceAuthorityType) {
      context.addIssue({
        code: "custom",
        path: ["sourceAssignments", index],
        message: "来源分配的权威类型与路线不一致",
      });
    }
    for (const needId of assignment.knowledgeNeedIds) {
      const need = needs.get(needId);
      if (!need || !need.knowledgeLayers.some((layer) => lane.knowledgeLayers.includes(layer))) {
        context.addIssue({
          code: "custom",
          path: ["sourceAssignments", index, "knowledgeNeedIds"],
          message: `来源分配引用了不存在或不属于该路线的知识需求：${needId}`,
        });
      }
    }
  }
}

export const categoryResearchBriefVersionSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  version: revisionSchema,
  status: z.enum(["draft", "confirmed", "superseded"]),
  contentHash: hashSchema,
  content: categoryResearchBriefContentSchema,
  projectId: idSchema.optional(),
  createdAt: isoDateSchema,
  confirmedAt: isoDateSchema.optional(),
}).strict().superRefine((brief, context) => {
  if (brief.status === "confirmed" && !brief.confirmedAt) {
    context.addIssue({ code: "custom", path: ["confirmedAt"], message: "已确认任务书必须记录确认时间" });
  }
});

export const categoryInterviewViewSchema = z.object({
  session: interviewSessionSchema,
  messages: z.array(normalizedInterviewMessageSchema),
  decisions: z.array(interviewDecisionSchema),
  unresolvedItems: z.array(interviewUnresolvedItemSchema),
  briefs: z.array(categoryResearchBriefVersionSchema),
}).strict();

export const interviewTurnRequestSchema = z.discriminatedUnion("trigger", [
  z.object({
    trigger: z.literal("user_message"),
    expectedRevision: revisionSchema,
    text: z.string().min(1).max(20_000),
    retryMessageId: idSchema.optional(),
  }).strict(),
  z.object({
    trigger: z.literal("decision_confirmed"),
    expectedRevision: revisionSchema,
    decisionId: idSchema,
  }).strict(),
]);

const ownerQuestionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
  text: z.string().min(1).max(1000),
  recommendation: z.string().min(1).max(2000),
  rationale: z.string().min(1).max(4000),
}).strict();

export const categoryInterviewRuntimeOutputSchema = z.object({
  assistantText: z.string().min(1).max(40_000),
  question: ownerQuestionSchema.nullable().optional().transform((value) => value ?? undefined),
  proposedDecision: z.object({
    key: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
    question: z.string().min(1).max(1000),
    selection: z.string().min(1).max(2000),
    rationale: z.string().min(1).max(4000),
  }).strict().nullable().optional().transform((value) => value ?? undefined),
  unresolvedItems: z.array(z.object({
    key: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
    description: z.string().min(1).max(2000),
    owner: z.enum(["system", "user"]),
  }).strict()).nullable().default([]).transform((value) => value ?? []),
  resolvedUnresolvedKeys: z.array(z.string().min(1)).nullable().default([]).transform((value) => value ?? []),
  briefCandidate: categoryResearchBriefContentSchema.nullable().optional().transform((value) => value ?? undefined),
}).strict();

const eventBase = {
  sessionId: idSchema,
  turnId: idSchema,
};

export const interviewTimelineEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("turn.started"), ...eventBase }).strict(),
  z.object({ type: z.literal("assistant.delta"), ...eventBase, delta: z.string().min(1) }).strict(),
  z.object({
    type: z.literal("assistant.message.completed"),
    ...eventBase,
    message: normalizedInterviewMessageSchema,
  }).strict(),
  z.object({
    type: z.literal("interview.state.changed"),
    ...eventBase,
    revision: revisionSchema,
    phase: z.enum(interviewPhases),
    turnState: z.enum(interviewTurnStates),
  }).strict(),
  z.object({ type: z.literal("turn.completed"), ...eventBase }).strict(),
  z.object({ type: z.literal("turn.interrupted"), ...eventBase }).strict(),
  z.object({ type: z.literal("turn.failed"), ...eventBase, error: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal("stream.failed"), sessionId: idSchema, error: z.string().min(1).max(2000) }).strict(),
]);

export type InterviewSession = z.infer<typeof interviewSessionSchema>;
export type NormalizedInterviewMessage = z.infer<typeof normalizedInterviewMessageSchema>;
export type InterviewDecision = z.infer<typeof interviewDecisionSchema>;
export type InterviewUnresolvedItem = z.infer<typeof interviewUnresolvedItemSchema>;
export type CategoryResearchBriefContent = z.infer<typeof categoryResearchBriefContentSchema>;
export type CategoryResearchBriefVersion = z.infer<typeof categoryResearchBriefVersionSchema>;
export type CategoryInterviewView = z.infer<typeof categoryInterviewViewSchema>;
export type InterviewTurnRequest = z.infer<typeof interviewTurnRequestSchema>;
export type CategoryInterviewRuntimeOutput = z.infer<typeof categoryInterviewRuntimeOutputSchema>;
export type InterviewTimelineEvent = z.infer<typeof interviewTimelineEventSchema>;
