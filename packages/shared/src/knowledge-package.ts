import { z } from "zod";

import { evidenceKinds, evidenceLocatorSchema } from "./evidence";
import { publishableKnowledgeStateSchema } from "./knowledge-factory";
import { sourceAuthorityTypes } from "./product-knowledge";

const idSchema = z.string().min(1).max(240);
const isoDateSchema = z.string().datetime({ offset: true });
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);
const sha256IntegritySchema = z.string().regex(/^sha256-[A-Za-z0-9+/]{43}=$/);

export const knowledgePackageSchemaVersion = "knowledge-package-v1" as const;

export const knowledgePackageEvidenceSchema = z.object({
  id: idSchema,
  kind: z.enum(evidenceKinds),
  mediaType: z.string().min(1).max(200),
  sourceIdentity: idSchema,
  sourceAuthorityType: z.enum(sourceAuthorityTypes),
  sourceUrl: z.string().url(),
  locator: evidenceLocatorSchema,
  contentIntegrity: sha256IntegritySchema,
  capturedAt: isoDateSchema,
  redistributionAllowed: z.boolean(),
  contentEncoding: z.enum(["utf8", "base64"]).optional(),
  content: z.string().min(1).optional(),
  permissionBasis: z.string().min(1).max(2000),
  permissionBasisUrl: z.string().url().optional(),
}).strict().superRefine((evidence, context) => {
  if (evidence.redistributionAllowed !== Boolean(evidence.content)) {
    context.addIssue({
      code: "custom",
      path: ["content"],
      message: "只有允许来源内容再分发时，知识包才携带证据内容",
    });
  }
  if (Boolean(evidence.content) !== Boolean(evidence.contentEncoding)) {
    context.addIssue({
      code: "custom",
      path: ["contentEncoding"],
      message: "证据内容与编码必须同时出现",
    });
  }
});

export const knowledgePackageBuildInputSchema = z.object({
  projectId: idSchema,
  categoryDefinitionVersionId: idSchema,
  createdAt: isoDateSchema,
  states: z.array(publishableKnowledgeStateSchema).min(1),
  evidence: z.array(knowledgePackageEvidenceSchema),
}).strict().superRefine((input, context) => {
  const stateProjects = input.states.map((state) => state.kind === "fact"
    ? state.entry.projectId
    : state.projectId);
  if (stateProjects.some((projectId) => projectId !== input.projectId)) {
    context.addIssue({ code: "custom", path: ["states"], message: "知识状态必须属于同一项目" });
  }
  const evidenceIds = new Set(input.evidence.map(({ id }) => id));
  for (const [index, state] of input.states.entries()) {
    for (const evidenceId of stateEvidenceIds(state)) {
      if (!evidenceIds.has(evidenceId)) {
        context.addIssue({
          code: "custom",
          path: ["states", index],
          message: `知识状态引用了未装包证据：${evidenceId}`,
        });
      }
    }
  }
});

export const knowledgePackageManifestSchema = z.object({
  schemaVersion: z.literal(knowledgePackageSchemaVersion),
  packageId: idSchema,
  versionHash: sha256HexSchema,
  projectId: idSchema,
  categoryDefinitionVersionId: idSchema,
  createdAt: isoDateSchema,
  stateCount: z.number().int().positive(),
  evidenceCount: z.number().int().nonnegative(),
}).strict();

export const knowledgePackageDescriptorSchema = knowledgePackageManifestSchema.extend({
  filePath: z.string().min(1),
  databaseSha256: sha256HexSchema,
  bytes: z.number().int().positive(),
}).strict();

export const activeKnowledgePackagePointerSchema = z.object({
  schemaVersion: z.literal(knowledgePackageSchemaVersion),
  projectId: idSchema,
  packageId: idSchema,
  versionHash: sha256HexSchema,
  databaseSha256: sha256HexSchema,
  relativeFilePath: z.string().min(1),
  activatedAt: isoDateSchema,
}).strict();

export function stateEvidenceIds(state: z.infer<typeof publishableKnowledgeStateSchema>) {
  if (state.kind === "fact") return state.entry.evidenceIds;
  if (state.kind === "conflict") {
    return [...new Set(state.alternatives.flatMap(({ evidenceIds }) => evidenceIds))];
  }
  return state.evidenceIds;
}

export type KnowledgePackageEvidence = z.infer<typeof knowledgePackageEvidenceSchema>;
export type KnowledgePackageBuildInput = z.infer<typeof knowledgePackageBuildInputSchema>;
export type KnowledgePackageManifest = z.infer<typeof knowledgePackageManifestSchema>;
export type KnowledgePackageDescriptor = z.infer<typeof knowledgePackageDescriptorSchema>;
export type ActiveKnowledgePackagePointer = z.infer<typeof activeKnowledgePackagePointerSchema>;
