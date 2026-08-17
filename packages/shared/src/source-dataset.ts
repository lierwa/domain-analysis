import { z } from "zod";

import {
  documentExcerptEvidenceLocatorSchema,
  textQuoteSchema,
  webTextEvidenceLocatorSchema,
} from "./evidence";
import { sourceAuthorityTypes } from "./product-knowledge";
import { sourceUsagePermissionSchema } from "./source-usage-permission";

export { sourceUsagePermissionSchema } from "./source-usage-permission";
export type { SourceUsagePermission } from "./source-usage-permission";

const idSchema = z.string().min(1).max(240);
const isoDateSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const sourceAccessPolicySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("manual"),
    version: idSchema,
  }).strict(),
  z.object({
    kind: z.literal("paced_http"),
    version: idSchema,
    maxRequestsPerMinute: z.number().int().positive(),
    minimumIntervalMs: z.number().int().positive(),
    jitterMs: z.object({
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
    }).strict(),
    batchSize: z.number().int().positive(),
    batchCooldownMs: z.number().int().positive(),
    maximumRunMs: z.number().int().positive(),
  }).strict(),
]).superRefine((policy, context) => {
  if (policy.kind === "paced_http" && policy.jitterMs.max < policy.jitterMs.min) {
    context.addIssue({
      code: "custom",
      path: ["jitterMs", "max"],
      message: "抖动上限不能小于下限",
    });
  }
});

export const sourceObjectKinds = [
  "taxonomy",
  "organization",
  "catalog_entry",
  "product",
  "document",
  "regulatory_record",
  "offer",
  "experience",
] as const;

export const sourceClaimScopes = [
  "foundational_principle",
  "standard_or_regulatory",
  "component_application",
  "brand_claim",
  "model_fact",
  "market_offer",
  "user_experience",
] as const;

const sourceHttpValidationSchema = z.object({
  status: z.number().int().min(100).max(599).optional(),
  etag: z.string().min(1).max(1000).optional(),
  lastModified: z.string().min(1).max(1000).optional(),
}).strict();

const sourceDatasetObservationObjectSchema = z.object({
  requestedUrl: z.string().url(),
  finalUrl: z.string().url().optional(),
  observedAt: isoDateSchema,
  state: z.enum([
    "accessible",
    "not_found",
    "access_denied",
    "login_required",
    "verification_required",
    "rate_limited",
    "source_abnormal",
  ]),
  httpValidation: sourceHttpValidationSchema.optional(),
  failureCode: z.enum([
    "not_found",
    "access_denied",
    "login_required",
    "verification_required",
    "rate_limited",
    "source_abnormal",
  ]).optional(),
}).strict();

export const sourceDatasetObservationSchema = sourceDatasetObservationObjectSchema
  .superRefine(validateSourceDatasetObservation);

export const accessibleSourceDatasetObservationSchema = sourceDatasetObservationObjectSchema
  .refine((observation) => observation.state === "accessible", {
    path: ["state"],
    message: "必须是可访问来源观察",
  })
  .superRefine(validateSourceDatasetObservation);

function validateSourceDatasetObservation(
  observation: z.infer<typeof sourceDatasetObservationObjectSchema>,
  context: z.RefinementCtx,
) {
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

const orderedSourceFieldSchema = z.object({
  name: z.string().min(1).max(500),
  value: z.string().max(20_000),
  unit: z.string().min(1).max(100).optional(),
}).strict();

const sourceContentBlockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    role: z.enum(["heading", "description", "feature", "instruction", "notice", "other"]),
    text: z.string().min(1).max(100_000),
    // WHY：来源层只保留 Provider 已知的来源位置候选；Evidence Module 仍会重新验证最小内容后才提交。
    locator: z.union([
      webTextEvidenceLocatorSchema,
      documentExcerptEvidenceLocatorSchema,
    ]).optional(),
  }).strict(),
  z.object({
    kind: z.literal("table"),
    title: z.string().min(1).max(500).optional(),
    columns: z.array(z.string().min(1).max(500)).min(1),
    rows: z.array(z.array(z.string().max(20_000))).min(1),
  }).strict(),
  z.object({
    kind: z.literal("asset_ref"),
    assetKey: idSchema,
    role: z.string().min(1).max(200),
    sourceUrl: z.string().url(),
  }).strict(),
]);

const sourceObjectReferenceSchema = z.object({
  sourceIdentity: idSchema,
  objectKind: z.enum(sourceObjectKinds),
  externalKey: idSchema,
}).strict();

export const sourceDatasetObjectInputSchema = z.object({
  sourceIdentity: idSchema,
  kind: z.enum(sourceObjectKinds),
  externalKey: idSchema,
}).strict();

export const sourceParsingSchema = z.object({
  adapterId: idSchema,
  adapterVersion: idSchema,
}).strict();

export const orderedRecordSourceContentSchema = z.object({
  kind: z.literal("ordered_record"),
  title: z.string().min(1).max(1000),
  fieldGroups: z.array(z.object({
    label: z.string().min(1).max(500),
    fields: z.array(orderedSourceFieldSchema).min(1),
  }).strict()),
  blocks: z.array(sourceContentBlockSchema),
}).strict().superRefine((content, context) => {
  if (content.fieldGroups.length === 0 && content.blocks.length === 0) {
    context.addIssue({ code: "custom", message: "来源内容必须至少包含字段组或内容块" });
  }
  for (const [blockIndex, block] of content.blocks.entries()) {
    if (block.kind !== "table") continue;
    for (const [rowIndex, row] of block.rows.entries()) {
      if (row.length !== block.columns.length) {
        context.addIssue({
          code: "custom",
          path: ["blocks", blockIndex, "rows", rowIndex],
          message: "表格行列数量必须一致",
        });
      }
    }
  }
});

export const documentSourceContentSchema = z.object({
  kind: z.literal("document"),
  title: z.string().min(1).max(1000),
  publisher: z.string().min(1).max(1000),
  documentIdentifier: z.string().min(1).max(500).optional(),
  version: z.string().min(1).max(500).optional(),
  publicationStatus: z.enum(["current", "superseded", "draft", "unknown"]),
  sections: z.array(z.object({
    heading: z.string().min(1).max(1000).optional(),
    blocks: z.array(sourceContentBlockSchema).min(1),
  }).strict()).min(1),
}).strict();

export const catalogSourceContentSchema = z.object({
  kind: z.literal("catalog"),
  title: z.string().min(1).max(1000),
  taxonomyPath: z.array(z.string().min(1).max(500)),
  facets: z.array(z.object({
    name: z.string().min(1).max(500),
    options: z.array(z.object({
      label: z.string().min(1).max(500),
      value: z.string().max(20_000),
      count: z.number().int().nonnegative().optional(),
    }).strict()),
  }).strict()),
  entries: z.array(z.object({
    position: z.number().int().positive(),
    label: z.string().min(1).max(1000),
    target: sourceObjectReferenceSchema,
    sourceUrl: z.string().url().optional(),
    fields: z.array(orderedSourceFieldSchema).optional(),
  }).strict()).min(1),
}).strict();

export const experienceCollectionSourceContentSchema = z.object({
  kind: z.literal("experience_collection"),
  title: z.string().min(1).max(1000),
  summaryMetrics: z.array(orderedSourceFieldSchema),
  samplingPlan: z.object({
    method: z.string().min(1).max(2000),
    sampleSize: z.number().int().positive(),
    ordering: z.string().min(1).max(500).optional(),
    pageRange: z.string().min(1).max(500).optional(),
  }).strict(),
  ratingBands: z.array(z.object({
    label: z.string().min(1).max(100),
    count: z.number().int().nonnegative(),
  }).strict()),
  samples: z.array(z.object({
    externalKey: idSchema,
    position: z.number().int().positive(),
    title: z.string().min(1).max(1000).optional(),
    text: z.string().min(1).max(100_000),
    rating: z.number().finite().optional(),
    observedAt: isoDateSchema.optional(),
  }).strict()).min(1),
}).strict();

export const sourceDatasetContentSchema = z.union([
  orderedRecordSourceContentSchema,
  documentSourceContentSchema,
  catalogSourceContentSchema,
  experienceCollectionSourceContentSchema,
]);

export const sourceRelationSchema = z.object({
  kind: z.enum([
    "contains",
    "describes",
    "variant_of",
    "offered_by",
    "reviews",
    "published_by",
    "supersedes",
    "references",
  ]),
  target: z.object({
    ...sourceObjectReferenceSchema.shape,
  }).strict(),
  proof: z.string().min(1).max(2000),
}).strict();

export const sourceCollectionRunStatuses = ["running", "completed", "failed", "stopped"] as const;

export const startSourceCollectionRunSchema = z.object({
  projectId: idSchema,
  sourceCollectionPlanId: idSchema.optional(),
  sourceCollectionPlanBatchKey: idSchema.optional(),
  collectionLaneId: idSchema,
  providerKey: idSchema,
  accessPolicy: sourceAccessPolicySchema,
}).strict().superRefine((input, context) => {
  if (Boolean(input.sourceCollectionPlanId) !== Boolean(input.sourceCollectionPlanBatchKey)) {
    context.addIssue({ code: "custom", message: "来源计划和计划批次必须同时提供" });
  }
});

export const sourceCollectionRunSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  sourceCollectionPlanId: idSchema.optional(),
  sourceCollectionPlanBatchKey: idSchema.optional(),
  categoryDefinitionVersionId: idSchema,
  confirmedScopeVersionId: idSchema,
  collectionBoardVersionId: idSchema,
  categoryCode: z.string().regex(/^[a-z][a-z0-9_-]+$/),
  collectionLaneId: idSchema,
  providerKey: idSchema,
  sourceAuthorityType: z.enum(sourceAuthorityTypes),
  accessPolicy: sourceAccessPolicySchema,
  status: z.enum(sourceCollectionRunStatuses),
  snapshotCount: z.number().int().nonnegative(),
  accessibleCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  startedAt: isoDateSchema,
  finishedAt: isoDateSchema.optional(),
  terminationReason: z.string().min(1).max(2000).optional(),
}).strict().superRefine((run, context) => {
  if (Boolean(run.sourceCollectionPlanId) !== Boolean(run.sourceCollectionPlanBatchKey)) {
    context.addIssue({ code: "custom", message: "来源计划和计划批次必须同时提供" });
  }
  if (run.status === "running" && run.finishedAt) {
    context.addIssue({ code: "custom", path: ["finishedAt"], message: "运行中任务不能有结束时间" });
  }
  if (run.status !== "running" && !run.finishedAt) {
    context.addIssue({ code: "custom", path: ["finishedAt"], message: "已结束任务必须记录结束时间" });
  }
  if (["failed", "stopped"].includes(run.status) && !run.terminationReason) {
    context.addIssue({
      code: "custom",
      path: ["terminationReason"],
      message: "失败或停止的来源运行必须记录原因",
    });
  }
});

export const finishSourceCollectionRunSchema = z.object({
  runId: idSchema,
  status: z.enum(["completed", "failed", "stopped"]),
  terminationReason: z.string().min(1).max(2000).optional(),
}).strict().superRefine((input, context) => {
  if (["failed", "stopped"].includes(input.status) && !input.terminationReason) {
    context.addIssue({
      code: "custom",
      path: ["terminationReason"],
      message: "失败或停止的来源运行必须记录原因",
    });
  }
});

const commitSourceSnapshotObjectSchema = z.object({
  runId: idSchema,
  idempotencyKey: idSchema,
  object: sourceDatasetObjectInputSchema,
  targetKeys: z.array(idSchema).min(1),
  knowledgeNeedIds: z.array(idSchema).min(1),
  observation: sourceDatasetObservationSchema,
  content: sourceDatasetContentSchema.optional(),
  parsing: sourceParsingSchema,
  claimScopes: z.array(z.enum(sourceClaimScopes)).min(1),
  usagePermission: sourceUsagePermissionSchema,
  relations: z.array(sourceRelationSchema),
}).strict();

export const commitSourceSnapshotSchema = commitSourceSnapshotObjectSchema.superRefine(
  validateObservationContentPair,
);

export const sourceObjectSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  sourceIdentity: idSchema,
  kind: z.enum(sourceObjectKinds),
  externalKey: idSchema,
  createdAt: isoDateSchema,
}).strict();

const sourceSnapshotObjectSchema = z.object({
  id: idSchema,
  runId: idSchema,
  objectId: idSchema,
  // TRADE-OFF：新提交必须携带；历史迁移前快照允许显式缺失，不能伪造“legacy unknown”目标。
  targetKeys: z.array(idSchema).min(1).optional(),
  knowledgeNeedIds: z.array(idSchema).min(1).optional(),
  idempotencyKey: idSchema,
  observation: sourceDatasetObservationSchema,
  content: sourceDatasetContentSchema.optional(),
  parsing: sourceParsingSchema,
  claimScopes: z.array(z.enum(sourceClaimScopes)).min(1),
  usagePermission: sourceUsagePermissionSchema,
  relations: z.array(sourceRelationSchema),
  contentHash: sha256Schema,
  createdAt: isoDateSchema,
}).strict();

export const sourceSnapshotSchema = sourceSnapshotObjectSchema.superRefine(
  validateObservationContentPair,
);

function validateObservationContentPair(
  snapshot: { observation: z.infer<typeof sourceDatasetObservationSchema>; content?: unknown },
  context: z.RefinementCtx,
) {
  if (snapshot.observation.state === "accessible" && !snapshot.content) {
    context.addIssue({ code: "custom", path: ["content"], message: "可访问来源必须保存内容" });
  }
  if (snapshot.observation.state !== "accessible" && snapshot.content) {
    context.addIssue({ code: "custom", path: ["content"], message: "失败观察不能伪造来源内容" });
  }
}

export const commitSourceAssetSchema = z.object({
  snapshotId: idSchema,
  assetKey: idSchema,
  sourceUrl: z.string().url(),
  mediaType: z.string().regex(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i),
  dimensions: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict().optional(),
  purpose: z.string().min(1).max(200),
  blockIndex: z.number().int().nonnegative(),
  position: z.number().int().positive(),
  privacyClass: z.enum(["public", "restricted"]),
}).strict();

export const sourceAssetSchema = commitSourceAssetSchema.extend({
  id: idSchema,
  contentHash: sha256Schema,
  casIntegrity: z.string().regex(/^sha256-[A-Za-z0-9+/]+={0,2}$/),
  bytes: z.number().int().positive(),
  createdAt: isoDateSchema,
}).strict();

export const sourceSnapshotRecordSchema = z.object({
  object: sourceObjectSchema,
  snapshot: sourceSnapshotSchema,
  assets: z.array(sourceAssetSchema),
}).strict();

export const sourceCollectionRunViewSchema = z.object({
  run: sourceCollectionRunSchema,
  records: z.array(sourceSnapshotRecordSchema),
}).strict();

export const exportSourceCollectionRunSchema = z.object({
  runId: idSchema,
  format: z.enum(["jsonl", "csv"]),
}).strict();

export const sourceEvidenceSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ordered_field"),
    groupIndex: z.number().int().nonnegative(),
    fieldIndex: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    kind: z.literal("ordered_text_block"),
    blockIndex: z.number().int().nonnegative(),
    quote: textQuoteSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("document_text_block"),
    sectionIndex: z.number().int().nonnegative(),
    blockIndex: z.number().int().nonnegative(),
    quote: textQuoteSchema.optional(),
  }).strict(),
]);

export const materializeSourceEvidenceInputSchema = z.object({
  requestId: idSchema,
  snapshotId: idSchema,
  selection: sourceEvidenceSelectionSchema,
}).strict();

export type SourceAccessPolicy = z.infer<typeof sourceAccessPolicySchema>;
export type StartSourceCollectionRun = z.infer<typeof startSourceCollectionRunSchema>;
export type SourceCollectionRun = z.infer<typeof sourceCollectionRunSchema>;
export type FinishSourceCollectionRun = z.infer<typeof finishSourceCollectionRunSchema>;
export type CommitSourceSnapshot = z.infer<typeof commitSourceSnapshotSchema>;
export type SourceObject = z.infer<typeof sourceObjectSchema>;
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type CommitSourceAsset = z.infer<typeof commitSourceAssetSchema>;
export type SourceAsset = z.infer<typeof sourceAssetSchema>;
export type SourceSnapshotRecord = z.infer<typeof sourceSnapshotRecordSchema>;
export type SourceCollectionRunView = z.infer<typeof sourceCollectionRunViewSchema>;
export type ExportSourceCollectionRun = z.infer<typeof exportSourceCollectionRunSchema>;
export type SourceEvidenceSelection = z.infer<typeof sourceEvidenceSelectionSchema>;
export type MaterializeSourceEvidenceInput = z.infer<typeof materializeSourceEvidenceInputSchema>;
