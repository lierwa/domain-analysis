import { randomUUID } from "node:crypto";

import { marketUniverseVersions, type ProductKnowledgeDb } from "@domain-analysis/db";
import {
  marketUniverseContentSchema,
  marketUniverseDimensionCodes,
  marketUniverseVersionSchema,
  officialCatalogSnapshotSchema,
  type MarketUniverseContent,
  type MarketUniverseUnknown,
  type MarketUniverseVersion,
  type OfficialCatalogSnapshot,
  type RegulatoryCatalogOutcome,
} from "@domain-analysis/shared";
import { and, desc, eq } from "drizzle-orm";

import { contentHash } from "./contentHash";
import { mergeProducer, mergeRegulatoryContent, toSourceSummary } from "./marketUniverseContentProjection";
import { ProductProjectError, type ProductProjectModule } from "./productProjectModule";

export interface MarketUniverseModule {
  latest(projectId: string): Promise<MarketUniverseVersion | null>;
  refreshCandidate(
    projectId: string,
    snapshots: OfficialCatalogSnapshot[],
    unknowns: MarketUniverseUnknown[],
  ): Promise<MarketUniverseVersion>;
  confirmCandidate(
    projectId: string,
    expectedVersion: number,
    expectedContentHash: string,
  ): Promise<MarketUniverseVersion>;
  applyRegulatoryReconciliation(input: ApplyRegulatoryReconciliationInput): Promise<MarketUniverseVersion>;
}

export interface ApplyRegulatoryReconciliationInput {
  projectId: string;
  expectedUniverse: { id: string; version: number; contentHash: string };
  operationId: string;
  snapshot: OfficialCatalogSnapshot;
  outcomes: RegulatoryCatalogOutcome[];
}

export interface MarketUniverseModuleOptions {
  now?: () => Date;
  createId?: () => string;
}

export type MarketUniverseErrorCode =
  | "project_not_confirmed"
  | "source_outside_policy"
  | "unsupported_category"
  | "candidate_changed"
  | "candidate_blocked";

export class MarketUniverseError extends Error {
  constructor(readonly code: MarketUniverseErrorCode, message: string) {
    super(message);
    this.name = "MarketUniverseError";
  }
}

export function createMarketUniverseModule(
  db: ProductKnowledgeDb,
  projects: ProductProjectModule,
  options: MarketUniverseModuleOptions = {},
): MarketUniverseModule {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => `universe-${randomUUID()}`);
  return {
    latest: (projectId) => loadLatest(db, projectId),
    refreshCandidate: (projectId, snapshots, unknowns) => refreshCandidate(
      db,
      projects,
      projectId,
      snapshots,
      unknowns,
      now,
      createId,
    ),
    confirmCandidate: (projectId, expectedVersion, expectedContentHash) => confirmCandidate(
      db,
      projectId,
      expectedVersion,
      expectedContentHash,
      now,
    ),
    applyRegulatoryReconciliation: (input) => applyRegulatoryReconciliation(
      db,
      input,
      now,
    ),
  };
}

const coverageDimensions: MarketUniverseContent["coverageDimensions"] = [
  {
    code: "regulatory_product_class",
    label: "国家标准产品类别",
    taxonomyVersion: "GB/T 8059-2025",
    requiredForConfirmation: true,
  },
  {
    code: "installation_form",
    label: "安装形态",
    taxonomyVersion: "workbench-refrigerator-v1",
    requiredForConfirmation: false,
  },
  {
    code: "door_layout",
    label: "门体布局",
    taxonomyVersion: "workbench-refrigerator-v1",
    requiredForConfirmation: false,
  },
];

async function refreshCandidate(
  db: ProductKnowledgeDb,
  projects: ProductProjectModule,
  projectId: string,
  rawSnapshots: OfficialCatalogSnapshot[],
  unknowns: MarketUniverseUnknown[],
  now: () => Date,
  createId: () => string,
) {
  const project = await projects.get(projectId);
  if (!project) throw new ProductProjectError("not_found", `项目不存在：${projectId}`);
  if (project.project.status !== "ready") {
    throw new MarketUniverseError("project_not_confirmed", "市场总体只能绑定已确认项目");
  }
  const snapshots = officialCatalogSnapshotSchema.array().min(1).parse(rawSnapshots);
  const allowedSources = new Set(project.categoryDefinition.sourceAuthorityPolicy);
  if (snapshots.some((snapshot) => !allowedSources.has(snapshot.sourceAuthorityType))) {
    throw new MarketUniverseError("source_outside_policy", "官方目录来源不在已确认来源政策内");
  }
  const previous = await loadLatest(db, projectId);
  const content = buildContent(snapshots, unknowns);
  const createdAt = now().toISOString();
  const version = marketUniverseVersionSchema.parse({
    id: createId(),
    projectId,
    categoryDefinitionVersionId: project.categoryDefinition.id,
    confirmedScopeVersionId: project.confirmedScope.id,
    version: (previous?.version ?? 0) + 1,
    status: "candidate",
    contentHash: contentHash(content),
    createdAt,
    ...content,
  });

  await db.transaction(async (transaction) => {
    // WHY：刷新只替换旧候选，不触碰未来已确认版本；审核中的新候选和冻结基线必须能并存。
    await transaction.update(marketUniverseVersions).set({ status: "superseded" }).where(and(
      eq(marketUniverseVersions.projectId, projectId),
      eq(marketUniverseVersions.status, "candidate"),
    ));
    await transaction.insert(marketUniverseVersions).values(toRow(version));
  });
  return version;
}

function buildContent(
  snapshots: OfficialCatalogSnapshot[],
  unknowns: MarketUniverseUnknown[],
): MarketUniverseContent {
  const models = new Map<string, MarketUniverseContent["models"][number]>();
  const classificationConflicts = new Set<string>();
  const generatedUnknowns: MarketUniverseUnknown[] = [];
  for (const snapshot of snapshots) {
    for (const entry of snapshot.entries) {
      const identity = `${normalizeBrand(entry.brand)}\u0000${normalizeModel(entry.manufacturerModel)}`;
      const existing = models.get(identity);
      const sourceRef = {
        sourceId: snapshot.sourceId,
        sourceItemId: entry.sourceItemId,
        sourceUrl: entry.sourceUrl,
      };
      if (existing) {
        existing.sourceRefs.push(sourceRef);
        if (isConfirmedIdentity(snapshot.sourceAuthorityType, entry.identityStatus)) {
          existing.identityStatus = "confirmed";
        }
        mergeProducer(existing, entry.regulatoryProducer);
        mergeClassifications(existing, entry.classifications ?? [], classificationConflicts, generatedUnknowns);
      } else {
        const model = {
          key: modelKey(entry.brand, entry.manufacturerModel),
          brand: { key: normalizeBrand(entry.brand), label: entry.brand.trim() },
          manufacturerModel: entry.manufacturerModel.trim(),
          identityStatus: isConfirmedIdentity(snapshot.sourceAuthorityType, entry.identityStatus)
            ? "confirmed" as const
            : "unconfirmed" as const,
          regulatoryProducers: entry.regulatoryProducer ? [entry.regulatoryProducer] : [],
          classifications: marketUniverseDimensionCodes.map((dimensionCode) => ({
            dimensionCode,
            status: "unknown" as const,
          })),
          sourceRefs: [sourceRef],
        };
        mergeClassifications(model, entry.classifications ?? [], classificationConflicts, generatedUnknowns);
        models.set(identity, model);
      }
    }
  }
  const observations = snapshots.map((snapshot) => snapshot.observedAt).sort();
  return marketUniverseContentSchema.parse({
    basis: "official_active_assortment",
    deduplicationRule: "brand_and_manufacturer_model",
    observationStartedAt: observations[0],
    observationEndedAt: observations.at(-1),
    coverageDimensions,
    sources: snapshots.map(toSourceSummary),
    models: [...models.values()].sort((left, right) => left.key.localeCompare(right.key)),
    unknowns: [...unknowns, ...generatedUnknowns],
  });
}

async function applyRegulatoryReconciliation(
  db: ProductKnowledgeDb,
  input: ApplyRegulatoryReconciliationInput,
  now: () => Date,
) {
  const existing = await loadById(db, input.operationId);
  if (existing) {
    if (existing.projectId !== input.projectId) {
      throw new MarketUniverseError("candidate_changed", "监管对账幂等键已用于其他项目");
    }
    return existing;
  }
  const base = await loadLatest(db, input.projectId);
  if (!base || base.status !== "candidate"
    || base.id !== input.expectedUniverse.id
    || base.version !== input.expectedUniverse.version
    || base.contentHash !== input.expectedUniverse.contentHash) {
    throw new MarketUniverseError("candidate_changed", "监管对账绑定的候选总体已变化");
  }
  const snapshot = officialCatalogSnapshotSchema.parse(input.snapshot);
  if (snapshot.sourceAuthorityType !== "regulatory_source"
    || snapshot.coverageKind !== "regulatory_registry_lookup") {
    throw new MarketUniverseError("source_outside_policy", "监管对账只能提交监管按型号查询来源");
  }
  let content: MarketUniverseContent;
  try {
    content = mergeRegulatoryContent(base, snapshot, input.outcomes);
  } catch (error) {
    throw new MarketUniverseError(
      "candidate_changed",
      error instanceof Error ? error.message : "监管结果无法合并到候选总体",
    );
  }
  const createdAt = now().toISOString();
  const next = marketUniverseVersionSchema.parse({
    id: input.operationId,
    projectId: input.projectId,
    categoryDefinitionVersionId: base.categoryDefinitionVersionId,
    confirmedScopeVersionId: base.confirmedScopeVersionId,
    version: base.version + 1,
    status: "candidate",
    contentHash: contentHash(content),
    createdAt,
    ...content,
  });

  await db.transaction(async (transaction) => {
    const superseded = await transaction.update(marketUniverseVersions).set({ status: "superseded" }).where(and(
      eq(marketUniverseVersions.id, base.id),
      eq(marketUniverseVersions.status, "candidate"),
      eq(marketUniverseVersions.contentHash, base.contentHash),
    )).returning({ id: marketUniverseVersions.id });
    if (superseded.length !== 1) {
      throw new MarketUniverseError("candidate_changed", "监管对账写入前候选总体已变化");
    }
    await transaction.insert(marketUniverseVersions).values(toRow(next));
  });
  return next;
}


async function confirmCandidate(
  db: ProductKnowledgeDb,
  projectId: string,
  expectedVersion: number,
  expectedContentHash: string,
  now: () => Date,
) {
  const candidate = await loadLatest(db, projectId);
  if (!candidate || candidate.status !== "candidate"
    || candidate.version !== expectedVersion || candidate.contentHash !== expectedContentHash) {
    throw new MarketUniverseError("candidate_changed", "候选总体已变化，请刷新后重新审核");
  }
  const confirmedAt = now().toISOString();
  let confirmed: MarketUniverseVersion;
  try {
    confirmed = marketUniverseVersionSchema.parse({ ...candidate, status: "confirmed", confirmedAt });
  } catch {
    throw new MarketUniverseError("candidate_blocked", "候选总体仍有阻塞未知项、未核验身份或必填分类");
  }

  await db.transaction(async (transaction) => {
    // WHY：先标记旧确认版，再以 candidate 状态作乐观锁；后者失败会回滚整个事务。
    await transaction.update(marketUniverseVersions).set({ status: "superseded" }).where(and(
      eq(marketUniverseVersions.projectId, projectId),
      eq(marketUniverseVersions.status, "confirmed"),
    ));
    const updated = await transaction.update(marketUniverseVersions).set({
      status: "confirmed",
      confirmedAt,
    }).where(and(
      eq(marketUniverseVersions.id, candidate.id),
      eq(marketUniverseVersions.status, "candidate"),
    )).returning({ id: marketUniverseVersions.id });
    if (updated.length !== 1) {
      throw new MarketUniverseError("candidate_changed", "候选总体已被其他操作更新");
    }
  });
  return confirmed;
}

function mergeClassifications(
  model: MarketUniverseContent["models"][number],
  incoming: NonNullable<OfficialCatalogSnapshot["entries"][number]["classifications"]>,
  conflicts: Set<string>,
  unknowns: MarketUniverseUnknown[],
) {
  for (const classification of incoming) {
    const conflictKey = `${model.key}\u0000${classification.dimensionCode}`;
    if (conflicts.has(conflictKey)) continue;
    const index = model.classifications.findIndex((item) => item.dimensionCode === classification.dimensionCode);
    const current = model.classifications[index];
    if (!current || current.status === "unknown") {
      model.classifications[index] = classification;
      continue;
    }
    if (JSON.stringify(current) === JSON.stringify(classification)) continue;
    conflicts.add(conflictKey);
    model.classifications[index] = { dimensionCode: classification.dimensionCode, status: "unknown" };
    unknowns.push({
      key: `classification-conflict:${encodeURIComponent(model.key)}:${classification.dimensionCode}`,
      kind: "classification",
      scope: { type: "model_dimension", modelKey: model.key, dimensionCode: classification.dimensionCode },
      blocking: true,
      description: `${model.brand.label} ${model.manufacturerModel} 的${classification.dimensionCode}存在来源冲突。`,
      requiredSourceAuthorityTypes: ["brand_official_site", "regulatory_source"],
    });
  }
}

function isConfirmedIdentity(
  sourceAuthorityType: OfficialCatalogSnapshot["sourceAuthorityType"],
  declaredStatus: "confirmed" | "unconfirmed" | undefined,
) {
  return declaredStatus === "confirmed"
    || sourceAuthorityType === "brand_official_site"
    || sourceAuthorityType === "regulatory_source";
}

async function loadLatest(db: ProductKnowledgeDb, projectId: string) {
  const row = await db.query.marketUniverseVersions.findFirst({
    where: eq(marketUniverseVersions.projectId, projectId),
    orderBy: [desc(marketUniverseVersions.version)],
  });
  if (!row) return null;
  const { content, confirmedAt, ...metadata } = row;
  return marketUniverseVersionSchema.parse({
    ...metadata,
    createdAt: new Date(metadata.createdAt).toISOString(),
    ...(confirmedAt ? { confirmedAt: new Date(confirmedAt).toISOString() } : {}),
    ...content,
  });
}

async function loadById(db: ProductKnowledgeDb, id: string) {
  const row = await db.query.marketUniverseVersions.findFirst({
    where: eq(marketUniverseVersions.id, id),
  });
  return row ? fromRow(row) : null;
}

function fromRow(row: typeof marketUniverseVersions.$inferSelect) {
  const { content, confirmedAt, ...metadata } = row;
  return marketUniverseVersionSchema.parse({
    ...metadata,
    createdAt: new Date(metadata.createdAt).toISOString(),
    ...(confirmedAt ? { confirmedAt: new Date(confirmedAt).toISOString() } : {}),
    ...content,
  });
}

function toRow(version: MarketUniverseVersion) {
  const {
    basis, deduplicationRule, observationStartedAt, observationEndedAt, coverageDimensions, sources, models, unknowns,
    ...metadata
  } = version;
  return {
    ...metadata,
    confirmedAt: version.confirmedAt ?? null,
    content: {
      basis,
      deduplicationRule,
      observationStartedAt,
      observationEndedAt,
      coverageDimensions,
      sources,
      models,
      unknowns,
    },
  };
}

function modelKey(brand: string, manufacturerModel: string) {
  return `model:${encodeURIComponent(normalizeBrand(brand))}:${encodeURIComponent(normalizeModel(manufacturerModel))}`;
}

function normalizeBrand(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

function normalizeModel(value: string) {
  return value.normalize("NFKC").trim().toUpperCase();
}
