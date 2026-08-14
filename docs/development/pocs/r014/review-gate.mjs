import { z } from "zod";

import { codexOutputSchema, evidenceRefSchema } from "./candidate-schema.mjs";

const factSchema = z
  .object({
    subjectKey: z.string().min(1),
    propertyKey: z.string().min(1),
    value: z.string().min(1),
    evidence: z.array(evidenceRefSchema).min(1),
  })
  .strict();
const reviewBase = {
  reviewer: z.string().min(1),
  decidedAt: z.string().datetime(),
  reason: z.string().min(1),
};
export const reviewRecordSchema = z.discriminatedUnion("targetType", [
  z.object({
    targetType: z.literal("claim"),
    targetId: z.string().regex(/^C\d{3}$/),
    decision: z.enum(["accept", "reject"]),
    ...reviewBase,
  }).strict(),
  z.object({
    targetType: z.literal("conflict"),
    targetId: z.string().regex(/^X\d{3}$/),
    decision: z.literal("resolve"),
    selectedValue: z.string().min(1),
    ...reviewBase,
  }).strict(),
  z.object({
    targetType: z.literal("unknown"),
    targetId: z.string().regex(/^U\d{3}$/),
    decision: z.literal("acknowledge"),
    ...reviewBase,
  }).strict(),
]);

export function detectExactConflicts(rawFacts) {
  const facts = z.array(factSchema).parse(rawFacts);
  const groups = Map.groupBy(facts, ({ subjectKey, propertyKey }) => `${subjectKey}\n${propertyKey}`);
  const conflicts = [];
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const values = Map.groupBy(group, ({ value }) => value);
    if (values.size < 2) continue;
    const [subjectKey, propertyKey] = key.split("\n");
    conflicts.push({
      conflictId: `X${String(conflicts.length + 1).padStart(3, "0")}`,
      subjectKey,
      propertyKey,
      values: [...values].map(([value, items]) => ({
        value,
        evidence: items.flatMap(({ evidence }) => evidence),
      })),
      status: "review_required",
    });
  }
  return conflicts;
}

export function createPublishManifest(rawCandidates, rawRecords) {
  const candidates = codexOutputSchema.parse(rawCandidates);
  const records = z.array(reviewRecordSchema).parse(rawRecords);
  const decisions = new Map();
  for (const record of records) {
    const key = `${record.targetType}:${record.targetId}`;
    if (decisions.has(key)) throw new Error(`重复审核记录：${key}`);
    decisions.set(key, record);
  }

  const claimDecisions = candidates.claims.map((claim) =>
    requireDecision(decisions, "claim", claim.claimId));
  const conflictDecisions = candidates.conflicts.map((conflict) => {
    const decision = requireDecision(decisions, "conflict", conflict.conflictId);
    if (!conflict.values.some(({ value }) => value === decision.selectedValue)) {
      throw new Error(`冲突审核选择了未知值：${conflict.conflictId}`);
    }
    return decision;
  });
  const unknownDecisions = candidates.unknowns.map((unknown) =>
    requireDecision(decisions, "unknown", unknown.unknownId));

  return {
    schemaVersion: "r014-publish-manifest-v1",
    subject: candidates.subject,
    acceptedClaimIds: claimDecisions.filter(({ decision }) => decision === "accept").map(({ targetId }) => targetId),
    rejectedClaimIds: claimDecisions.filter(({ decision }) => decision === "reject").map(({ targetId }) => targetId),
    resolvedConflictIds: conflictDecisions.map(({ targetId }) => targetId),
    acknowledgedUnknownIds: unknownDecisions.map(({ targetId }) => targetId),
    reviewRecords: records,
  };
}

function requireDecision(decisions, type, id) {
  const decision = decisions.get(`${type}:${id}`);
  if (!decision) throw new Error(`未经审核，禁止发布：${type}:${id}`);
  return decision;
}
