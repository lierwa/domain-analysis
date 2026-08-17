import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

import type {
  CategoryInterviewRuntimeOutput,
  CategoryResearchBriefContent,
  SourceCollectionPipelineRun,
} from "@domain-analysis/shared";
import {
  createSourceCollectionPlannerModule,
  openProductKnowledgeWorkbench,
  openSourceCollectionPipeline,
  type CategoryInterviewRuntime,
  type CategoryInterviewRuntimeEvent,
} from "@domain-analysis/workbench";
import {
  createCrawleeReadablePageReader,
  createCrawleeEnergyLabelRecordSource,
  createEnergyLabelSourceCollectionProvider,
  createReadableTechnicalSourceCollectionProvider,
  createSourceCollectionProviderRouter,
} from "@domain-analysis/worker";

import { createProductionSourceCollectionPlanningRules } from "../../../../apps/api/src/sourceCollectionPlanning";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
if (!databaseUrl) throw new Error("POSTGRES_DATABASE_URL is required");
const allowedOrigins = [
  "https://www.nist.gov",
  "https://www.fsis.usda.gov",
  "https://www.energylabel.com.cn",
];
async function main() {
  const evidenceRoot = await mkdtemp(path.join(tmpdir(), "domain-analysis-r033-"));
  const interviewRuntime = new QueueRuntime();
  const workbench = await openProductKnowledgeWorkbench({
    databaseUrl,
    evidenceRoot,
    categoryInterviewRuntime: interviewRuntime,
  });
  let pipeline: Awaited<ReturnType<typeof openSourceCollectionPipeline>> | undefined;

  try {
    const projectId = await createConfirmedProject(
      interviewRuntime,
      workbench.categoryInterviews!,
      workbench,
    );
    const readableSource = createReadableTechnicalSourceCollectionProvider({
      allowedOrigins,
      pageReader: createCrawleeReadablePageReader({ allowedOrigins }),
    });
    const energyLabelSource = createCrawleeEnergyLabelRecordSource({ allowedOrigins });
    const source = createSourceCollectionProviderRouter({
      "readable-technical-source": readableSource,
      "energy-label-record": createEnergyLabelSourceCollectionProvider({ source: energyLabelSource }),
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
    const launch = await planner.start(projectId);
    const completed = await Promise.all(launch.executions.map(async (execution) => {
      if (!execution.pipelineRun) throw new Error(execution.error ?? "来源批次没有启动");
      return waitForTerminal(pipeline!.module, execution.pipelineRun.id);
    }));
    const runs = await workbench.sourceDatasets.listProject(projectId);
    const views = await Promise.all(runs.map((run) => workbench.sourceDatasets.getRun(run.id)));
    const records = views.flatMap((view) => view?.records ?? []);
    assert.equal(records.length, 3, "R-033 必须逐来源保存三条可执行快照");
    const expectedNeeds = new Map([
      ["source:nist-cycle-d-hx", ["need:refrigeration-cycle"]],
      ["source:usda-refrigeration", ["need:food-preservation"]],
      ["source:energy-label:mr-457", ["need:regulatory-model-record"]],
    ]);
    const expectedKinds = new Map([
      ["source:nist-cycle-d-hx", "document"],
      ["source:usda-refrigeration", "document"],
      ["source:energy-label:mr-457", "ordered_record"],
    ]);
    for (const { object, snapshot } of records) {
      assert.deepEqual(
        snapshot.knowledgeNeedIds,
        expectedNeeds.get(object.externalKey),
        `来源 ${object.externalKey} 不能被扩大绑定到未分配的知识需求`,
      );
      assert.equal(snapshot.observation.state, "accessible");
      assert.equal(snapshot.content?.kind, expectedKinds.get(object.externalKey));
    }
    assert.deepEqual(completed.map((item) => item.lifecycleStatus), ["succeeded", "succeeded"]);
    assert.deepEqual(
      launch.plan.content.lanes.map((lane) => lane.status),
      ["ready", "ready", "waiting"],
    );
    assert.equal(
      launch.plan.content.lanes[2]?.issues[0]?.code,
      "local_read_not_allowed",
      "受条款限制的说明书必须停在 typed waiting，不能发起访问",
    );
    console.log(JSON.stringify({
      projectId,
      planId: launch.plan.id,
      laneStatuses: launch.plan.content.lanes.map((lane) => lane.status),
      pipelineStatuses: completed.map((item) => item.lifecycleStatus),
      sourceRuns: runs.map((run) => ({
        id: run.id,
        status: run.status,
        snapshotCount: run.snapshotCount,
        accessibleCount: run.accessibleCount,
      })),
      records: records.map(({ object, snapshot }) => ({
        externalKey: object.externalKey,
        contentKind: snapshot.content?.kind,
        targetKeys: snapshot.targetKeys,
        knowledgeNeedIds: snapshot.knowledgeNeedIds,
        state: snapshot.observation.state,
        contentHash: snapshot.contentHash,
      })),
    }, null, 2));
  } finally {
    await pipeline?.close();
    await workbench.close();
    await rm(evidenceRoot, { recursive: true, force: true });
  }
}

async function createConfirmedProject(
  runtime: QueueRuntime,
  interviews: NonNullable<Awaited<ReturnType<typeof openProductKnowledgeWorkbench>>["categoryInterviews"]>,
  workbench: Awaited<ReturnType<typeof openProductKnowledgeWorkbench>>,
) {
  const session = await interviews.start({ categoryHint: "冰箱" });
  runtime.push({
    assistantText: "建议首轮验证中国大陆家用冰箱的制冷和保鲜底层知识。",
    unresolvedItems: [],
    resolvedUnresolvedKeys: [],
    proposedDecision: {
      key: "m2_scope",
      question: "首轮验证范围？",
      selection: "制冷循环与保鲜条件",
      rationale: "两类已通过许可门的政府技术来源可形成最小纵切片。",
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
    briefCandidate: brief(view.decisions.at(-1)!.id),
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
  const confirmed = await workbench.productProjects.confirm(
    result.project.project.id,
    result.project.project.revision,
  );
  return confirmed.project.id;
}

function brief(decisionId: string): CategoryResearchBriefContent {
  const nist = "https://www.nist.gov/publications/cycled-hx-nist-vapor-compression-cycle-model-accounting-refrigerant-thermodynamic-and";
  const usda = "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/refrigeration";
  return {
    category: { code: "refrigerator", label: "冰箱", market: "CN" },
    objective: "建立制冷循环与保鲜条件的底层知识纵切片。",
    audience: "中国大陆家用消费者",
    priorityScenarios: ["解释制冷循环", "解释温度湿度对食品保存的影响"],
    excludedScope: ["具体型号采用关系"],
    knowledgeNeeds: [{
      id: "need:refrigeration-cycle", question: "蒸汽压缩制冷循环如何搬运热量？",
      knowledgeLayers: ["mechanism"], priority: "must",
    }, {
      id: "need:food-preservation", question: "温度和湿度怎样约束食品保存？",
      knowledgeLayers: ["function", "mechanism"], priority: "must",
    }, {
      id: "need:regulatory-model-record", question: "型号 MR-457WUSPZE 的能效备案原文是什么？",
      knowledgeLayers: ["identity", "specification"], priority: "must",
    }, {
      id: "need:manual-installation", question: "型号 MR-457WUSPZE 的安装和尺寸边界是什么？",
      knowledgeLayers: ["specification", "decision"], priority: "should",
    }],
    categoryFramework: {
      attributes: [{
        code: "cooling.mechanism", label: "制冷机制", description: "冰箱移除热量的工作链",
        knowledgeLayer: "mechanism", valueKind: "text", externalMappings: [],
        filterable: false, comparable: false,
      }],
      decisionDimensions: [{
        code: "preservation.conditions", label: "保存条件", description: "温度与湿度的适用边界",
        relatedAttributeCodes: ["cooling.mechanism"],
      }],
      competencyQuestions: ["冰箱为什么能制冷？", "低温为什么不能等同于杀灭所有微生物？"],
    },
    targetPopulation: {
      populationLayers: ["official_current_catalog"],
      targets: [{
        key: "category:refrigerator", kind: "category", label: "家用冰箱",
        disposition: "included", reason: "把底层原理连接到品类知识。",
      }],
    },
    sourcePolicy: {
      authorityTypes: ["government_research", "regulatory_source", "official_manual"],
      accessModes: ["public_web", "document"],
      freshnessPolicy: "manual", stopConditions: ["access_denied", "source_abnormal"],
    },
    collectionLanes: [{
      id: "lane:refrigerator:government-research",
      sourceAuthorityType: "government_research", accessMode: "public_web",
      targetKeys: ["category:refrigerator"], knowledgeLayers: ["function", "mechanism"],
      refreshPolicy: "manual", stopConditions: ["access_denied", "source_abnormal"],
    }, {
      id: "lane:refrigerator:regulatory",
      sourceAuthorityType: "regulatory_source", accessMode: "public_web",
      targetKeys: ["category:refrigerator"], knowledgeLayers: ["identity", "specification"],
      refreshPolicy: "manual", stopConditions: ["access_denied", "source_abnormal"],
    }, {
      id: "lane:refrigerator:manual",
      sourceAuthorityType: "official_manual", accessMode: "document",
      targetKeys: ["category:refrigerator"], knowledgeLayers: ["specification", "decision"],
      refreshPolicy: "manual", stopConditions: ["access_denied", "source_abnormal"],
    }],
    sourceAssignments: [{
      collectionLaneId: "lane:refrigerator:government-research",
      factReferenceId: "source:nist-cycle-d-hx",
      knowledgeNeedIds: ["need:refrigeration-cycle"],
    }, {
      collectionLaneId: "lane:refrigerator:government-research",
      factReferenceId: "source:usda-refrigeration",
      knowledgeNeedIds: ["need:food-preservation"],
    }, {
      collectionLaneId: "lane:refrigerator:regulatory",
      factReferenceId: "source:energy-label:mr-457",
      knowledgeNeedIds: ["need:regulatory-model-record"],
      request: {
        kind: "structured_record_lookup",
        fields: [{ code: "manufacturer_model", value: "MR-457WUSPZE" }],
        maximumBytes: 40_000,
      },
    }, {
      collectionLaneId: "lane:refrigerator:manual",
      factReferenceId: "source:midea-manual:mr-457",
      knowledgeNeedIds: ["need:manual-installation"],
      request: {
        kind: "document_excerpt",
        requiredIdentityText: "MR-457WUSPZE",
        requiredSectionTerms: ["年综合耗电量", "外形尺寸"],
        section: "产品参数",
        maximumSourceBytes: 20 * 1024 * 1024,
        maximumExcerptBytes: 256 * 1024,
      },
    }],
    acceptanceCriteria: ["两条资料逐条持久化并绑定知识需求与目标"],
    decisionIds: [decisionId],
    factReferences: [{
      id: "source:nist-cycle-d-hx", label: "NIST CYCLE_D-HX", url: nist,
      sourceAuthorityType: "government_research", observedAt: "2026-08-17T00:00:00.000Z",
    }, {
      id: "source:usda-refrigeration", label: "USDA Refrigeration and Food Safety", url: usda,
      sourceAuthorityType: "government_research", observedAt: "2026-08-17T00:00:00.000Z",
    }, {
      id: "source:energy-label:mr-457", label: "中国能效标识备案查询",
      url: "https://www.energylabel.com.cn/admin-api/gateway/productRegistration/productDetailById",
      sourceAuthorityType: "regulatory_source", observedAt: "2026-08-17T00:00:00.000Z",
    }, {
      id: "source:midea-manual:mr-457", label: "美的 MR-457WUSPZE 官方说明书",
      url: "https://dsdcp.smartmidea.net/mcsp/prod/20230803/6b0f37e5343a4abfba8c4a5274565d70.pdf",
      sourceAuthorityType: "official_manual", observedAt: "2026-08-17T00:00:00.000Z",
    }],
    investigatedFacts: ([
      "brand", "model", "parameter", "component", "mechanism", "source_entrypoint",
    ] as const).map((kind) => ({
      id: `investigated:${kind}`, kind, statement: `${kind} 在本轮范围与缺口已调查`,
      factReferenceIds: [
        "source:nist-cycle-d-hx",
        "source:usda-refrigeration",
        "source:energy-label:mr-457",
        "source:midea-manual:mr-457",
      ],
    })),
  };
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
    // 真实事实由 Workbench 落库；验收脚本不另建消息事实源。
  }
}

async function waitForTerminal(
  module: { get(id: string): Promise<SourceCollectionPipelineRun | null> },
  id: string,
) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const current = await module.get(id);
    if (current && ["succeeded", "failed", "cancelled"].includes(current.lifecycleStatus)) return current;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`source pipeline timeout: ${id}`);
}

await main();
