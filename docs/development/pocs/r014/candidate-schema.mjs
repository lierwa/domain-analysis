import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const evidenceRefSchema = z
  .object({
    sourceObjectId: z.string().min(1),
    snapshotSha256: hashSchema,
    locator: z.string().min(1),
  })
  .strict();
const claimSchema = z
  .object({
    claimId: z.string().regex(/^C\d{3}$/),
    knowledgeLayer: z.enum([
      "identity",
      "specification",
      "function",
      "mechanism",
      "usage_condition",
      "tradeoff",
      "comparison_dimension",
      "lifecycle",
    ]),
    propertyKey: z.string().min(1),
    value: z.string().min(1),
    meaning: z.string().min(1),
    evidence: z.array(evidenceRefSchema).min(1),
    limitations: z.array(z.string().min(1)),
    derivation: z.literal("codex"),
    status: z.literal("review_required"),
  })
  .strict();
const conflictValueSchema = z
  .object({ value: z.string().min(1), evidence: z.array(evidenceRefSchema).min(1) })
  .strict();

export const codexOutputSchema = z
  .object({
    schemaVersion: z.literal("r014-codex-candidates-v1"),
    subject: z
      .object({ manufacturer: z.literal("美的"), model: z.literal("MR-457WUSPZE") })
      .strict(),
    claims: z.array(claimSchema).min(1).max(12),
    conflicts: z.array(
      z
        .object({
          propertyKey: z.string().min(1),
          values: z.array(conflictValueSchema).min(2),
          status: z.literal("review_required"),
        })
        .strict(),
    ),
    unknowns: z.array(
      z
        .object({
          question: z.string().min(1),
          reason: z.string().min(1),
          status: z.literal("unknown"),
        })
        .strict(),
    ),
  })
  .strict();

export function assertKnownEvidenceReferences(output, sourceEvidence) {
  const known = new Set(sourceEvidence.map(evidenceKey));
  const refs = [
    ...output.claims.flatMap(({ evidence }) => evidence),
    ...output.conflicts.flatMap(({ values }) => values.flatMap(({ evidence }) => evidence)),
  ];
  for (const reference of refs) {
    if (!known.has(evidenceKey(reference))) {
      throw new Error(`Codex 返回未知证据：${reference.sourceObjectId} ${reference.locator}`);
    }
  }
}

export function buildCodexJsonSchema() {
  // WHY：Codex structured output 只接受顶层定义引用；库的 none 策略展开重复的证据结构。
  return zodToJsonSchema(codexOutputSchema, { target: "openAi", $refStrategy: "none" });
}

function evidenceKey({ sourceObjectId, snapshotSha256, locator }) {
  return `${sourceObjectId}\n${snapshotSha256}\n${locator}`;
}
