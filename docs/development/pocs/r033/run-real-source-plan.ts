import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  CategoryInterviewRuntimeOutput,
  ProductProjectView,
} from "@domain-analysis/shared";
import {
  createSourceCollectionPlannerModule,
  openProductKnowledgeWorkbench,
  openSourceCollectionPipeline,
  type CategoryInterviewRuntime,
  type CategoryInterviewRuntimeEvent,
} from "@domain-analysis/workbench";
import {
  createCrawleeEnergyLabelRecordSource,
  createCrawleeReadablePageReader,
  createEnergyLabelSourceCollectionProvider,
  createReadableTechnicalSourceCollectionProvider,
  createSourceCollectionProviderRouter,
} from "@domain-analysis/worker";

import { createProductionSourceCollectionPlanningRules } from "../../../../apps/api/src/sourceCollectionPlanning";
import {
  createAcceptanceEvidenceRequest,
  materializeDocumentEvidence,
  materializeOrderedTextEvidence,
  requireRecord,
  settlePlannedExecution,
} from "../sourceEvidenceAcceptance";
import { refrigeratorBrief } from "./refrigeratorBrief";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
if (!databaseUrl) throw new Error("POSTGRES_DATABASE_URL is required");

const allowedOrigins = [
  "https://www.nist.gov",
  "https://www.fsis.usda.gov",
  "https://www.energylabel.com.cn",
];

async function main() {
  const configuredEvidenceRoot = process.env.R033_EVIDENCE_ROOT;
  const temporaryEvidenceRoot = configuredEvidenceRoot
    ? undefined
    : await mkdtemp(path.join(tmpdir(), "domain-analysis-r033-"));
  const evidenceRoot = path.resolve(configuredEvidenceRoot ?? temporaryEvidenceRoot!);
  await mkdir(evidenceRoot, { recursive: true });
  const interviewRuntime = new QueueRuntime();
  const workbench = await openProductKnowledgeWorkbench({
    databaseUrl,
    evidenceRoot,
    categoryInterviewRuntime: interviewRuntime,
  });
  let pipeline: Awaited<ReturnType<typeof openSourceCollectionPipeline>> | undefined;

  try {
    const existingProjectId = process.env.R033_PROJECT_ID;
    const project = existingProjectId
      ? await workbench.productProjects.get(existingProjectId)
      : await createConfirmedProject(
        interviewRuntime,
        workbench.categoryInterviews!,
        workbench,
      );
    if (!project || project.project.status !== "ready") {
      throw new Error(`R033_PROJECT_ID 不是已确认项目：${existingProjectId}`);
    }
    const readableSource = createReadableTechnicalSourceCollectionProvider({
      allowedOrigins,
      pageReader: createCrawleeReadablePageReader({ allowedOrigins }),
    });
    const source = createSourceCollectionProviderRouter({
      "readable-technical-source": readableSource,
      "energy-label-record": createEnergyLabelSourceCollectionProvider({
        source: createCrawleeEnergyLabelRecordSource({ allowedOrigins }),
      }),
    });
    pipeline = await openSourceCollectionPipeline({
      systemDatabaseUrl: databaseUrl,
      systemDatabaseSchemaName: `domain_analysis_r033_${process.pid}`,
      workflowName: `r033SourceCollection${process.pid}`,
      childWorkflowName: `r033SourceItem${process.pid}`,
      queueName: `r033-source-${process.pid}`,
      sourceDatasets: workbench.sourceDatasets,
      source,
      commandTimeoutSeconds: 30,
    });
    const planner = createSourceCollectionPlannerModule(
      workbench.productProjects,
      workbench.categoryInterviews!,
      workbench.sourceDatasets,
      pipeline.module,
      {
        recipeVersion: "source-collection-plan-v1",
        rules: createProductionSourceCollectionPlanningRules(allowedOrigins),
      },
    );
    const launch = await planner.start(project.project.id);
    const pipelineStatuses = await Promise.all(launch.executions.map((execution) =>
      settlePlannedExecution(pipeline!.module, execution)));
    assert(pipelineStatuses.every((status) => status === "succeeded" || status === "reused"));

    const runs = await workbench.sourceDatasets.listProject(project.project.id);
    const views = await Promise.all(runs.map(({ id }) => workbench.sourceDatasets.getRun(id)));
    const allRecords = views.flatMap((view) => view?.records ?? []);
    // WHY：历史失败观察是必须保留的审计事实，但不能遮蔽后续成功快照或被物化为 Evidence。
    const records = allRecords.filter(({ snapshot }) =>
      snapshot.observation.state === "accessible" && snapshot.content);
    assert.equal(records.length, 3, "R-033 必须逐来源保存三条可访问许可快照");
    assertSourceBindings(records);

    const requests = await createEvidenceRequests(workbench, project);
    const cycleEvidence = await materializeDocumentEvidence(
      workbench,
      requests.cycle.id,
      requireRecord(records, "source:nist-cycle-d-hx"),
      "The basic system simulated by CYCLE_D-HX consists of a compressor",
    );
    const preservationEvidence = await materializeDocumentEvidence(
      workbench,
      requests.preservation.id,
      requireRecord(records, "source:usda-refrigeration"),
      "Refrigeration slows bacterial growth.",
    );
    const regulatoryEvidence = await materializeOrderedTextEvidence(
      workbench,
      requests.regulatory.id,
      requireRecord(records, "source:energy-label:mr-457"),
    );
    const evidenceIds = [cycleEvidence.id, preservationEvidence.id, regulatoryEvidence.id];
    assert.equal(new Set(evidenceIds).size, 3, "每个许可来源必须形成独立 Evidence");

    assert.deepEqual(
      launch.plan.content.lanes.map((lane) => lane.status),
      ["ready", "ready", "ready", "waiting"],
    );
    const manualLane = launch.plan.content.lanes.find(
      ({ collectionLaneId }) => collectionLaneId === "lane:refrigerator:manual",
    );
    assert.equal(
      manualLane?.issues[0]?.code,
      "local_read_not_allowed",
      "受条款限制的说明书必须停在 typed waiting，不能发起访问",
    );

    console.log(JSON.stringify({
      projectId: project.project.id,
      planId: launch.plan.id,
      evidenceRoot,
      laneStatuses: launch.plan.content.lanes.map(({ collectionLaneId, status }) => ({
        collectionLaneId,
        status,
      })),
      pipelineStatuses,
      sourceRuns: runs.map(({ id, status, snapshotCount, accessibleCount }) => ({
        id,
        status,
        snapshotCount,
        accessibleCount,
      })),
      records: records.map(({ object, snapshot }) => ({
        externalKey: object.externalKey,
        contentKind: snapshot.content?.kind,
        targetKeys: snapshot.targetKeys,
        knowledgeNeedIds: snapshot.knowledgeNeedIds,
        state: snapshot.observation.state,
        contentHash: snapshot.contentHash,
      })),
      failedObservationCount: allRecords.length - records.length,
      evidenceIds,
    }, null, 2));
  } finally {
    await pipeline?.close();
    await workbench.close();
    if (temporaryEvidenceRoot) await rm(temporaryEvidenceRoot, { recursive: true, force: true });
  }
}

async function createConfirmedProject(
  runtime: QueueRuntime,
  interviews: NonNullable<Awaited<ReturnType<typeof openProductKnowledgeWorkbench>>["categoryInterviews"]>,
  workbench: Awaited<ReturnType<typeof openProductKnowledgeWorkbench>>,
) {
  const session = await interviews.start({ categoryHint: "冰箱" });
  runtime.push({
    assistantText: "建议首轮验证中国大陆家用冰箱的制冷、保鲜和监管型号知识。",
    unresolvedItems: [],
    resolvedUnresolvedKeys: [],
    proposedDecision: {
      key: "m2_scope",
      question: "首轮验证范围？",
      selection: "制冷循环、保鲜条件与监管型号记录",
      rationale: "三个通过许可门的权威来源可形成最小纵切片。",
    },
  });
  await collect(interviews.runTurn({
    sessionId: session.session.id,
    trigger: "user_message",
    expectedRevision: session.session.revision,
    text: "按已确认路线执行 M2 权威来源纵切片。",
  }));
  let view = (await interviews.get(session.session.id))!;
  view = await interviews.confirmDecision({
    sessionId: session.session.id,
    decisionId: view.decisions[0]!.id,
    expectedRevision: view.session.revision,
  });
  runtime.push({
    assistantText: "已形成带知识需求、目标和来源入口的 M2 调研任务书。",
    unresolvedItems: [],
    resolvedUnresolvedKeys: [],
    briefCandidate: refrigeratorBrief(view.decisions.at(-1)!.id),
  });
  await collect(interviews.runTurn({
    sessionId: session.session.id,
    trigger: "decision_confirmed",
    expectedRevision: view.session.revision,
    decisionId: view.decisions.at(-1)!.id,
  }));
  view = (await interviews.get(session.session.id))!;
  const result = await interviews.confirmBrief({
    sessionId: session.session.id,
    briefId: view.briefs[0]!.id,
    expectedRevision: view.session.revision,
  });
  return workbench.productProjects.confirm(
    result.project.project.id,
    result.project.project.revision,
  );
}

async function createEvidenceRequests(
  workbench: Awaited<ReturnType<typeof openProductKnowledgeWorkbench>>,
  project: ProductProjectView,
) {
  const create = (input: Omit<Parameters<typeof createAcceptanceEvidenceRequest>[2],
    "evidencePolicyVersion">) => createAcceptanceEvidenceRequest(workbench, project, {
      ...input,
      evidencePolicyVersion: "r033-refrigerator-evidence-v1",
    });
  const [cycle, preservation, regulatory] = await Promise.all([
    create({
      collectionLaneIds: ["lane:refrigerator:cycle-research"],
      knowledgeNeed: {
        id: "need:refrigeration-cycle",
        kind: "competency_question",
        question: "蒸汽压缩制冷循环如何搬运热量？",
      },
      question: "蒸汽压缩制冷循环如何搬运热量？",
      knowledgeLayer: "mechanism",
      targetKeys: ["category:refrigerator", "concept:vapor-compression-cycle"],
      allowedSourceAuthorityTypes: ["government_research"],
    }),
    create({
      collectionLaneIds: ["lane:refrigerator:preservation-research"],
      knowledgeNeed: {
        id: "need:food-preservation",
        kind: "competency_question",
        question: "低温怎样约束食品保存？",
      },
      question: "低温怎样约束食品保存？",
      knowledgeLayer: "function",
      targetKeys: ["category:refrigerator", "concept:food-preservation-conditions"],
      allowedSourceAuthorityTypes: ["government_research"],
    }),
    create({
      collectionLaneIds: ["lane:refrigerator:regulatory"],
      knowledgeNeed: {
        id: "need:regulatory-model-record",
        kind: "attribute",
        attributeCode: "identity.model_number",
      },
      question: "型号 MR-457WUSPZE 的能效备案原文是什么？",
      knowledgeLayer: "identity",
      targetKeys: ["model:energy-label:MR-457WUSPZE"],
      allowedSourceAuthorityTypes: ["regulatory_source"],
    }),
  ]);
  return { cycle, preservation, regulatory };
}

function assertSourceBindings(records: Parameters<typeof requireRecord>[0]) {
  const expectedNeeds = new Map([
    ["source:nist-cycle-d-hx", ["need:refrigeration-cycle"]],
    ["source:usda-refrigeration", ["need:food-preservation"]],
    ["source:energy-label:mr-457", ["need:regulatory-model-record"]],
  ]);
  const expectedTargets = new Map([
    ["source:nist-cycle-d-hx", ["category:refrigerator", "concept:vapor-compression-cycle"]],
    ["source:usda-refrigeration", ["category:refrigerator", "concept:food-preservation-conditions"]],
    ["source:energy-label:mr-457", ["model:energy-label:MR-457WUSPZE"]],
  ]);
  const expectedKinds = new Map([
    ["source:nist-cycle-d-hx", "document"],
    ["source:usda-refrigeration", "document"],
    ["source:energy-label:mr-457", "ordered_record"],
  ]);
  for (const { object, snapshot } of records) {
    assert.deepEqual(snapshot.knowledgeNeedIds, expectedNeeds.get(object.externalKey));
    assert.deepEqual(snapshot.targetKeys, expectedTargets.get(object.externalKey));
    assert.equal(snapshot.observation.state, "accessible");
    assert.equal(snapshot.content?.kind, expectedKinds.get(object.externalKey));
  }
}

class QueueRuntime implements CategoryInterviewRuntime {
  private readonly outputs: CategoryInterviewRuntimeOutput[] = [];

  push(output: CategoryInterviewRuntimeOutput) {
    this.outputs.push(output);
  }

  async *run(): AsyncIterable<CategoryInterviewRuntimeEvent> {
    const output = this.outputs.shift();
    if (!output) throw new Error("missing interview output");
    yield { type: "text_delta", delta: output.assistantText };
    yield { type: "completed", output };
  }
}

async function collect<T>(events: AsyncIterable<T>) {
  for await (const _event of events) {
    // WHY：真实事实由 Workbench 落库；验收脚本不另建消息事实源。
  }
}

await main();
