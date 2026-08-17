import {
  marketUniverseVersionSchema,
  type MarketUniverseVersion,
  type OfficialCatalogSnapshot,
} from "@domain-analysis/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openMarketUniverseRegulatoryPipeline,
  type OpenedMarketUniverseRegulatoryPipeline,
  type RegulatoryCatalogReconcilerPort,
} from "../src/marketUniverseRegulatoryPipelineModule";
import type { MarketUniverseModule } from "../src/marketUniverseModule";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithDbos = databaseUrl ? describe.sequential : describe.skip;
const sourceCalls: string[] = [];
let activeCalls = 0;
let maximumActiveCalls = 0;
let sourceDelayMs = 20;
let appliedInput: Parameters<MarketUniverseModule["applyRegulatoryReconciliation"]>[0] | undefined;
let candidate = createCandidate();
let opened: OpenedMarketUniverseRegulatoryPipeline;

describeWithDbos("MarketUniverseRegulatoryPipelineModule", () => {
  beforeAll(async () => {
    opened = await openMarketUniverseRegulatoryPipeline({
      systemDatabaseUrl: databaseUrl!,
      systemDatabaseSchemaName: `domain_analysis_regulatory_test_${process.pid}_${Date.now()}`,
      workflowName: `marketUniverseRegulatoryTest${process.pid}${Date.now()}`,
      childWorkflowName: `marketUniverseRegulatoryChildTest${process.pid}${Date.now()}`,
      queueName: `market-universe-regulatory-test-${process.pid}-${Date.now()}`,
      marketUniverses: createMarketUniverses(),
      source: createSource(),
      commandTimeoutSeconds: 15,
    });
  }, 30_000);

  afterAll(async () => opened?.close());

  it("冻结候选、逐型号串行恢复并幂等生成一个新候选", async () => {
    const sourceUniverse = {
      id: candidate.id,
      version: candidate.version,
      contentHash: candidate.contentHash,
    };
    const started = await opened.module.start(candidate.projectId, "local-user");
    const duplicate = await opened.module.start(candidate.projectId, "local-user");
    expect(duplicate.id).toBe(started.id);
    const succeeded = await waitFor(started.id, (run) => run.lifecycleStatus === "succeeded");

    expect(succeeded).toMatchObject({
      totalModels: 3,
      completedModels: 3,
      matchedModels: 1,
      notFoundModels: 1,
      producerConflictModels: 1,
      outputUniverseVersion: 2,
    });
    expect(maximumActiveCalls).toBe(1);
    expect(sourceCalls).toEqual(["MODEL-A", "MODEL-B", "MODEL-C"]);
    expect(appliedInput?.expectedUniverse).toEqual(sourceUniverse);
    expect(appliedInput?.operationId).toBe(started.id);
    expect(appliedInput?.outcomes).toHaveLength(3);
    expect(candidate.id).toBe(started.id);
    await expect(opened.module.latest(candidate.projectId)).resolves.toMatchObject({
      id: started.id,
      lifecycleStatus: "succeeded",
    });
    expect(sourceCalls).toHaveLength(3);
  }, 30_000);

  it("取消父任务时只停止当前子任务，未开始型号不再继续访问", async () => {
    candidate = createCandidate("universe-cancel", "c".repeat(64));
    sourceCalls.length = 0;
    appliedInput = undefined;
    sourceDelayMs = 250;

    const started = await opened.module.start(candidate.projectId, "local-user");
    const cancelled = await opened.module.cancel(started.id);
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(cancelled.lifecycleStatus).toBe("cancelled");
    expect(sourceCalls.length).toBeLessThanOrEqual(1);
    expect(appliedInput).toBeUndefined();
    await expect(opened.module.latest(candidate.projectId)).resolves.toMatchObject({
      id: started.id,
      lifecycleStatus: "cancelled",
    });
    sourceDelayMs = 20;
  }, 30_000);
});

function createMarketUniverses(): MarketUniverseModule {
  return {
    latest: async () => candidate,
    refreshCandidate: async () => { throw new Error("测试不应刷新候选"); },
    confirmCandidate: async () => { throw new Error("测试不应确认候选"); },
    applyRegulatoryReconciliation: async (input) => {
      appliedInput = input;
      candidate = marketUniverseVersionSchema.parse({
        ...candidate,
        id: input.operationId,
        version: candidate.version + 1,
        contentHash: "b".repeat(64),
      });
      return candidate;
    },
  };
}

function createSource(): RegulatoryCatalogReconcilerPort {
  return {
    reconcile: async ([model]) => {
      activeCalls += 1;
      maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
      sourceCalls.push(model!.manufacturerModel);
      await new Promise((resolve) => setTimeout(resolve, sourceDelayMs));
      activeCalls -= 1;
      const status = model!.manufacturerModel === "MODEL-A"
        ? "matched"
        : model!.manufacturerModel === "MODEL-B" ? "not_found" : "producer_conflict";
      const producerNames = status === "matched"
        ? ["生产者 A"]
        : status === "producer_conflict" ? ["生产者 C1", "生产者 C2"] : [];
      return {
        snapshot: regulatorySnapshot(model!.brand, model!.manufacturerModel, producerNames),
        outcomes: [{
          ...model!,
          status,
          registrationCount: producerNames.length,
          producerNames,
        }],
      };
    },
  };
}

function regulatorySnapshot(
  brand: string,
  manufacturerModel: string,
  producerNames: string[],
): OfficialCatalogSnapshot {
  return {
    sourceId: "china-energy-label-refrigerator-registry",
    sourceIdentity: "china-energy-label-public-registration",
    sourceAuthorityType: "regulatory_source",
    coverageKind: "regulatory_registry_lookup",
    catalogUrl: "https://www.energylabel.com.cn/",
    observedAt: "2026-08-16T13:00:00.000Z",
    declaredItemCount: producerNames.length,
    fetchedItemCount: producerNames.length,
    acceptedItemCount: producerNames.length,
    coverageStatus: producerNames.length > 0 ? "complete" : "partial",
    entries: producerNames.map((producer, index) => ({
      brand,
      manufacturerModel,
      sourceItemId: `${manufacturerModel}-${index}`,
      sourceUrl: "https://www.energylabel.com.cn/",
      identityStatus: "confirmed",
      regulatoryProducer: { key: `producer:${index}`, label: producer },
    })),
  };
}

function createCandidate(id = "universe-v1", hash = "a".repeat(64)): MarketUniverseVersion {
  const models = ["MODEL-A", "MODEL-B", "MODEL-C"].map((manufacturerModel) => ({
    key: `brand:test\u0000${manufacturerModel}`,
    brand: { key: "brand:test", label: "测试品牌" },
    manufacturerModel,
    identityStatus: "unconfirmed" as const,
    regulatoryProducers: [],
    classifications: [
      { dimensionCode: "regulatory_product_class" as const, status: "unknown" as const },
      { dimensionCode: "installation_form" as const, status: "unknown" as const },
      { dimensionCode: "door_layout" as const, status: "unknown" as const },
    ],
    sourceRefs: [{ sourceId: "official-test", sourceItemId: manufacturerModel, sourceUrl: "https://example.com/" }],
  }));
  return marketUniverseVersionSchema.parse({
    id,
    projectId: "project-regulatory-test",
    categoryDefinitionVersionId: "definition-v1",
    confirmedScopeVersionId: "scope-v1",
    version: 1,
    status: "candidate",
    contentHash: hash,
    createdAt: "2026-08-16T12:00:00.000Z",
    basis: "official_active_assortment",
    deduplicationRule: "brand_and_manufacturer_model",
    observationStartedAt: "2026-08-16T12:00:00.000Z",
    observationEndedAt: "2026-08-16T12:00:00.000Z",
    coverageDimensions: [
      { code: "regulatory_product_class", label: "产品类别", taxonomyVersion: "v1", requiredForConfirmation: true },
      { code: "installation_form", label: "安装形式", taxonomyVersion: "v1", requiredForConfirmation: true },
      { code: "door_layout", label: "门体形式", taxonomyVersion: "v1", requiredForConfirmation: true },
    ],
    sources: [{
      sourceId: "official-test",
      sourceIdentity: "official-test",
      sourceAuthorityType: "brand_official_site",
      coverageKind: "independent_brand_catalog",
      catalogUrl: "https://example.com/",
      observedAt: "2026-08-16T12:00:00.000Z",
      declaredItemCount: 3,
      fetchedItemCount: 3,
      acceptedItemCount: 3,
      coverageStatus: "complete",
      uniqueModelCount: 3,
      observedBrandKeys: ["brand:test"],
    }],
    models,
    unknowns: [],
  });
}

async function waitFor(
  runId: string,
  predicate: (run: NonNullable<Awaited<ReturnType<typeof opened.module.get>>>) => boolean,
) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const run = await opened.module.get(runId);
    if (run && predicate(run)) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待监管对账超时：${runId}`);
}
