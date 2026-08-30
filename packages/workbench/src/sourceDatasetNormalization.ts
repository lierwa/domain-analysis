import {
  sourceAssets,
  sourceCollectionBatches,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceResourceReferences,
  sourceSnapshots,
} from "@domain-analysis/db";
import {
  rawSourceObservationSchema,
  rawSourcePayloadSchema,
  sourceAssetSchema,
  sourceCollectionBatchSchema,
  sourceCollectionRunSchema,
  sourceCollectionTargetRunSchema,
  sourceResourceReferenceSchema,
  sourceSnapshotLineageSchema,
  sourceSnapshotSchema,
  type RawSourceObservation,
} from "@domain-analysis/shared";

export function normalizeRun(row: typeof sourceCollectionRuns.$inferSelect) {
  return sourceCollectionRunSchema.parse({ ...row,
    executionCommandId: row.executionCommandId ?? undefined,
    executionBatchId: row.executionBatchId ?? undefined,
    resumedFromRunId: row.resumedFromRunId ?? undefined,
    sourceCollectionPlanId: row.sourceCollectionPlanId ?? undefined,
    sourceCollectionPlanSourceKey: row.sourceCollectionPlanSourceKey ?? undefined,
    sourceCollectionPlanVersion: row.sourceCollectionPlanVersion ?? undefined,
    providerVersion: row.providerVersion ?? undefined, requestBudget: row.requestBudget ?? undefined,
    startedAt: normalizeTimestamp(row.startedAt),
    finishedAt: row.finishedAt ? normalizeTimestamp(row.finishedAt) : undefined,
    terminationReason: row.terminationReason ?? undefined,
    failureCategory: row.failureCategory ?? undefined });
}

export function normalizeBatch(row: typeof sourceCollectionBatches.$inferSelect) {
  return sourceCollectionBatchSchema.parse({ ...row,
    commandId: row.commandId ?? undefined,
    startedAt: normalizeTimestamp(row.startedAt),
    finishedAt: row.finishedAt ? normalizeTimestamp(row.finishedAt) : undefined,
    terminationReason: row.terminationReason ?? undefined });
}

export function normalizeTarget(row: typeof sourceCollectionTargetRuns.$inferSelect) {
  return sourceCollectionTargetRunSchema.parse({ ...row,
    observedUnitCount: row.observedUnitCount ?? undefined,
    startedAt: row.startedAt ? normalizeTimestamp(row.startedAt) : undefined,
    finishedAt: row.finishedAt ? normalizeTimestamp(row.finishedAt) : undefined,
    terminationReason: row.terminationReason ?? undefined });
}

export function normalizeSnapshot(row: typeof sourceSnapshots.$inferSelect) {
  const rawObservation = row.observation as Record<string, unknown>;
  const legacyHttp = rawObservation.httpValidation as { status?: number } | undefined;
  const observation = rawSourceObservationSchema.parse({ requestedUrl: rawObservation.requestedUrl,
    finalUrl: rawObservation.finalUrl ?? undefined, observedAt: rawObservation.observedAt,
    state: normalizeState(rawObservation.state), httpStatus: rawObservation.httpStatus ?? legacyHttp?.status,
    responseHeaders: rawObservation.responseHeaders ?? {},
    contentAssessment: rawObservation.contentAssessment ?? undefined,
    error: rawObservation.error ?? rawObservation.failureDetail ?? undefined });
  const parsedPayload = rawSourcePayloadSchema.safeParse(row.payload);
  const parsedLineage = sourceSnapshotLineageSchema.safeParse(row.lineage);
  return sourceSnapshotSchema.parse({ id: row.id, runId: row.runId, targetKey: row.targetKey ?? undefined,
    objectId: row.objectId, idempotencyKey: row.idempotencyKey,
    lineage: parsedLineage.success ? parsedLineage.data : undefined, observation,
    payload: row.payload == null ? undefined : parsedPayload.success ? parsedPayload.data
      : { kind: "legacy_structured_json", value: row.payload }, contentHash: row.contentHash,
    createdAt: normalizeTimestamp(row.createdAt) });
}

export function normalizeAsset(row: typeof sourceAssets.$inferSelect) {
  return sourceAssetSchema.parse({ ...row, createdAt: normalizeTimestamp(row.createdAt) });
}

export function normalizeResourceReference(row: typeof sourceResourceReferences.$inferSelect) {
  return sourceResourceReferenceSchema.parse({ ...row,
    observedValue: row.observedValue ?? undefined, locator: row.locator ?? undefined,
    createdAt: normalizeTimestamp(row.createdAt) });
}

export function sourceSnapshotOutcome(observation: RawSourceObservation) {
  if (observation.state !== "accessible" || observation.contentAssessment?.status === "rejected") {
    return "failed" as const;
  }
  return observation.contentAssessment?.status === "supporting" ? "supporting" as const : "accepted" as const;
}

function normalizeState(value: unknown) {
  const states = ["accessible", "login_required", "verification_required", "access_denied", "not_found", "source_error"] as const;
  return states.find((state) => state === String(value)) ?? "source_error";
}

export function normalizeTimestamp(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
