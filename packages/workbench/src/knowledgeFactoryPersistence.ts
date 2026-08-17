import { knowledgeFactoryBatchViewSchema, type KnowledgeFactoryBatchView } from "@domain-analysis/shared";
import {
  knowledgeCandidates,
  knowledgeConflicts,
  knowledgeFactoryBatches,
  knowledgeUnknowns,
  type ProductKnowledgeDb,
} from "@domain-analysis/db";
import { asc, desc, eq } from "drizzle-orm";

export async function persistKnowledgeFactoryOutput(
  db: ProductKnowledgeDb,
  view: KnowledgeFactoryBatchView,
) {
  await db.transaction(async (transaction) => {
    await transaction.insert(knowledgeFactoryBatches).values({
      id: view.batch.id,
      projectId: view.batch.projectId,
      categoryDefinitionVersionId: view.batch.categoryDefinitionVersionId,
      recipeVersion: view.batch.recipeVersion,
      inputHash: view.batch.inputHash,
      status: view.batch.status,
      batch: view.batch,
      createdAt: view.batch.createdAt,
      finishedAt: view.batch.finishedAt,
    });
    if (view.candidates.length > 0) await transaction.insert(knowledgeCandidates).values(
      view.candidates.map((candidate) => ({
        id: candidate.id, batchId: candidate.batchId, projectId: candidate.projectId,
        subjectKey: candidate.subject.key, knowledgeNeedId: candidate.knowledgeNeedId,
        predicate: candidate.predicate, candidate, createdAt: candidate.createdAt,
      })),
    );
    if (view.conflicts.length > 0) await transaction.insert(knowledgeConflicts).values(
      view.conflicts.map((conflict) => ({
        id: conflict.id, batchId: conflict.batchId, projectId: conflict.projectId,
        subjectKey: conflict.subject.key, knowledgeNeedId: conflict.knowledgeNeedId,
        reasonCode: conflict.reasonCode, conflict, createdAt: conflict.createdAt,
      })),
    );
    if (view.unknowns.length > 0) await transaction.insert(knowledgeUnknowns).values(
      view.unknowns.map((unknown) => ({
        id: unknown.id, batchId: unknown.batchId, projectId: unknown.projectId,
        subjectKey: unknown.subject.key, knowledgeNeedId: unknown.knowledgeNeedId,
        reasonCode: unknown.reasonCode, unknown, createdAt: unknown.createdAt,
      })),
    );
  });
}

export async function loadKnowledgeFactoryBatchView(db: ProductKnowledgeDb, batchId: string) {
  const row = await db.query.knowledgeFactoryBatches.findFirst({
    where: eq(knowledgeFactoryBatches.id, batchId),
  });
  if (!row) return null;
  const [candidates, conflicts, unknowns] = await Promise.all([
    db.select().from(knowledgeCandidates).where(eq(knowledgeCandidates.batchId, batchId))
      .orderBy(asc(knowledgeCandidates.createdAt), asc(knowledgeCandidates.id)),
    db.select().from(knowledgeConflicts).where(eq(knowledgeConflicts.batchId, batchId))
      .orderBy(asc(knowledgeConflicts.createdAt), asc(knowledgeConflicts.id)),
    db.select().from(knowledgeUnknowns).where(eq(knowledgeUnknowns.batchId, batchId))
      .orderBy(asc(knowledgeUnknowns.createdAt), asc(knowledgeUnknowns.id)),
  ]);
  return knowledgeFactoryBatchViewSchema.parse({
    batch: row.batch,
    candidates: candidates.map(({ candidate }) => candidate),
    conflicts: conflicts.map(({ conflict }) => conflict),
    unknowns: unknowns.map(({ unknown }) => unknown),
  });
}

export async function requireKnowledgeFactoryBatchView(db: ProductKnowledgeDb, batchId: string) {
  const view = await loadKnowledgeFactoryBatchView(db, batchId);
  if (!view) throw new Error(`知识批次不存在：${batchId}`);
  return view;
}

export async function listProjectKnowledgeBatches(db: ProductKnowledgeDb, projectId: string) {
  const rows = await db.select({ id: knowledgeFactoryBatches.id })
    .from(knowledgeFactoryBatches)
    .where(eq(knowledgeFactoryBatches.projectId, projectId))
    .orderBy(desc(knowledgeFactoryBatches.createdAt), desc(knowledgeFactoryBatches.id));
  return Promise.all(rows.map(({ id }) => requireKnowledgeFactoryBatchView(db, id)));
}
