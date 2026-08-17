import { appendFile } from "node:fs/promises";

import type {
  ProductProjectDraftInput,
  SourceCollectionProviderResult,
  SourceCollectionWorkItem,
} from "@domain-analysis/shared";

import {
  openProductKnowledgeWorkbench,
  openSourceCollectionPipeline,
  type SourceCollectionProviderPort,
} from "../../src/index";

const [mode, sourceRunId, executionId, evidenceRoot, accessLogPath] = process.argv.slice(2);
const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const schemaName = process.env.DBOS_TEST_SCHEMA;
if (!databaseUrl || !schemaName || !mode || !evidenceRoot || !accessLogPath) {
  throw new Error("Source Collection recovery worker 参数不完整");
}

const workbench = await openProductKnowledgeWorkbench({ databaseUrl, evidenceRoot });
const opened = await openSourceCollectionPipeline({
  systemDatabaseUrl: databaseUrl,
  systemDatabaseSchemaName: schemaName,
  workflowName: "sourceCollectionRecoveryPipelineV1",
  childWorkflowName: "sourceCollectionRecoveryItemV1",
  queueName: "source-collection-recovery-items-v1",
  sourceDatasets: workbench.sourceDatasets,
  source: createFixtureProvider(accessLogPath),
  commandTimeoutSeconds: 20,
});

if (mode === "start") {
  const draft = await workbench.productProjects.saveDraft(projectDraft());
  const confirmed = await workbench.productProjects.confirm(draft.project.id, draft.project.revision);
  const sourceRun = await workbench.sourceDatasets.startRun({
    projectId: confirmed.project.id,
    collectionLaneId: "lane:television:official",
    providerKey: "fixture-brand-site",
    accessPolicy: {
      kind: "paced_http",
      version: "recovery-fixture-v1",
      maxRequestsPerMinute: 100,
      minimumIntervalMs: 3_000,
      jitterMs: { min: 0, max: 0 },
      batchSize: 100,
      batchCooldownMs: 1,
      maximumRunMs: 30_000,
    },
  });
  const started = await opened.module.start({
    sourceRunId: sourceRun.id,
    workItems: [workItem("A"), workItem("B"), workItem("C")],
  });
  await waitForSnapshots(sourceRun.id, 1);
  process.send?.({
    type: "first_committed",
    sourceRunId: sourceRun.id,
    executionId: started.id,
  });
  await new Promise(() => undefined);
} else if (mode === "recover" && sourceRunId && executionId) {
  const completed = await waitForExecution(executionId);
  const sourceView = await workbench.sourceDatasets.getRun(sourceRunId);
  process.send?.({ type: "completed", execution: completed, sourceView });
  await opened.close();
  await workbench.close();
} else {
  throw new Error(`未知 Source Collection recovery worker 模式：${mode}`);
}

function createFixtureProvider(logPath: string): SourceCollectionProviderPort {
  return {
    collect: async ({ item }) => {
      const accessStartedAt = new Date().toISOString();
      await appendFile(logPath, `${item.id}\n`);
      const accessFinishedAt = new Date().toISOString();
      return providerResult(item, accessStartedAt, accessFinishedAt);
    },
    cancel: () => undefined,
  };
}

function providerResult(
  item: SourceCollectionWorkItem,
  accessStartedAt: string,
  accessFinishedAt: string,
): SourceCollectionProviderResult {
  return {
    accessStartedAt,
    accessFinishedAt,
    observation: {
      requestedUrl: item.requestedUrl,
      finalUrl: item.requestedUrl,
      observedAt: accessFinishedAt,
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
  };
}

function workItem(externalKey: string): SourceCollectionWorkItem {
  return {
    id: `item-${externalKey}`,
    object: { sourceIdentity: "fixture-brand-site", kind: "product", externalKey },
    requestedUrl: `https://example.com/televisions/${externalKey}`,
    targetKeys: ["category:television"],
    knowledgeNeedIds: ["need:model-fact"],
    parsing: { adapterId: "fixture", adapterVersion: "v1" },
    claimScopes: ["model_fact"],
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed",
      sourceRedistribution: "unknown",
      basis: "fixture policy",
    },
  };
}

function projectDraft(): ProductProjectDraftInput {
  return {
    name: "电视来源恢复验证",
    knowledgeTopic: "中国市场电视商品知识",
    market: "CN",
    categoryDefinition: {
      categoryCode: "television",
      label: "电视",
      sourceAuthorityPolicy: ["brand_official_site"],
      attributes: [{
        code: "display.refresh_rate",
        label: "刷新率",
        description: "电视刷新率",
        knowledgeLayer: "specification",
        valueKind: "decimal",
        canonicalUnitCode: "Hz",
        externalMappings: [],
        filterable: true,
        comparable: true,
      }],
      decisionDimensions: [{
        code: "product.comparison",
        label: "产品比较",
        description: "比较电视关键规格",
        relatedAttributeCodes: ["display.refresh_rate"],
      }],
      competencyQuestions: ["怎样比较电视？"],
    },
    confirmedScope: {
      populationLayers: ["official_current_catalog"],
      targets: [{
        key: "brand:fixture",
        kind: "brand",
        label: "Fixture",
        evidenceReferenceIds: ["scope:television"],
        disposition: "included",
        reason: "恢复验证",
      }],
    },
    collectionBoard: {
      lanes: [{
        id: "lane:television:official",
        sourceAuthorityType: "brand_official_site",
        accessMode: "public_web",
        targetKeys: ["brand:fixture"],
        knowledgeLayers: ["identity", "specification"],
        refreshPolicy: "manual",
        stopConditions: ["access_denied", "source_abnormal"],
      }],
    },
  };
}

async function waitForSnapshots(runId: string, count: number) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const view = await workbench.sourceDatasets.getRun(runId);
    if (view && view.run.snapshotCount >= count) return view;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待来源快照超时：${count}`);
}

async function waitForExecution(id: string) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const execution = await opened.module.get(id);
    if (execution?.lifecycleStatus === "succeeded") return execution;
    if (execution?.lifecycleStatus === "failed") {
      throw new Error(`恢复后的来源采集失败：${execution.errorCode}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待恢复后的来源采集完成超时");
}
