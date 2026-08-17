import {
  knowledgeReviewDecisionDraftSchema,
  knowledgeReviewDecisionSchema,
  publishableKnowledgeStateSchema,
  reviewedKnowledgeEntrySchema,
  type KnowledgeClaimCandidate,
  type KnowledgeConflict,
  type KnowledgeFactoryBatchView,
  type KnowledgeReviewDecision,
  type KnowledgeReviewDecisionDraft,
  type KnowledgeUnknown,
  type PublishableKnowledgeState,
  type ReviewedKnowledgeEntry,
} from "@domain-analysis/shared";
import {
  knowledgeReviewDecisions,
  type ProductKnowledgeDb,
} from "@domain-analysis/db";
import { asc, eq } from "drizzle-orm";

import { contentHash } from "./contentHash";
import type { EvidenceModule } from "./evidenceModule";
import type { KnowledgeFactoryModule } from "./knowledgeFactoryModule";

export interface KnowledgeReviewModule {
  decide(input: KnowledgeReviewDecisionDraft): Promise<KnowledgeReviewDecision>;
  listBatch(batchId: string): Promise<KnowledgeReviewDecision[]>;
  listReviewed(projectId: string): Promise<ReviewedKnowledgeEntry[]>;
  listPublishable(projectId: string): Promise<PublishableKnowledgeState[]>;
}

export interface KnowledgeReviewModuleOptions {
  now?: () => Date;
}

export class KnowledgeReviewError extends Error {
  constructor(
    readonly code: "batch_not_found" | "target_not_found" | "target_already_decided" | "grouping_mismatch" | "publication_not_allowed",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeReviewError";
  }
}

export function createKnowledgeReviewModule(
  db: ProductKnowledgeDb,
  factory: Pick<KnowledgeFactoryModule, "get" | "listProject">,
  evidence: Pick<EvidenceModule, "read" | "getObservation">,
  options: KnowledgeReviewModuleOptions = {},
): KnowledgeReviewModule {
  const now = options.now ?? (() => new Date());
  return {
    decide: (input) => decide(db, factory, evidence, input, now),
    listBatch: (batchId) => listBatch(db, batchId),
    listReviewed: (projectId) => listReviewed(db, factory, projectId),
    listPublishable: (projectId) => listPublishable(db, factory, projectId),
  };
}

async function decide(
  db: ProductKnowledgeDb,
  factory: Pick<KnowledgeFactoryModule, "get">,
  evidence: Pick<EvidenceModule, "read" | "getObservation">,
  rawInput: KnowledgeReviewDecisionDraft,
  now: () => Date,
) {
  const input = knowledgeReviewDecisionDraftSchema.parse(rawInput);
  const batch = await factory.get(input.batchId);
  if (!batch) throw new KnowledgeReviewError("batch_not_found", `知识批次不存在：${input.batchId}`);
  const projectId = batch.batch.projectId;
  const id = `knowledge-review-${contentHash({ projectId, input }).slice(0, 32)}`;
  const existing = await db.query.knowledgeReviewDecisions.findFirst({
    where: eq(knowledgeReviewDecisions.id, id),
  });
  if (existing) return knowledgeReviewDecisionSchema.parse(existing.decision);

  const targets = selectTargets(batch, input);
  validateGrouping(batch, targets, input);
  await validateEvidenceGrouping(targets, input, evidence);
  await validatePublicationPermission(targets, input, evidence);
  await requireUndecided(db, batch.batch.id, input.selection.targetIds);
  const decision = knowledgeReviewDecisionSchema.parse({
    ...input,
    id,
    projectId,
    decidedAt: now().toISOString(),
  });
  await db.insert(knowledgeReviewDecisions).values({
    id: decision.id,
    batchId: decision.batchId,
    projectId: decision.projectId,
    action: decision.selection.action,
    targetIds: decision.selection.targetIds,
    decision,
    decidedAt: decision.decidedAt,
  });
  return decision;
}

async function validatePublicationPermission(
  targets: ReviewTarget[],
  input: KnowledgeReviewDecisionDraft,
  evidence: Pick<EvidenceModule, "read" | "getObservation">,
) {
  if (input.selection.action === "reject_candidates"
    || input.selection.action === "acknowledge_unknowns") return;
  const evidenceIds = input.selection.action === "resolve_conflict"
    ? (targets[0] as KnowledgeConflict).alternatives[input.selection.selectedAlternativeIndex]!.evidenceIds
    : [...new Set(targets.flatMap(targetEvidenceIds))];
  for (const evidenceId of evidenceIds) {
    const result = await evidence.read(evidenceId);
    if (!result) publicationDenied(`审核引用了不存在的证据：${evidenceId}`);
    const observation = await evidence.getObservation(result.item.observationId);
    if (observation?.usagePermission?.derivedKnowledgePublication !== "allowed") {
      publicationDenied(`证据 ${evidenceId} 的来源未明确允许发布派生知识`);
    }
  }
}

type ReviewTarget = KnowledgeClaimCandidate | KnowledgeConflict | KnowledgeUnknown;

function selectTargets(batch: KnowledgeFactoryBatchView, input: KnowledgeReviewDecisionDraft) {
  const collection = input.selection.action === "accept_candidates"
    || input.selection.action === "reject_candidates"
    ? batch.candidates
    : input.selection.action === "resolve_conflict"
      || input.selection.action === "acknowledge_conflicts"
      ? batch.conflicts
      : batch.unknowns;
  const byId = new Map(collection.map((target) => [target.id, target]));
  return input.selection.targetIds.map((id) => {
    const target = byId.get(id);
    if (!target) throw new KnowledgeReviewError("target_not_found", `审核目标不存在或类型不符：${id}`);
    return target;
  });
}

function validateGrouping(
  batch: KnowledgeFactoryBatchView,
  targets: ReviewTarget[],
  input: KnowledgeReviewDecisionDraft,
) {
  if (input.grouping.categoryDefinitionVersionId !== batch.batch.categoryDefinitionVersionId) {
    mismatch("审核分组没有绑定当前批次品类定义");
  }
  for (const target of targets) {
    if (input.grouping.knowledgeNeedId
      && target.knowledgeNeedId !== input.grouping.knowledgeNeedId) {
      mismatch("审核目标不属于分组中的知识需求");
    }
    if (input.grouping.reasonCode
      && (!("reasonCode" in target) || target.reasonCode !== input.grouping.reasonCode)) {
      mismatch("审核目标不属于分组中的异常原因");
    }
  }
  if (input.selection.action === "resolve_conflict") {
    const conflict = targets[0] as KnowledgeConflict;
    if (!conflict.alternatives[input.selection.selectedAlternativeIndex]) {
      mismatch("冲突审核选择了不存在的候选值");
    }
  }
}

async function validateEvidenceGrouping(
  targets: ReviewTarget[],
  input: KnowledgeReviewDecisionDraft,
  evidence: Pick<EvidenceModule, "read" | "getObservation">,
) {
  if (!input.grouping.evidenceKind && !input.grouping.sourceAuthorityType) return;
  const evidenceIds = [...new Set(targets.flatMap(targetEvidenceIds))];
  if (evidenceIds.length === 0) mismatch("无证据目标不能按证据类型或来源批量审核");
  for (const evidenceId of evidenceIds) {
    const result = await evidence.read(evidenceId);
    if (!result) mismatch(`审核引用了不存在的证据：${evidenceId}`);
    if (input.grouping.evidenceKind && result.item.kind !== input.grouping.evidenceKind) {
      mismatch("审核目标证据类型与分组不一致");
    }
    if (input.grouping.sourceAuthorityType) {
      const observation = await evidence.getObservation(result.item.observationId);
      if (!observation || observation.sourceAuthorityType !== input.grouping.sourceAuthorityType) {
        mismatch("审核目标来源类型与分组不一致");
      }
    }
  }
}

function targetEvidenceIds(target: ReviewTarget) {
  if ("evidenceIds" in target) return target.evidenceIds;
  if ("alternatives" in target) return target.alternatives.flatMap(({ evidenceIds }) => evidenceIds);
  return target.examinedEvidenceIds;
}

async function requireUndecided(db: ProductKnowledgeDb, batchId: string, targetIds: string[]) {
  const decisions = await listBatch(db, batchId);
  const decided = new Set(decisions.flatMap(({ selection }) => selection.targetIds));
  const duplicate = targetIds.find((id) => decided.has(id));
  if (duplicate) {
    throw new KnowledgeReviewError("target_already_decided", `审核目标已有不可变决定：${duplicate}`);
  }
}

async function listBatch(db: ProductKnowledgeDb, batchId: string) {
  const rows = await db.select().from(knowledgeReviewDecisions)
    .where(eq(knowledgeReviewDecisions.batchId, batchId))
    .orderBy(asc(knowledgeReviewDecisions.decidedAt), asc(knowledgeReviewDecisions.id));
  return rows.map(({ decision }) => knowledgeReviewDecisionSchema.parse(decision));
}

async function listReviewed(
  db: ProductKnowledgeDb,
  factory: Pick<KnowledgeFactoryModule, "listProject">,
  projectId: string,
) {
  const batches = await factory.listProject(projectId);
  const entries = await Promise.all(batches.map(async (batch) => {
    const decisions = await listBatch(db, batch.batch.id);
    return decisions.flatMap((decision) => reviewedEntries(batch, decision));
  }));
  return entries.flat().sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt)
    || a.sourceTargetId.localeCompare(b.sourceTargetId));
}

async function listPublishable(
  db: ProductKnowledgeDb,
  factory: Pick<KnowledgeFactoryModule, "listProject">,
  projectId: string,
) {
  const batches = await factory.listProject(projectId);
  const states = await Promise.all(batches.map(async (batch) => {
    const decisions = await listBatch(db, batch.batch.id);
    return decisions.flatMap((decision) => publishableStates(batch, decision));
  }));
  return states.flat().sort((a, b) => stateConfirmedAt(a).localeCompare(stateConfirmedAt(b))
    || stateTargetId(a).localeCompare(stateTargetId(b)));
}

function publishableStates(
  batch: KnowledgeFactoryBatchView,
  decision: KnowledgeReviewDecision,
): PublishableKnowledgeState[] {
  const facts = reviewedEntries(batch, decision);
  if (facts.length > 0) {
    return facts.map((entry) => publishableKnowledgeStateSchema.parse({ kind: "fact", entry }));
  }
  if (decision.selection.action === "acknowledge_conflicts") {
    const byId = new Map(batch.conflicts.map((conflict) => [conflict.id, conflict]));
    return decision.selection.targetIds.map((id) => {
      const conflict = byId.get(id);
      if (!conflict) throw new KnowledgeReviewError("target_not_found", `已审核冲突不存在：${id}`);
      return publishableKnowledgeStateSchema.parse({
        kind: "conflict",
        sourceTargetId: conflict.id,
        decisionId: decision.id,
        projectId: decision.projectId,
        categoryDefinitionVersionId: conflict.categoryDefinitionVersionId,
        knowledgeNeedId: conflict.knowledgeNeedId,
        subject: conflict.subject,
        knowledgeLayer: conflict.knowledgeLayer,
        predicate: conflict.predicate,
        alternatives: conflict.alternatives,
        reasonCode: conflict.reasonCode,
        confirmedAt: decision.decidedAt,
      });
    });
  }
  if (decision.selection.action === "acknowledge_unknowns") {
    const byId = new Map(batch.unknowns.map((unknown) => [unknown.id, unknown]));
    return decision.selection.targetIds.map((id) => {
      const unknown = byId.get(id);
      if (!unknown) throw new KnowledgeReviewError("target_not_found", `已审核未知项不存在：${id}`);
      return publishableKnowledgeStateSchema.parse({
        kind: "unknown",
        sourceTargetId: unknown.id,
        decisionId: decision.id,
        projectId: decision.projectId,
        categoryDefinitionVersionId: unknown.categoryDefinitionVersionId,
        knowledgeNeedId: unknown.knowledgeNeedId,
        subject: unknown.subject,
        question: unknown.question,
        reasonCode: unknown.reasonCode,
        evidenceRequestIds: unknown.evidenceRequestIds,
        evidenceIds: unknown.examinedEvidenceIds,
        confirmedAt: decision.decidedAt,
      });
    });
  }
  return [];
}

function stateConfirmedAt(state: PublishableKnowledgeState) {
  return state.kind === "fact" ? state.entry.confirmedAt : state.confirmedAt;
}

function stateTargetId(state: PublishableKnowledgeState) {
  return state.kind === "fact" ? state.entry.sourceTargetId : state.sourceTargetId;
}

function reviewedEntries(batch: KnowledgeFactoryBatchView, decision: KnowledgeReviewDecision) {
  if (decision.selection.action === "accept_candidates") {
    const byId = new Map(batch.candidates.map((candidate) => [candidate.id, candidate]));
    return decision.selection.targetIds.map((id) => {
      const candidate = byId.get(id);
      if (!candidate) throw new KnowledgeReviewError("target_not_found", `已审核候选不存在：${id}`);
      return reviewedKnowledgeEntrySchema.parse({
        sourceTargetKind: "candidate",
        sourceTargetId: id,
        decisionId: decision.id,
        projectId: decision.projectId,
        categoryDefinitionVersionId: candidate.categoryDefinitionVersionId,
        knowledgeNeedId: candidate.knowledgeNeedId,
        subject: candidate.subject,
        knowledgeLayer: candidate.knowledgeLayer,
        predicate: candidate.predicate,
        value: candidate.value,
        evidenceIds: candidate.evidenceIds,
        limitations: candidate.limitations,
        confirmedAt: decision.decidedAt,
      });
    });
  }
  if (decision.selection.action === "resolve_conflict") {
    const conflict = batch.conflicts.find(({ id }) => id === decision.selection.targetIds[0]);
    const alternative = conflict?.alternatives[decision.selection.selectedAlternativeIndex];
    if (!conflict || !alternative) {
      throw new KnowledgeReviewError("target_not_found", "已审核冲突或选择值不存在");
    }
    return [reviewedKnowledgeEntrySchema.parse({
      sourceTargetKind: "conflict",
      sourceTargetId: conflict.id,
      decisionId: decision.id,
      projectId: decision.projectId,
      categoryDefinitionVersionId: conflict.categoryDefinitionVersionId,
      knowledgeNeedId: conflict.knowledgeNeedId,
      subject: conflict.subject,
      knowledgeLayer: conflict.knowledgeLayer,
      predicate: conflict.predicate,
      value: alternative.value,
      evidenceIds: alternative.evidenceIds,
      limitations: ["多个来源值曾冲突；当前值由人工审核选择，其他值保留在冲突记录中。"],
      confirmedAt: decision.decidedAt,
    })];
  }
  return [];
}

function mismatch(message: string): never {
  throw new KnowledgeReviewError("grouping_mismatch", message);
}

function publicationDenied(message: string): never {
  throw new KnowledgeReviewError("publication_not_allowed", message);
}
