import {
  marketUniverseVersionSchema,
  sourceCollectionRunSchema,
  sourceSnapshotRecordSchema,
  type CommitSourceSnapshot,
  type MarketUniverseVersion,
  type SourceCollectionRun,
  type SourceCollectionWorkItem,
} from "@domain-analysis/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openProductKnowledgePipelineRuntime,
  type ProductKnowledgePipelineRuntime,
} from "../src/productKnowledgePipelineRuntime";
import type { MarketUniverseModule } from "../src/marketUniverseModule";
import type { SourceDatasetModule } from "../src/sourceDatasetModule";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithDbos = databaseUrl ? describe.sequential : describe.skip;
let runtime: ProductKnowledgePipelineRuntime;

describeWithDbos("ProductKnowledgePipelineRuntime", () => {
  const sourceDatasets = fakeSourceDatasets();
  let candidate = marketCandidate();

  beforeAll(async () => {
    runtime = await openProductKnowledgePipelineRuntime({
      systemDatabaseUrl: databaseUrl!,
      systemDatabaseSchemaName: `domain_analysis_combined_runtime_${process.pid}_${Date.now()}`,
      regulatory: {
        workflowName: `combinedRegulatory${process.pid}${Date.now()}`,
        childWorkflowName: `combinedRegulatoryItem${process.pid}${Date.now()}`,
        queueName: `combined-regulatory-${process.pid}-${Date.now()}`,
        marketUniverses: {
          latest: async () => candidate,
          refreshCandidate: async () => { throw new Error("fixture 不刷新总体"); },
          confirmCandidate: async () => { throw new Error("fixture 不确认总体"); },
          applyRegulatoryReconciliation: async (input) => {
            candidate = marketUniverseVersionSchema.parse({
              ...candidate,
              id: input.operationId,
              version: 2,
              contentHash: "b".repeat(64),
            });
            return candidate;
          },
        } as MarketUniverseModule,
        source: {
          reconcile: async ([model]) => ({
            snapshot: {
              sourceId: "regulatory-fixture",
              sourceIdentity: "regulatory-fixture",
              sourceAuthorityType: "regulatory_source",
              coverageKind: "regulatory_registry_lookup",
              catalogUrl: "https://example.com/regulatory",
              observedAt: "2026-08-17T08:00:00.000Z",
              declaredItemCount: 0,
              fetchedItemCount: 0,
              acceptedItemCount: 0,
              coverageStatus: "partial",
              entries: [],
            },
            outcomes: [{
              ...model!,
              status: "not_found",
              registrationCount: 0,
              producerNames: [],
            }],
          }),
        },
      },
      sourceCollection: {
        workflowName: `combinedSourceCollection${process.pid}${Date.now()}`,
        childWorkflowName: `combinedSourceCollectionItem${process.pid}${Date.now()}`,
        queueName: `combined-source-${process.pid}-${Date.now()}`,
        sourceDatasets: sourceDatasets.module,
        source: {
          collect: async ({ item }) => ({
            accessStartedAt: "2026-08-17T08:00:00.000Z",
            accessFinishedAt: "2026-08-17T08:00:00.001Z",
            observation: {
              requestedUrl: item.requestedUrl,
              finalUrl: item.requestedUrl,
              observedAt: "2026-08-17T08:00:00.001Z",
              state: "accessible",
            },
            content: {
              kind: "ordered_record",
              title: item.object.externalKey,
              fieldGroups: [{ label: "规格", fields: [{ name: "型号", value: item.object.externalKey }] }],
              blocks: [],
            },
            relations: [],
            stopRun: false,
          }),
          cancel: () => undefined,
        },
      },
    });
  }, 30_000);

  afterAll(async () => runtime?.close());

  it("同一 DBOS runtime 可同时执行监管与跨品类来源采集 workflow", async () => {
    const [regulatory, sourceCollection] = await Promise.all([
      runtime.marketUniverseRegulatory.start(candidate.projectId, "local-user"),
      runtime.sourceCollection.start({
        sourceRunId: sourceDatasets.run.id,
        workItems: [sourceWorkItem()],
      }),
    ]);
    const [completedRegulatory, completedSource] = await Promise.all([
      waitFor(() => runtime.marketUniverseRegulatory.get(regulatory.id), "succeeded"),
      waitFor(() => runtime.sourceCollection.get(sourceCollection.id), "succeeded"),
    ]);

    expect(completedRegulatory).toMatchObject({ completedModels: 1, notFoundModels: 1 });
    expect(completedSource).toMatchObject({ completedItems: 1 });
    expect(sourceDatasets.commits.map((input) => input.idempotencyKey)).toEqual(["item-TV-1"]);
    expect(sourceDatasets.run.status).toBe("completed");
  }, 30_000);
});

function fakeSourceDatasets() {
  let run = sourceCollectionRunSchema.parse({
    id: "combined-source-run",
    projectId: "combined-tv-project",
    categoryDefinitionVersionId: "combined-tv-definition",
    confirmedScopeVersionId: "combined-tv-scope",
    collectionBoardVersionId: "combined-tv-board",
    categoryCode: "television",
    collectionLaneId: "combined-tv-lane",
    providerKey: "fixture-provider",
    sourceAuthorityType: "brand_official_site",
    accessPolicy: { kind: "manual", version: "fixture-v1" },
    status: "running",
    snapshotCount: 0,
    accessibleCount: 0,
    failedCount: 0,
    assetCount: 0,
    startedAt: "2026-08-17T08:00:00.000Z",
  });
  const commits: CommitSourceSnapshot[] = [];
  const module: SourceDatasetModule = {
    savePlan: async () => { throw new Error("fixture 不保存计划"); },
    getPlan: async () => null,
    listPlans: async () => [],
    startRun: async () => { throw new Error("fixture 不创建运行"); },
    commitSnapshot: async (input) => {
      commits.push(input);
      const { object, ...snapshotInput } = input;
      run = sourceCollectionRunSchema.parse({
        ...run,
        snapshotCount: run.snapshotCount + 1,
        accessibleCount: run.accessibleCount + 1,
      });
      return sourceSnapshotRecordSchema.parse({
        object: { id: "object-TV-1", projectId: run.projectId, ...object, createdAt: input.observation.observedAt },
        snapshot: {
          id: "snapshot-TV-1",
          ...snapshotInput,
          objectId: "object-TV-1",
          contentHash: "a".repeat(64),
          createdAt: input.observation.observedAt,
        },
        assets: [],
      });
    },
    commitAsset: async () => { throw new Error("fixture 不提交附件"); },
    finishRun: async (input) => {
      run = sourceCollectionRunSchema.parse({
        ...run,
        status: input.status,
        terminationReason: input.terminationReason,
        finishedAt: "2026-08-17T08:01:00.000Z",
      });
      return run;
    },
    getRun: async (runId) => runId === run.id ? { run, records: [] } : null,
    getSnapshot: async () => null,
    listProject: async () => [run],
    exportRun: async function* () { yield ""; },
  };
  return {
    module,
    commits,
    get run(): SourceCollectionRun { return run; },
  };
}

function sourceWorkItem(): SourceCollectionWorkItem {
  return {
    id: "item-TV-1",
    object: { sourceIdentity: "fixture", kind: "product", externalKey: "TV-1" },
    requestedUrl: "https://example.com/television/TV-1",
    targetKeys: ["category:television"],
    knowledgeNeedIds: ["need:model-fact"],
    parsing: { adapterId: "fixture", adapterVersion: "v1" },
    claimScopes: ["model_fact"],
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed",
      sourceRedistribution: "allowed",
      basis: "fixture",
    },
  };
}

function marketCandidate(): MarketUniverseVersion {
  return marketUniverseVersionSchema.parse({
    id: "combined-universe-v1",
    projectId: "combined-regulatory-project",
    categoryDefinitionVersionId: "combined-regulatory-definition",
    confirmedScopeVersionId: "combined-regulatory-scope",
    version: 1,
    status: "candidate",
    contentHash: "a".repeat(64),
    createdAt: "2026-08-17T08:00:00.000Z",
    basis: "official_active_assortment",
    deduplicationRule: "brand_and_manufacturer_model",
    observationStartedAt: "2026-08-17T08:00:00.000Z",
    observationEndedAt: "2026-08-17T08:00:00.000Z",
    coverageDimensions: [{
      code: "regulatory_product_class",
      label: "产品类别",
      taxonomyVersion: "v1",
      requiredForConfirmation: true,
    }],
    sources: [{
      sourceId: "fixture",
      sourceIdentity: "fixture",
      sourceAuthorityType: "brand_official_site",
      coverageKind: "independent_brand_catalog",
      catalogUrl: "https://example.com/",
      observedAt: "2026-08-17T08:00:00.000Z",
      declaredItemCount: 1,
      fetchedItemCount: 1,
      acceptedItemCount: 1,
      coverageStatus: "complete",
      uniqueModelCount: 1,
      observedBrandKeys: ["brand:fixture"],
    }],
    models: [{
      key: "brand:fixture\u0000MODEL-1",
      brand: { key: "brand:fixture", label: "Fixture" },
      manufacturerModel: "MODEL-1",
      identityStatus: "unconfirmed",
      regulatoryProducers: [],
      classifications: [{
        dimensionCode: "regulatory_product_class",
        status: "unknown",
      }],
      sourceRefs: [{ sourceId: "fixture", sourceItemId: "MODEL-1", sourceUrl: "https://example.com/model-1" }],
    }],
    unknowns: [],
  });
}

async function waitFor<T extends { lifecycleStatus: string }>(
  read: () => Promise<T | null>,
  expected: string,
) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value?.lifecycleStatus === expected) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待组合 runtime 状态超时：${expected}`);
}
