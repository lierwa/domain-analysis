import { z } from "zod";

const idSchema = z.string().min(1);
const isoDateSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const versionSchema = z.number().int().positive();

export const knowledgeLayers = [
  "identity",
  "specification",
  "function",
  "mechanism",
  "decision",
  "offer",
] as const;

export const sourceAuthorityTypes = [
  "brand_official_site",
  "official_direct_retail",
  "brand_flagship_store",
  "official_manual",
  "regulatory_source",
] as const;

export const versionStatuses = ["draft", "confirmed", "superseded"] as const;

export const categoryAttributeSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  knowledgeLayer: z.enum(knowledgeLayers),
  valueKind: z.enum(["text", "decimal", "boolean", "enum"]),
  canonicalUnitCode: z.string().min(1).max(32).optional(),
  allowedValues: z.array(z.string().min(1)).min(1).optional(),
  externalMappings: z.array(z.string().min(1)).default([]),
  filterable: z.boolean(),
  comparable: z.boolean(),
}).strict().superRefine((attribute, context) => {
  if (attribute.valueKind === "enum" && !attribute.allowedValues) {
    context.addIssue({ code: "custom", path: ["allowedValues"], message: "枚举属性必须声明 allowedValues" });
  }
  if (attribute.valueKind !== "enum" && attribute.allowedValues) {
    context.addIssue({ code: "custom", path: ["allowedValues"], message: "只有枚举属性可以声明 allowedValues" });
  }
});

export const decisionDimensionSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  relatedAttributeCodes: z.array(z.string().min(1)).min(1),
}).strict();

export const categoryDefinitionVersionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  categoryCode: z.string().regex(/^[a-z][a-z0-9_-]+$/),
  label: z.string().min(1).max(120),
  market: z.string().min(2).max(64),
  version: versionSchema,
  status: z.enum(versionStatuses),
  sourceAuthorityPolicy: z.array(z.enum(sourceAuthorityTypes)).min(1),
  attributes: z.array(categoryAttributeSchema).min(1),
  decisionDimensions: z.array(decisionDimensionSchema).min(1),
  competencyQuestions: z.array(z.string().min(1).max(500)).min(1),
  contentHash: sha256Schema,
  createdAt: isoDateSchema,
  confirmedAt: isoDateSchema.optional(),
}).strict().superRefine((definition, context) => {
  const attributeCodes = new Set(definition.attributes.map((attribute) => attribute.code));
  const duplicateCount = definition.attributes.length - attributeCodes.size;
  if (duplicateCount > 0) {
    context.addIssue({ code: "custom", path: ["attributes"], message: "属性 code 不得重复" });
  }
  for (const [index, dimension] of definition.decisionDimensions.entries()) {
    for (const code of dimension.relatedAttributeCodes) {
      if (!attributeCodes.has(code)) {
        context.addIssue({
          code: "custom",
          path: ["decisionDimensions", index, "relatedAttributeCodes"],
          message: `决策维度引用了未知属性：${code}`,
        });
      }
    }
  }
  requireConfirmedAt(definition, context);
});

export const scopeTargetSchema = z.object({
  key: z.string().min(1).max(200),
  kind: z.enum(["brand", "model", "variant"]),
  label: z.string().min(1).max(200),
  parentKey: z.string().min(1).max(200).optional(),
  evidenceReferenceIds: z.array(idSchema).min(1),
  disposition: z.enum(["included", "excluded"]),
  reason: z.string().min(1).max(1000),
}).strict();

export const confirmedScopeVersionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  categoryDefinitionVersionId: idSchema,
  market: z.string().min(2).max(64),
  version: versionSchema,
  status: z.enum(versionStatuses),
  populationLayers: z.array(z.enum([
    "regulatory_registry",
    "official_current_catalog",
    "licensed_market_priority",
  ])).min(1),
  targets: z.array(scopeTargetSchema).min(1),
  contentHash: sha256Schema,
  createdAt: isoDateSchema,
  confirmedAt: isoDateSchema.optional(),
}).strict().superRefine((scope, context) => {
  requireConfirmedAt(scope, context);
  const keys = scope.targets.map((target) => target.key);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", path: ["targets"], message: "范围 target key 不得重复" });
  }
});

export const collectionLaneSchema = z.object({
  id: idSchema,
  sourceAuthorityType: z.enum(sourceAuthorityTypes),
  accessMode: z.enum(["public_web", "browser_session", "licensed_api", "document"]),
  targetKeys: z.array(z.string().min(1)).min(1),
  knowledgeLayers: z.array(z.enum(knowledgeLayers)).min(1),
  refreshPolicy: z.enum(["manual", "on_source_change", "daily", "weekly", "monthly"]),
  stopConditions: z.array(z.enum([
    "login_required",
    "verification_required",
    "access_denied",
    "sensitive_data_detected",
    "source_abnormal",
  ])).min(1),
}).strict();

export const collectionBoardVersionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  confirmedScopeVersionId: idSchema,
  version: versionSchema,
  status: z.enum(versionStatuses),
  lanes: z.array(collectionLaneSchema).min(1),
  contentHash: sha256Schema,
  createdAt: isoDateSchema,
  confirmedAt: isoDateSchema.optional(),
}).strict().superRefine(requireConfirmedAt);

export const productKnowledgeProjectSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(160),
  knowledgeTopic: z.string().min(1).max(500),
  market: z.string().min(2).max(64),
  status: z.enum(["draft", "ready", "archived"]),
  revision: versionSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict();

export const confirmedProjectSnapshotSchema = z.object({
  project: productKnowledgeProjectSchema.extend({ status: z.literal("ready") }),
  categoryDefinition: categoryDefinitionVersionSchema.and(z.object({ status: z.literal("confirmed") })),
  confirmedScope: confirmedScopeVersionSchema.and(z.object({ status: z.literal("confirmed") })),
  collectionBoard: collectionBoardVersionSchema.and(z.object({ status: z.literal("confirmed") })),
}).strict().superRefine((snapshot, context) => {
  const projectId = snapshot.project.id;
  if ([snapshot.categoryDefinition.projectId, snapshot.confirmedScope.projectId,
    snapshot.collectionBoard.projectId].some((id) => id !== projectId)) {
    context.addIssue({ code: "custom", message: "冻结输入必须属于同一项目" });
  }
  if (snapshot.confirmedScope.categoryDefinitionVersionId !== snapshot.categoryDefinition.id) {
    context.addIssue({ code: "custom", path: ["confirmedScope"], message: "范围未绑定当前品类定义" });
  }
  if (snapshot.collectionBoard.confirmedScopeVersionId !== snapshot.confirmedScope.id) {
    context.addIssue({ code: "custom", path: ["collectionBoard"], message: "搜集板未绑定当前确认范围" });
  }
  if ([snapshot.categoryDefinition.market, snapshot.confirmedScope.market]
    .some((market) => market !== snapshot.project.market)) {
    context.addIssue({ code: "custom", message: "冻结输入的市场必须一致" });
  }
  const targetKeys = new Set(snapshot.confirmedScope.targets
    .filter((target) => target.disposition === "included")
    .map((target) => target.key));
  const allowedSources = new Set(snapshot.categoryDefinition.sourceAuthorityPolicy);
  for (const [index, lane] of snapshot.collectionBoard.lanes.entries()) {
    if (lane.targetKeys.some((key) => !targetKeys.has(key))) {
      context.addIssue({ code: "custom", path: ["collectionBoard", "lanes", index], message: "搜集板引用了未纳入范围的目标" });
    }
    if (!allowedSources.has(lane.sourceAuthorityType)) {
      context.addIssue({ code: "custom", path: ["collectionBoard", "lanes", index], message: "搜集板使用了品类策略外来源" });
    }
  }
});

function requireConfirmedAt(
  value: { status: (typeof versionStatuses)[number]; confirmedAt?: string },
  context: z.RefinementCtx,
) {
  if (value.status === "confirmed" && !value.confirmedAt) {
    context.addIssue({ code: "custom", path: ["confirmedAt"], message: "确认版本必须记录 confirmedAt" });
  }
}

export type ProductKnowledgeProject = z.infer<typeof productKnowledgeProjectSchema>;
export type CategoryDefinitionVersion = z.infer<typeof categoryDefinitionVersionSchema>;
export type ConfirmedScopeVersion = z.infer<typeof confirmedScopeVersionSchema>;
export type CollectionBoardVersion = z.infer<typeof collectionBoardVersionSchema>;
export type ConfirmedProjectSnapshot = z.infer<typeof confirmedProjectSnapshotSchema>;
export type CategoryDefinitionContent = Pick<CategoryDefinitionVersion,
  "sourceAuthorityPolicy" | "attributes" | "decisionDimensions" | "competencyQuestions">;
export type ConfirmedScopeContent = Pick<ConfirmedScopeVersion, "populationLayers" | "targets">;
export type CollectionBoardContent = Pick<CollectionBoardVersion, "lanes">;
