export function regulatoryRun() {
  return {
    id: "run-1",
    projectId: "project-1",
    sourceUniverse: { id: "universe-1", version: 1, contentHash: "a".repeat(64) },
    lifecycleStatus: "running",
    totalModels: 1,
    completedModels: 0,
    matchedModels: 0,
    notFoundModels: 0,
    failedModels: 0,
    producerConflictModels: 0,
    createdAt: "2026-08-16T12:00:00.000Z",
    updatedAt: "2026-08-16T12:00:00.000Z",
  };
}

export function sourceRun() {
  return {
    id: "run-1",
    projectId: "project-1",
    categoryDefinitionVersionId: "definition-1",
    confirmedScopeVersionId: "scope-1",
    collectionBoardVersionId: "board-1",
    categoryCode: "television",
    collectionLaneId: "lane-1",
    providerKey: "fixture-provider",
    sourceAuthorityType: "brand_official_site",
    accessPolicy: { kind: "manual", version: "v1" },
    status: "completed",
    snapshotCount: 1,
    accessibleCount: 1,
    failedCount: 0,
    assetCount: 0,
    startedAt: "2026-08-17T08:00:00.000Z",
    finishedAt: "2026-08-17T08:01:00.000Z",
  };
}

export function marketUniverse() {
  return {
    id: "universe-1", projectId: "project-1", categoryDefinitionVersionId: "definition-1",
    confirmedScopeVersionId: "scope-1", version: 1, status: "candidate",
    contentHash: "a".repeat(64), createdAt: "2026-08-16T12:00:00.000Z",
    basis: "official_active_assortment", deduplicationRule: "brand_and_manufacturer_model",
    observationStartedAt: "2026-08-16T12:00:00.000Z", observationEndedAt: "2026-08-16T12:00:00.000Z",
    coverageDimensions: [{ code: "regulatory_product_class", label: "国家标准产品类别", taxonomyVersion: "GB/T 8059-2025", requiredForConfirmation: true }],
    sources: [{ sourceId: "haier", sourceIdentity: "haier", sourceAuthorityType: "brand_official_site", coverageKind: "independent_brand_catalog",
      catalogUrl: "https://www.haier.com/cooling/", observedAt: "2026-08-16T12:00:00.000Z",
      declaredItemCount: 1, fetchedItemCount: 1, acceptedItemCount: 1, uniqueModelCount: 1, coverageStatus: "complete", observedBrandKeys: ["haier"] }],
    models: [{ key: "model:haier:bcd-500", brand: { key: "haier", label: "海尔" }, manufacturerModel: "BCD-500", identityStatus: "confirmed", regulatoryProducers: [],
      classifications: [{ dimensionCode: "regulatory_product_class", status: "classified", valueCode: "combination_refrigerator", valueLabel: "组合式冷藏冷冻箱" }],
      sourceRefs: [{ sourceId: "haier", sourceItemId: "1", sourceUrl: "https://www.haier.com/cooling/1.shtml" }] }],
    unknowns: [],
  };
}
