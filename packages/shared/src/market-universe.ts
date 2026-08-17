import { z } from "zod";

import { sourceAuthorityTypes } from "./product-knowledge";

const idSchema = z.string().min(1);
const isoDateSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const marketUniverseDimensionCodes = [
  "regulatory_product_class",
  "installation_form",
  "door_layout",
] as const;

export const marketUniverseSourceCoverageKinds = [
  "independent_brand_catalog",
  "multi_brand_official_catalog",
  "regulatory_registry_lookup",
  "official_channel_discovery",
] as const;

export const regulatoryCatalogOutcomeSchema = z.object({
  brand: z.string().min(1).max(120),
  manufacturerModel: z.string().min(1).max(200),
  status: z.enum(["matched", "not_found", "failed", "producer_conflict"]),
  registrationCount: z.number().int().nonnegative(),
  producerNames: z.array(z.string().min(1).max(200)),
  errorCode: z.string().min(1).optional(),
}).strict();

export const regulatoryReconciliationRunSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  sourceUniverse: z.object({
    id: idSchema,
    version: z.number().int().positive(),
    contentHash: sha256Schema,
  }).strict(),
  lifecycleStatus: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  totalModels: z.number().int().nonnegative(),
  completedModels: z.number().int().nonnegative(),
  matchedModels: z.number().int().nonnegative(),
  notFoundModels: z.number().int().nonnegative(),
  failedModels: z.number().int().nonnegative(),
  producerConflictModels: z.number().int().nonnegative(),
  outputUniverseVersion: z.number().int().positive().optional(),
  errorCode: z.string().min(1).optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict().superRefine((run, context) => {
  const outcomeCount = run.matchedModels + run.notFoundModels
    + run.failedModels + run.producerConflictModels;
  if (run.completedModels !== outcomeCount || run.completedModels > run.totalModels) {
    context.addIssue({ code: "custom", path: ["completedModels"], message: "完成数必须等于各结果数之和且不超过总数" });
  }
  if (run.lifecycleStatus === "succeeded"
    && (run.completedModels !== run.totalModels || !run.outputUniverseVersion)) {
    context.addIssue({ code: "custom", path: ["lifecycleStatus"], message: "成功运行必须完成全部型号并生成新总体版本" });
  }
});

const dimensionCodeSchema = z.enum(marketUniverseDimensionCodes);
const brandIdentitySchema = z.object({
  key: idSchema,
  label: z.string().min(1).max(120),
}).strict();

const regulatoryProducerSchema = z.object({
  key: idSchema,
  label: z.string().min(1).max(200),
  registrationId: z.string().min(1).max(200).optional(),
}).strict();

export const marketUniverseClassificationSchema = z.discriminatedUnion("status", [
  z.object({
    dimensionCode: dimensionCodeSchema,
    status: z.literal("classified"),
    valueCode: idSchema,
    valueLabel: z.string().min(1).max(200),
  }).strict(),
  z.object({
    dimensionCode: dimensionCodeSchema,
    status: z.literal("unknown"),
  }).strict(),
  z.object({
    dimensionCode: dimensionCodeSchema,
    status: z.literal("not_applicable"),
  }).strict(),
]);

export const officialCatalogEntrySchema = z.object({
  brand: z.string().min(1).max(120),
  manufacturerModel: z.string().min(1).max(200),
  sourceItemId: z.string().min(1).max(200),
  sourceUrl: z.string().url(),
  identityStatus: z.enum(["confirmed", "unconfirmed"]).optional(),
  regulatoryProducer: regulatoryProducerSchema.optional(),
  classifications: z.array(marketUniverseClassificationSchema).optional(),
}).strict();

const officialCatalogSnapshotObjectSchema = z.object({
  sourceId: idSchema,
  sourceIdentity: z.string().min(1).max(160),
  sourceAuthorityType: z.enum(sourceAuthorityTypes),
  coverageKind: z.enum(marketUniverseSourceCoverageKinds),
  catalogUrl: z.string().url(),
  observedAt: isoDateSchema,
  declaredItemCount: z.number().int().nonnegative(),
  fetchedItemCount: z.number().int().nonnegative(),
  acceptedItemCount: z.number().int().nonnegative(),
  coverageStatus: z.enum(["complete", "partial"]),
  entries: z.array(officialCatalogEntrySchema),
}).strict();

export const officialCatalogSnapshotSchema = officialCatalogSnapshotObjectSchema.superRefine((snapshot, context) => {
  if (snapshot.acceptedItemCount !== snapshot.entries.length) {
    context.addIssue({
      code: "custom",
      path: ["acceptedItemCount"],
      message: "接收行数必须与目录条目数一致",
    });
  }
  if (snapshot.fetchedItemCount < snapshot.acceptedItemCount) {
    context.addIssue({ code: "custom", message: "读取行数不能小于接收行数" });
  }
});

export const marketUniverseSourceSchema = officialCatalogSnapshotObjectSchema.omit({ entries: true }).extend({
  uniqueModelCount: z.number().int().nonnegative(),
  observedBrandKeys: z.array(idSchema),
}).strict();

const sourceReferenceSchema = z.object({
  sourceId: idSchema,
  sourceItemId: z.string().min(1).max(200),
  sourceUrl: z.string().url(),
}).strict();

export const marketUniverseModelSchema = z.object({
  key: idSchema,
  brand: brandIdentitySchema,
  manufacturerModel: z.string().min(1).max(200),
  identityStatus: z.enum(["confirmed", "unconfirmed"]),
  regulatoryProducers: z.array(regulatoryProducerSchema),
  classifications: z.array(marketUniverseClassificationSchema),
  sourceRefs: z.array(sourceReferenceSchema).min(1),
}).strict();

const unknownScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("market") }).strict(),
  z.object({ type: z.literal("source"), sourceId: idSchema }).strict(),
  z.object({ type: z.literal("brand"), brandKey: idSchema }).strict(),
  z.object({ type: z.literal("model"), modelKey: idSchema }).strict(),
  z.object({
    type: z.literal("model_dimension"),
    modelKey: idSchema,
    dimensionCode: dimensionCodeSchema,
  }).strict(),
]);

export const marketUniverseUnknownSchema = z.object({
  key: idSchema,
  kind: z.enum(["brand_discovery", "model_identity", "classification", "source_access", "window_mismatch"]),
  scope: unknownScopeSchema,
  blocking: z.boolean(),
  description: z.string().min(1).max(1000),
  requiredSourceAuthorityTypes: z.array(z.enum(sourceAuthorityTypes)).min(1),
}).strict();

const coverageDimensionSchema = z.object({
  code: dimensionCodeSchema,
  label: z.string().min(1).max(120),
  taxonomyVersion: z.string().min(1).max(120),
  requiredForConfirmation: z.boolean(),
}).strict();

const marketUniverseContentObjectSchema = z.object({
  basis: z.literal("official_active_assortment"),
  deduplicationRule: z.literal("brand_and_manufacturer_model"),
  observationStartedAt: isoDateSchema,
  observationEndedAt: isoDateSchema,
  coverageDimensions: z.array(coverageDimensionSchema).min(1),
  sources: z.array(marketUniverseSourceSchema).min(1),
  models: z.array(marketUniverseModelSchema).min(1),
  unknowns: z.array(marketUniverseUnknownSchema),
}).strict();

export const marketUniverseContentSchema = marketUniverseContentObjectSchema.superRefine((content, context) => {
  const sourceIds = uniqueKeys(content.sources.map((source) => source.sourceId), context, ["sources"], "来源 sourceId 不得重复");
  const modelKeys = uniqueKeys(content.models.map((model) => model.key), context, ["models"], "型号 identity key 不得重复");
  const dimensionCodes = uniqueKeys(
    content.coverageDimensions.map((dimension) => dimension.code),
    context,
    ["coverageDimensions"],
    "覆盖维度 code 不得重复",
  );
  const requiredDimensions = content.coverageDimensions.filter((item) => item.requiredForConfirmation);
  const modelBrandKeys = new Set(content.models.map((model) => model.brand.key));

  for (const [sourceIndex, source] of content.sources.entries()) {
    if (new Set(source.observedBrandKeys).size !== source.observedBrandKeys.length) {
      context.addIssue({ code: "custom", path: ["sources", sourceIndex, "observedBrandKeys"], message: "来源品牌 identity 不得重复" });
    }
    if (source.observedBrandKeys.some((brandKey) => !modelBrandKeys.has(brandKey))) {
      context.addIssue({ code: "custom", path: ["sources", sourceIndex, "observedBrandKeys"], message: "来源引用了总体中不存在的品牌 identity" });
    }
  }

  for (const [modelIndex, model] of content.models.entries()) {
    if (model.sourceRefs.some((reference) => !sourceIds.has(reference.sourceId))) {
      context.addIssue({ code: "custom", path: ["models", modelIndex, "sourceRefs"], message: "型号引用了未知目录来源" });
    }
    const modelDimensions = uniqueKeys(
      model.classifications.map((classification) => classification.dimensionCode),
      context,
      ["models", modelIndex, "classifications"],
      "同一型号的覆盖维度不得重复",
    );
    if ([...modelDimensions].some((code) => !dimensionCodes.has(code))) {
      context.addIssue({ code: "custom", path: ["models", modelIndex, "classifications"], message: "型号使用了未声明的覆盖维度" });
    }
    if (requiredDimensions.some((dimension) => !modelDimensions.has(dimension.code))) {
      context.addIssue({ code: "custom", path: ["models", modelIndex, "classifications"], message: "型号缺少确认所需覆盖维度" });
    }
  }

  for (const [unknownIndex, unknown] of content.unknowns.entries()) {
    const scope = unknown.scope;
    if (scope.type === "source" && !sourceIds.has(scope.sourceId)) {
      context.addIssue({ code: "custom", path: ["unknowns", unknownIndex, "scope"], message: "未知项引用了不存在的来源" });
    }
    if ((scope.type === "model" || scope.type === "model_dimension") && !modelKeys.has(scope.modelKey)) {
      context.addIssue({ code: "custom", path: ["unknowns", unknownIndex, "scope"], message: "未知项引用了不存在的型号" });
    }
  }
});

export const marketUniverseVersionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  categoryDefinitionVersionId: idSchema,
  confirmedScopeVersionId: idSchema,
  version: z.number().int().positive(),
  status: z.enum(["candidate", "confirmed", "superseded"]),
  contentHash: sha256Schema,
  createdAt: isoDateSchema,
  confirmedAt: isoDateSchema.optional(),
}).merge(marketUniverseContentObjectSchema).strict().superRefine((universe, context) => {
  const contentResult = marketUniverseContentSchema.safeParse(pickContent(universe));
  contentResult.error?.issues.forEach((issue) => context.addIssue(issue));
  if (universe.status !== "confirmed") return;
  if (!universe.confirmedAt) {
    context.addIssue({ code: "custom", path: ["confirmedAt"], message: "确认总体必须记录 confirmedAt" });
  }
  if (universe.unknowns.some((unknown) => unknown.blocking)) {
    context.addIssue({ code: "custom", path: ["unknowns"], message: "存在阻塞未知项的候选总体不能确认" });
  }
  if (universe.models.some((model) => model.identityStatus !== "confirmed")) {
    context.addIssue({ code: "custom", path: ["models"], message: "存在未核验型号身份的候选总体不能确认" });
  }
  const required = new Set(universe.coverageDimensions.filter((item) => item.requiredForConfirmation).map((item) => item.code));
  if (universe.models.some((model) => model.classifications.some(
    (classification) => required.has(classification.dimensionCode) && classification.status === "unknown",
  ))) {
    context.addIssue({ code: "custom", path: ["models"], message: "确认所需覆盖维度仍有未知分类" });
  }
});

function uniqueKeys(
  values: string[],
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
) {
  const unique = new Set(values);
  if (unique.size !== values.length) context.addIssue({ code: "custom", path, message });
  return unique;
}

function pickContent(universe: z.infer<typeof marketUniverseContentObjectSchema>) {
  const { basis, deduplicationRule, observationStartedAt, observationEndedAt, coverageDimensions, sources, models, unknowns } = universe;
  return { basis, deduplicationRule, observationStartedAt, observationEndedAt, coverageDimensions, sources, models, unknowns };
}

export type OfficialCatalogEntry = z.infer<typeof officialCatalogEntrySchema>;
export type OfficialCatalogSnapshot = z.infer<typeof officialCatalogSnapshotSchema>;
export type MarketUniverseClassification = z.infer<typeof marketUniverseClassificationSchema>;
export type MarketUniverseContent = z.infer<typeof marketUniverseContentSchema>;
export type MarketUniverseVersion = z.infer<typeof marketUniverseVersionSchema>;
export type MarketUniverseUnknown = z.infer<typeof marketUniverseUnknownSchema>;
export type RegulatoryCatalogOutcome = z.infer<typeof regulatoryCatalogOutcomeSchema>;
export type RegulatoryReconciliationRun = z.infer<typeof regulatoryReconciliationRunSchema>;
