import { z } from "zod";

import {
  collectionStopConditions,
  knowledgeLayers,
  sourceAuthorityTypes,
} from "./product-knowledge";
import { sourceUsagePermissionSchema } from "./source-usage-permission";

const idSchema = z.string().min(1).max(240);
const isoDateSchema = z.string().datetime({ offset: true });
const sha256IntegritySchema = z.string().regex(/^sha256-[A-Za-z0-9+/]{43}=$/);
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const evidenceKinds = [
  "web_text",
  "document_excerpt",
  "table_region",
  "image_region",
] as const;

export const evidenceByteCeilings = {
  web_text: 64 * 1024,
  document_excerpt: 256 * 1024,
  table_region: 1024 * 1024,
  image_region: 20 * 1024 * 1024,
} as const;

export const evidenceRequestStatuses = [
  "not_started",
  "sufficient",
  "insufficient",
  "waiting",
  "failed",
] as const;

export const knowledgeNeedReferenceSchema = z.discriminatedUnion("kind", [
  z.object({
    id: idSchema,
    kind: z.literal("attribute"),
    attributeCode: z.string().min(1).max(240),
  }).strict(),
  z.object({
    id: idSchema,
    kind: z.literal("competency_question"),
    question: z.string().min(1).max(500),
  }).strict(),
]);

const evidenceRequestDraftObjectSchema = z.object({
  projectId: idSchema,
  categoryDefinitionVersionId: idSchema,
  confirmedScopeVersionId: idSchema,
  collectionBoardVersionId: idSchema,
  collectionLaneIds: z.array(idSchema).min(1),
  knowledgeNeed: knowledgeNeedReferenceSchema,
  question: z.string().min(1).max(1000),
  knowledgeLayer: z.enum(knowledgeLayers),
  targetKeys: z.array(z.string().min(1).max(240)).min(1),
  allowedSourceAuthorityTypes: z.array(z.enum(sourceAuthorityTypes)).min(1),
  acceptedEvidenceKinds: z.array(z.enum(evidenceKinds)).min(1),
  evidenceByteLimits: z.object({
    web_text: z.number().int().positive().max(evidenceByteCeilings.web_text).optional(),
    document_excerpt: z.number().int().positive().max(evidenceByteCeilings.document_excerpt).optional(),
    table_region: z.number().int().positive().max(evidenceByteCeilings.table_region).optional(),
    image_region: z.number().int().positive().max(evidenceByteCeilings.image_region).optional(),
  }).strict(),
  imagePolicy: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("crop_required") }).strict(),
    z.object({
      mode: z.literal("full_image_allowed"),
      reason: z.string().min(1).max(1000),
    }).strict(),
  ]).optional(),
  freshness: z.object({
    observedAfter: isoDateSchema.optional(),
    maxAgeDays: z.number().int().positive().max(3650).optional(),
  }).strict(),
  minimumEvidenceItemsPerTarget: z.number().int().positive().max(20),
  minimumDistinctSourcesPerTarget: z.number().int().positive().max(20),
  evidencePolicyVersion: idSchema,
  stopConditions: z.array(z.enum(collectionStopConditions)).min(1),
  priority: z.number().int().min(0).max(100),
}).strict();

export const evidenceRequestDraftSchema = evidenceRequestDraftObjectSchema.superRefine(
  validateEvidenceRequest,
);

export const evidenceRequestSchema = z.object({
  id: idSchema,
  createdAt: isoDateSchema,
}).merge(evidenceRequestDraftObjectSchema).superRefine(validateEvidenceRequest);

function validateEvidenceRequest(
  request: z.infer<typeof evidenceRequestDraftObjectSchema>,
  context: z.RefinementCtx,
) {
  ensureUnique(request.collectionLaneIds, "collectionLaneIds", context);
  ensureUnique(request.targetKeys, "targetKeys", context);
  ensureUnique(request.allowedSourceAuthorityTypes, "allowedSourceAuthorityTypes", context);
  ensureUnique(request.acceptedEvidenceKinds, "acceptedEvidenceKinds", context);
  const limitedKinds = Object.keys(request.evidenceByteLimits).sort();
  const acceptedKinds = [...request.acceptedEvidenceKinds].sort();
  if (limitedKinds.join("\0") !== acceptedKinds.join("\0")) {
    context.addIssue({
      code: "custom",
      path: ["evidenceByteLimits"],
      message: "每种已接受证据必须且只能声明一个字节上限",
    });
  }
  const acceptsImage = request.acceptedEvidenceKinds.includes("image_region");
  if (acceptsImage !== Boolean(request.imagePolicy)) {
    context.addIssue({
      code: "custom",
      path: ["imagePolicy"],
      message: "接受图片证据时必须声明图片最小化政策，其他请求不能携带图片政策",
    });
  }
  if (request.minimumDistinctSourcesPerTarget > request.minimumEvidenceItemsPerTarget) {
    context.addIssue({
      code: "custom",
      path: ["minimumDistinctSourcesPerTarget"],
      message: "独立来源数量不能大于最小证据数量",
    });
  }
}

export const sourceObservationStates = [
  "accessible",
  "not_found",
  "access_denied",
  "login_required",
  "verification_required",
  "rate_limited",
  "source_abnormal",
] as const;

const sourceObservationDraftObjectSchema = z.object({
  requestId: idSchema,
  // TRADE-OFF：历史 Evidence 可没有来源快照；新 SourceDataset 桥必须绑定它以实现可追溯幂等。
  sourceSnapshotId: idSchema.optional(),
  subjectKeys: z.array(z.string().min(1).max(240)).min(1),
  sourceIdentity: idSchema,
  sourceAuthorityType: z.enum(sourceAuthorityTypes),
  // TRADE-OFF：旧 Evidence 记录可能没有该字段；新生产链必须写入，审核发布时缺失即拒绝。
  usagePermission: sourceUsagePermissionSchema.optional(),
  requestedUrl: z.string().url(),
  finalUrl: z.string().url().optional(),
  observedAt: isoDateSchema,
  state: z.enum(sourceObservationStates),
  httpValidation: z.object({
    status: z.number().int().min(100).max(599).optional(),
    etag: z.string().min(1).max(1000).optional(),
    lastModified: z.string().min(1).max(1000).optional(),
  }).strict().optional(),
  failureCode: z.enum([
    "not_found",
    "access_denied",
    "login_required",
    "verification_required",
    "rate_limited",
    "source_abnormal",
  ]).optional(),
}).strict();

export const sourceObservationDraftSchema = sourceObservationDraftObjectSchema.superRefine(
  validateSourceObservation,
);

export const sourceObservationSchema = z.object({
  id: idSchema,
  createdAt: isoDateSchema,
}).merge(sourceObservationDraftObjectSchema).superRefine(validateSourceObservation);

function validateSourceObservation(
  observation: z.infer<typeof sourceObservationDraftObjectSchema>,
  context: z.RefinementCtx,
) {
  ensureUnique(observation.subjectKeys, "subjectKeys", context);
  if (observation.state === "accessible" && !observation.finalUrl) {
    context.addIssue({ code: "custom", path: ["finalUrl"], message: "可访问来源必须记录最终 URL" });
  }
  if (observation.state === "accessible" && observation.failureCode) {
    context.addIssue({ code: "custom", path: ["failureCode"], message: "可访问来源不能带失败码" });
  }
  if (observation.state !== "accessible" && observation.failureCode !== observation.state) {
    context.addIssue({ code: "custom", path: ["failureCode"], message: "失败状态必须记录同名失败码" });
  }
}

export const textQuoteSchema = z.object({
  exact: z.string().min(1).max(32_000),
  prefix: z.string().min(1).max(4_000).optional(),
  suffix: z.string().min(1).max(4_000).optional(),
}).strict().refine((quote) => Boolean(quote.prefix || quote.suffix), {
  message: "文本证据必须保留前文或后文以便消歧",
});

export const webTextEvidenceLocatorSchema = z.object({
  kind: z.literal("web_text"),
  quote: textQuoteSchema,
  structuralHint: z.string().min(1).max(1000).optional(),
}).strict();

export const documentExcerptEvidenceLocatorSchema = z.object({
  kind: z.literal("document_excerpt"),
  sourceDocumentSha256: sha256HexSchema,
  page: z.number().int().positive(),
  section: z.string().min(1).max(500).optional(),
  quote: textQuoteSchema,
}).strict();

export const tableRegionEvidenceLocatorSchema = z.object({
  kind: z.literal("table_region"),
  sourceDocumentSha256: sha256HexSchema,
  sheet: z.string().min(1).max(240),
  headerRange: z.string().min(1).max(100),
  cellRange: z.string().min(1).max(100),
  rowIdentity: z.string().min(1).max(500),
}).strict();

export const evidenceLocatorSchema = z.discriminatedUnion("kind", [
  webTextEvidenceLocatorSchema,
  documentExcerptEvidenceLocatorSchema,
  tableRegionEvidenceLocatorSchema,
  z.object({
    kind: z.literal("image_region"),
    sourceImageSha256: sha256HexSchema,
    sourceWidth: z.number().int().positive(),
    sourceHeight: z.number().int().positive(),
    xywh: z.object({
      unit: z.enum(["pixel", "percent"]),
      x: z.number().nonnegative(),
      y: z.number().nonnegative(),
      width: z.number().positive(),
      height: z.number().positive(),
    }).strict(),
  }).strict(),
]);

export const subjectRelationProofSchema = z.object({
  method: z.enum([
    "explicit_identifier",
    "structured_data",
    "caption",
    "link_target",
    "document_identity",
    "table_row_identity",
    "human_confirmed",
  ]),
  detail: z.string().min(1).max(1000),
}).strict();

export const evidenceCandidateSchema = z.object({
  requestId: idSchema,
  observationId: idSchema,
  idempotencyKey: idSchema.optional(),
  kind: z.enum(evidenceKinds),
  mediaType: z.string().min(1).max(200),
  privacyClass: z.enum(["public", "restricted"]),
  subjectKeys: z.array(z.string().min(1).max(240)).min(1),
  relationProof: subjectRelationProofSchema,
  locator: evidenceLocatorSchema,
}).strict().superRefine((candidate, context) => {
  ensureUnique(candidate.subjectKeys, "subjectKeys", context);
  if (candidate.kind !== candidate.locator.kind) {
    context.addIssue({ code: "custom", path: ["locator"], message: "证据类型和定位类型必须一致" });
  }
});

export const evidenceManifestSchema = z.object({
  id: idSchema,
  requestId: idSchema,
  observationId: idSchema,
  idempotencyKey: idSchema.optional(),
  kind: z.enum(evidenceKinds),
  mediaType: z.string().min(1).max(200),
  privacyClass: z.enum(["public", "restricted"]),
  subjectKeys: z.array(z.string().min(1).max(240)).min(1),
  relationProof: subjectRelationProofSchema,
  locator: evidenceLocatorSchema,
  contentIntegrity: sha256IntegritySchema,
  contentBytes: z.number().int().positive(),
  evidencePolicyVersion: idSchema,
  capturedAt: isoDateSchema,
  createdAt: isoDateSchema,
}).strict();

export const evidenceItemSchema = evidenceManifestSchema.extend({
  manifestIntegrity: sha256IntegritySchema,
}).strict();

export const evidenceAssessmentSchema = z.object({
  requestId: idSchema,
  status: z.enum(evidenceRequestStatuses),
  evidenceItemIds: z.array(idSchema),
  observationIds: z.array(idSchema),
  targets: z.array(z.object({
    targetKey: z.string().min(1).max(240),
    status: z.enum(evidenceRequestStatuses),
    evidenceItemIds: z.array(idSchema),
    observationIds: z.array(idSchema),
    distinctSourceCount: z.number().int().nonnegative(),
    reasonCodes: z.array(z.enum([
      "minimum_evidence_not_met",
      "minimum_distinct_sources_not_met",
      "access_waiting",
      "no_accessible_source",
    ])),
  }).strict()),
  reasonCodes: z.array(z.enum([
    "minimum_evidence_not_met",
    "minimum_distinct_sources_not_met",
    "access_waiting",
    "no_accessible_source",
  ])),
}).strict();

export const projectEvidenceRequestViewSchema = z.object({
  request: evidenceRequestSchema,
  assessment: evidenceAssessmentSchema,
  sourceObservations: z.array(sourceObservationSchema),
  evidenceItems: z.array(z.object({
    item: evidenceItemSchema,
    contentText: z.string().min(1),
  }).strict()),
}).strict();

function ensureUnique(values: readonly string[], path: string, context: z.RefinementCtx) {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path: [path], message: `${path} 不得重复` });
  }
}

export type EvidenceKind = (typeof evidenceKinds)[number];
export type EvidenceRequestDraft = z.infer<typeof evidenceRequestDraftSchema>;
export type EvidenceRequest = z.infer<typeof evidenceRequestSchema>;
export type SourceObservationDraft = z.infer<typeof sourceObservationDraftSchema>;
export type SourceObservation = z.infer<typeof sourceObservationSchema>;
export type EvidenceCandidate = z.infer<typeof evidenceCandidateSchema>;
export type EvidenceManifest = z.infer<typeof evidenceManifestSchema>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type EvidenceAssessment = z.infer<typeof evidenceAssessmentSchema>;
export type ProjectEvidenceRequestView = z.infer<typeof projectEvidenceRequestViewSchema>;
