import { knowledgeDecisions, knowledgeRuns } from "@domain-analysis/db";
import { knowledgeDecisionSchema, knowledgeReviewRequestSchema,
  type KnowledgeReviewRequest } from "@domain-analysis/shared";
import { eq } from "drizzle-orm";
import { candidateIndex } from "./admission";
import { createId, KnowledgeProcessingError, lockRun, readRunContent,
  timestamp, type KnowledgeContext } from "./storage";

export async function recordReview(context: KnowledgeContext, packId: string, runId: string, value: KnowledgeReviewRequest) {
  const input = knowledgeReviewRequestSchema.parse(value);
  return context.db.transaction(async tx => {
    const run = await lockRun(tx, packId, runId, input.expectedRevision);
    assertReviewable(run.status);
    const { items } = await readRunContent(tx, runId);
    const index = candidateIndex(items);
    if ([...input.candidateIds, ...input.dependsOn].some(id => !index.has(id)) || new Set(input.candidateIds).size !== input.candidateIds.length) {
      throw new KnowledgeProcessingError("invalid_input", "审核内容或关联内容不属于本次加工");
    }
    const { expectedRevision: _, ...fields } = input;
    const decision = knowledgeDecisionSchema.parse({ ...fields, id: createId("decision"), runId,
      revision: run.reviewRevision + 1, createdAt: timestamp(), contentHashes: Object.fromEntries(
        input.candidateIds.map(id => [id, index.get(id)!.candidate.contentHash])) });
    await tx.insert(knowledgeDecisions).values({ id: decision.id, runId, revision: decision.revision, value: decision });
    await tx.update(knowledgeRuns).set({ reviewRevision: decision.revision }).where(eq(knowledgeRuns.id, runId));
    return decision;
  });
}

export function assertReviewable(status: string) {
  if (!["completed", "partial", "stopped", "failed"].includes(status)) {
    throw new KnowledgeProcessingError("conflict", "加工结束后可审核内容");
  }
}
