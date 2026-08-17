import {
  marketUniverseContentSchema,
  type MarketUniverseContent,
  type MarketUniverseVersion,
  type OfficialCatalogSnapshot,
  type RegulatoryCatalogOutcome,
} from "@domain-analysis/shared";

export function mergeRegulatoryContent(
  base: MarketUniverseVersion,
  snapshot: OfficialCatalogSnapshot,
  rawOutcomes: RegulatoryCatalogOutcome[],
): MarketUniverseContent {
  const models = base.models.map((model) => ({
    ...model,
    regulatoryProducers: [...model.regulatoryProducers],
    classifications: [...model.classifications],
    sourceRefs: [...model.sourceRefs],
  }));
  const byIdentity = new Map(models.map((model) => [modelIdentity(model.brand.label, model.manufacturerModel), model]));
  const outcomeIdentities = new Set<string>();
  for (const outcome of rawOutcomes) {
    const identity = modelIdentity(outcome.brand, outcome.manufacturerModel);
    if (outcomeIdentities.has(identity) || !byIdentity.has(identity)) {
      throw new Error("监管结果重复或引用了候选总体外型号");
    }
    outcomeIdentities.add(identity);
  }
  if (outcomeIdentities.size !== models.length) throw new Error("监管结果未覆盖候选总体全部型号");

  for (const entry of snapshot.entries) {
    const model = byIdentity.get(modelIdentity(entry.brand, entry.manufacturerModel));
    if (!model) throw new Error("监管来源包含候选总体外型号");
    const sourceRef = { sourceId: snapshot.sourceId, sourceItemId: entry.sourceItemId, sourceUrl: entry.sourceUrl };
    if (!model.sourceRefs.some((item) => item.sourceId === sourceRef.sourceId
      && item.sourceItemId === sourceRef.sourceItemId)) model.sourceRefs.push(sourceRef);
    mergeProducer(model, entry.regulatoryProducer);
    model.identityStatus = "confirmed";
  }
  const scopedUnknowns = rawOutcomes.filter((outcome) => outcome.status !== "matched").map((outcome) => {
    const model = byIdentity.get(modelIdentity(outcome.brand, outcome.manufacturerModel))!;
    return {
      key: `regulatory-lookup:${outcome.status}:${encodeURIComponent(model.key)}`,
      kind: outcome.status === "failed" ? "source_access" as const : "model_identity" as const,
      scope: { type: "model" as const, modelKey: model.key },
      blocking: true,
      description: regulatoryOutcomeDescription(outcome),
      requiredSourceAuthorityTypes: ["regulatory_source" as const],
    };
  });
  const observations = [base.observationStartedAt, base.observationEndedAt, snapshot.observedAt].sort();
  return marketUniverseContentSchema.parse({
    basis: base.basis,
    deduplicationRule: base.deduplicationRule,
    observationStartedAt: observations[0],
    observationEndedAt: observations.at(-1),
    coverageDimensions: base.coverageDimensions,
    sources: [...base.sources.filter((source) => source.sourceId !== snapshot.sourceId), toSourceSummary(snapshot)],
    models,
    unknowns: [
      ...base.unknowns.filter((unknown) => unknown.key !== "regulatory-active-intersection"
        && !unknown.key.startsWith("regulatory-lookup:")),
      ...scopedUnknowns,
    ],
  });
}

export function toSourceSummary(snapshot: OfficialCatalogSnapshot): MarketUniverseContent["sources"][number] {
  return {
    sourceId: snapshot.sourceId,
    sourceIdentity: snapshot.sourceIdentity,
    sourceAuthorityType: snapshot.sourceAuthorityType,
    coverageKind: snapshot.coverageKind,
    catalogUrl: snapshot.catalogUrl,
    observedAt: snapshot.observedAt,
    declaredItemCount: snapshot.declaredItemCount,
    fetchedItemCount: snapshot.fetchedItemCount,
    acceptedItemCount: snapshot.acceptedItemCount,
    coverageStatus: snapshot.coverageStatus,
    observedBrandKeys: [...new Set(snapshot.entries.map((entry) => normalizeBrand(entry.brand)))].sort(),
    uniqueModelCount: new Set(snapshot.entries.map((entry) => modelIdentity(entry.brand, entry.manufacturerModel))).size,
  };
}

export function mergeProducer(
  model: MarketUniverseContent["models"][number],
  producer: MarketUniverseContent["models"][number]["regulatoryProducers"][number] | undefined,
) {
  if (producer && !model.regulatoryProducers.some((item) => item.key === producer.key)) {
    model.regulatoryProducers.push(producer);
  }
}

function regulatoryOutcomeDescription(outcome: RegulatoryCatalogOutcome) {
  if (outcome.status === "not_found") return `${outcome.brand} ${outcome.manufacturerModel} 未找到能效备案记录。`;
  if (outcome.status === "producer_conflict") return `${outcome.brand} ${outcome.manufacturerModel} 的备案生产者存在冲突。`;
  return `${outcome.brand} ${outcome.manufacturerModel} 的能效备案访问失败：${outcome.errorCode ?? "source_abnormal"}。`;
}

function modelIdentity(brand: string, manufacturerModel: string) {
  return `${normalizeBrand(brand)}\u0000${normalizeModel(manufacturerModel)}`;
}

function normalizeBrand(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

function normalizeModel(value: string) {
  return value.normalize("NFKC").trim().toUpperCase();
}
