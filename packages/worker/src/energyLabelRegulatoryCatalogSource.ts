import {
  officialCatalogSnapshotSchema,
  type RegulatoryCatalogOutcome,
  type OfficialCatalogSnapshot,
} from "@domain-analysis/shared";

import type {
  EnergyLabelRecordSource,
  EnergyLabelRegistration,
} from "./energyLabelRecordSource";
import { SourceAccessError } from "./sourceAccessError";

export interface RegulatoryCatalogModelInput {
  brand: string;
  manufacturerModel: string;
}

export interface RegulatoryCatalogReconciliation {
  snapshot: OfficialCatalogSnapshot;
  outcomes: RegulatoryCatalogOutcome[];
}

export interface EnergyLabelRegulatoryCatalogSource {
  reconcile(models: RegulatoryCatalogModelInput[]): Promise<RegulatoryCatalogReconciliation>;
}

export interface EnergyLabelRegulatoryCatalogSourceOptions {
  energyLabels: EnergyLabelRecordSource;
  maximumResponseBytes?: number;
  now?: () => Date;
}

export function createEnergyLabelRegulatoryCatalogSource(
  options: EnergyLabelRegulatoryCatalogSourceOptions,
): EnergyLabelRegulatoryCatalogSource {
  const maximumResponseBytes = options.maximumResponseBytes ?? 40_000;
  const now = options.now ?? (() => new Date());
  return {
    reconcile: (models) => reconcileModels(models, options.energyLabels, maximumResponseBytes, now),
  };
}

async function reconcileModels(
  rawModels: RegulatoryCatalogModelInput[],
  energyLabels: EnergyLabelRecordSource,
  maximumResponseBytes: number,
  now: () => Date,
): Promise<RegulatoryCatalogReconciliation> {
  const models = uniqueModels(rawModels);
  const outcomes: RegulatoryCatalogOutcome[] = [];
  const entries: OfficialCatalogSnapshot["entries"] = [];
  for (const model of models) {
    try {
      // TRADE-OFF：监管公开端点按型号查询；串行执行避免把一次市场刷新变成对公共服务的并发冲击。
      const registrations = await energyLabels.findRegistrationsByModel({
        productModel: model.manufacturerModel,
        maximumBytes: maximumResponseBytes,
      });
      entries.push(...toEntries(model, registrations, energyLabels.requestedUrl));
      outcomes.push(toOutcome(model, registrations));
    } catch (error) {
      outcomes.push({
        ...model,
        status: "failed",
        registrationCount: 0,
        producerNames: [],
        errorCode: error instanceof SourceAccessError ? error.code : "source_abnormal",
      });
    }
  }

  return {
    snapshot: officialCatalogSnapshotSchema.parse({
      sourceId: "china-energy-label-refrigerator-registry",
      sourceIdentity: "china-energy-label-public-registration",
      sourceAuthorityType: "regulatory_source",
      coverageKind: "regulatory_registry_lookup",
      catalogUrl: energyLabels.requestedUrl,
      observedAt: now().toISOString(),
      declaredItemCount: entries.length,
      fetchedItemCount: entries.length,
      acceptedItemCount: entries.length,
      coverageStatus: outcomes.every((outcome) => outcome.status === "matched") ? "complete" : "partial",
      entries,
    }),
    outcomes,
  };
}

function toEntries(
  model: RegulatoryCatalogModelInput,
  registrations: EnergyLabelRegistration[],
  sourceUrl: string,
): OfficialCatalogSnapshot["entries"] {
  return registrations.map((registration) => ({
    brand: model.brand,
    manufacturerModel: model.manufacturerModel,
    sourceItemId: registration.registrationNumber,
    sourceUrl,
    identityStatus: "confirmed",
    regulatoryProducer: {
      key: `producer:${encodeURIComponent(normalizeProducer(registration.producerName))}`,
      label: registration.producerName.trim(),
    },
  }));
}

function toOutcome(
  model: RegulatoryCatalogModelInput,
  registrations: EnergyLabelRegistration[],
): RegulatoryCatalogOutcome {
  const producerNames = [...new Set(registrations.map((item) => item.producerName.trim()))].sort();
  if (registrations.length === 0) {
    return { ...model, status: "not_found", registrationCount: 0, producerNames };
  }
  return {
    ...model,
    status: producerNames.length === 1 ? "matched" : "producer_conflict",
    registrationCount: registrations.length,
    producerNames,
  };
}

function uniqueModels(models: RegulatoryCatalogModelInput[]) {
  const unique = new Map<string, RegulatoryCatalogModelInput>();
  for (const model of models) {
    const normalized = {
      brand: model.brand.normalize("NFKC").trim(),
      manufacturerModel: model.manufacturerModel.normalize("NFKC").trim().toUpperCase(),
    };
    if (!normalized.brand || !normalized.manufacturerModel) continue;
    const key = `${normalized.brand.toLocaleLowerCase("zh-CN")}\u0000${normalized.manufacturerModel}`;
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()].sort((left, right) =>
    `${left.brand}\u0000${left.manufacturerModel}`.localeCompare(`${right.brand}\u0000${right.manufacturerModel}`));
}

function normalizeProducer(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}
