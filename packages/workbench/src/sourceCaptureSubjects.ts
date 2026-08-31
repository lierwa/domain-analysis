import { randomUUID } from "node:crypto";

import type { WorkbenchDb } from "@domain-analysis/db";
import { sourceCaptureSubjects, sourceCollectionRuns } from "@domain-analysis/db";
import {
  sourceCaptureSubjectInputSchema,
  type SourceCaptureSubjectInput,
} from "@domain-analysis/shared";
import { and, eq } from "drizzle-orm";

import { SourceDatasetError } from "./sourceDatasetError";

type WorkbenchTransaction = Parameters<Parameters<WorkbenchDb["transaction"]>[0]>[0];
type SourceCollectionRunRow = typeof sourceCollectionRuns.$inferSelect;
type CaptureSubjectIdentity = {
  kind: "brand" | "product_model";
  sourceEntityId: string;
  displayName: string;
};

export async function findCaptureSubjectId(
  transaction: WorkbenchTransaction,
  run: SourceCollectionRunRow,
  input: SourceCaptureSubjectInput,
) {
  const subject = sourceCaptureSubjectInputSchema.parse(input);
  if (!run.executionBatchId || !run.sourceCollectionPlanSourceKey) return undefined;
  const parentSubjectId = subject.kind === "product_model"
    ? await findSubjectRow(transaction, run, subject.parent, undefined) : undefined;
  return findSubjectRow(transaction, run, subject, parentSubjectId);
}

export async function ensureCaptureSubjectId(
  transaction: WorkbenchTransaction,
  run: SourceCollectionRunRow,
  input: SourceCaptureSubjectInput,
) {
  const subject = sourceCaptureSubjectInputSchema.parse(input);
  if (!run.executionBatchId || !run.sourceCollectionPlanSourceKey) {
    throw new SourceDatasetError("invalid_state", "Capture Subject 只能写入已绑定 Batch 和计划来源的运行");
  }
  const parentSubjectId = subject.kind === "product_model"
    ? await ensureSubjectRow(transaction, run, subject.parent, undefined)
    : undefined;
  return ensureSubjectRow(transaction, run, subject, parentSubjectId);
}

async function findSubjectRow(
  transaction: WorkbenchTransaction,
  run: SourceCollectionRunRow,
  subject: CaptureSubjectIdentity,
  parentSubjectId: string | undefined,
) {
  const row = await transaction.query.sourceCaptureSubjects.findFirst({ where: and(
    eq(sourceCaptureSubjects.executionBatchId, run.executionBatchId!),
    eq(sourceCaptureSubjects.sourceKey, run.sourceCollectionPlanSourceKey!),
    eq(sourceCaptureSubjects.kind, subject.kind),
    eq(sourceCaptureSubjects.sourceEntityId, subject.sourceEntityId),
  ) });
  return row && row.displayName === subject.displayName
    && (row.parentSubjectId ?? undefined) === parentSubjectId ? row.id : undefined;
}

async function ensureSubjectRow(
  transaction: WorkbenchTransaction,
  run: SourceCollectionRunRow,
  subject: CaptureSubjectIdentity,
  parentSubjectId: string | undefined,
) {
  const proposedId = `source-subject-${randomUUID()}`;
  await transaction.insert(sourceCaptureSubjects).values({
    id: proposedId,
    executionBatchId: run.executionBatchId!,
    sourceKey: run.sourceCollectionPlanSourceKey!,
    kind: subject.kind,
    sourceEntityId: subject.sourceEntityId,
    displayName: subject.displayName,
    parentSubjectId,
  }).onConflictDoNothing();
  const row = await transaction.query.sourceCaptureSubjects.findFirst({ where: and(
    eq(sourceCaptureSubjects.executionBatchId, run.executionBatchId!),
    eq(sourceCaptureSubjects.sourceKey, run.sourceCollectionPlanSourceKey!),
    eq(sourceCaptureSubjects.kind, subject.kind),
    eq(sourceCaptureSubjects.sourceEntityId, subject.sourceEntityId),
  ) });
  if (!row || row.displayName !== subject.displayName
    || (row.parentSubjectId ?? undefined) !== parentSubjectId) {
    throw new SourceDatasetError("invalid_state", `Capture Subject 定义冲突：${subject.kind}:${subject.sourceEntityId}`);
  }
  return row.id;
}
