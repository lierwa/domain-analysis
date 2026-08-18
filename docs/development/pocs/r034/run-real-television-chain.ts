import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  openKnowledgeRuntime,
} from "@domain-analysis/knowledge-runtime";
import type {
  CategoryInterviewRuntimeOutput,
  ProductProjectView,
} from "@domain-analysis/shared";
import {
  createCodexKnowledgeCandidateModel,
  createSourceCollectionPlannerModule,
  openProductKnowledgeWorkbench,
  openSourceCollectionPipeline,
  type CategoryInterviewRuntime,
  type CategoryInterviewRuntimeEvent,
} from "@domain-analysis/workbench";
import {
  createCrawleeReadablePageReader,
  createCrawleeDocumentExcerptSource,
  createDocumentExcerptSourceCollectionProvider,
  createReadableTechnicalSourceCollectionProvider,
  createSocrataOpenDataSource,
  createSocrataSourceCollectionProvider,
  createSourceCollectionProviderRouter,
} from "@domain-analysis/worker";

import { createProductionSourceCollectionPlanningRules } from "../../../../apps/api/src/sourceCollectionPlanning";
import {
  createAcceptanceEvidenceRequest,
  materializeDocumentEvidence,
  materializeFieldEvidence,
  requireRecord,
  settlePlannedExecution,
} from "../sourceEvidenceAcceptance";
import { televisionBrief } from "./televisionBrief";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
if (!databaseUrl) throw new Error("POSTGRES_DATABASE_URL is required");
const allowedOrigins = ["https://www.energy.gov", "https://data.energystar.gov"];

async function main() {
  const configuredArtifactRoot = process.env.R034_ARTIFACT_ROOT;
  const temporaryRoot = configuredArtifactRoot
    ? path.resolve(configuredArtifactRoot)
    : await mkdtemp(path.join(tmpdir(), "domain-analysis-r034-"));
  if (configuredArtifactRoot) await mkdir(temporaryRoot, { recursive: true });
  const runtime = new QueueRuntime();
  const workbench = await openProductKnowledgeWorkbench({
    databaseUrl,
    evidenceRoot: path.join(temporaryRoot, "evidence"),
    knowledgePackageModule: { root: path.join(temporaryRoot, "packages") },
    categoryInterviewRuntime: runtime,
    knowledgeFactoryModule: {
      candidateModel: createCodexKnowledgeCandidateModel({
        repositoryRoot: path.resolve("."),
        model: "gpt-5.3-codex-spark",
        reasoningEffort: "low",
        timeoutMs: 180_000,
      }),
    },
  });
  let pipeline: Awaited<ReturnType<typeof openSourceCollectionPipeline>> | undefined;
  try {
    const project = await createConfirmedProject(runtime, workbench);
    pipeline = await openSourceCollectionPipeline({
      systemDatabaseUrl: databaseUrl,
      systemDatabaseSchemaName: `domain_analysis_r034_${process.pid}`,
      workflowName: `r034SourceCollection${process.pid}`,
      childWorkflowName: `r034SourceItem${process.pid}`,
      queueName: `r034-source-${process.pid}`,
      sourceDatasets: workbench.sourceDatasets,
      source: productionSourceRouter(),
      commandTimeoutSeconds: 45,
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
    const records = await sourceRecords(workbench, project.project.id);
    assert.equal(records.length, 4, "R-034 必须取得两个 DOE 页面、一页 DOE 报告和一条 EPA 模型记录");

    const requests = await createEvidenceRequests(workbench, project);
    const definitionEvidence = await materializeDocumentEvidence(
      workbench,
      requests.definition.id,
      requireRecord(records, "source:doe:television-definition"),
      "product designed to produce dynamic video",
    );
    const efficiencyEvidence = await materializeDocumentEvidence(
      workbench,
      requests.efficiency.id,
      requireRecord(records, "source:doe:television-efficiency"),
      "lifetime energy savings exceed the up-front cost premium",
    );
    const architectureEvidence = await materializeDocumentEvidence(
      workbench,
      requests.architecture.id,
      requireRecord(records, "source:doe:display-architecture"),
      "Liquid crystal displays (LCDs)",
    );
    const modelEvidence = await materializeFieldEvidence(
      workbench,
      requests.model.id,
      requireRecord(records, "source:epa:model-index:2399940"),
      "model_number",
    );

    const batch = await workbench.knowledgeFactory.run({
      projectId: project.project.id,
      categoryDefinitionVersionId: project.categoryDefinition.id,
      recipeVersion: "knowledge-factory-tv-real-v2",
      evidenceRequestIds: [
        requests.definition.id,
        requests.architecture.id,
        requests.efficiency.id,
        requests.model.id,
      ],
    });
    assert.equal(batch.conflicts.length, 0);
    assert.equal(batch.unknowns.length, 0, "真实最小证据必须覆盖每个冻结目标");
    assert(batch.candidates.some(({ derivation }) => derivation.kind === "deterministic"));
    assert(batch.candidates.some(({ subject }) => subject.kind === "foundational_concept"));
    assert(batch.candidates.some(({ value }) => value.kind === "subject_ref"));
    assert(batch.candidates.every(({ evidenceIds }) => evidenceIds.every((id) =>
      [definitionEvidence.id, architectureEvidence.id, efficiencyEvidence.id, modelEvidence.id].includes(id))));

    await workbench.knowledgeReview.decide({
      batchId: batch.batch.id,
      reviewer: "r034-acceptance-reviewer",
      rationale: "真实来源、证据 locator、模型边界和关系端点已由验收断言复核。",
      grouping: { categoryDefinitionVersionId: project.categoryDefinition.id },
      selection: { action: "accept_candidates", targetIds: batch.candidates.map(({ id }) => id) },
    });
    const publishable = await workbench.knowledgeReview.listPublishable(project.project.id);
    assert.equal(publishable.length, batch.candidates.length);

    const descriptor = await workbench.knowledgePackages.build(project.project.id);
    const rebuilt = await workbench.knowledgePackages.build(project.project.id);
    assert.equal(rebuilt.versionHash, descriptor.versionHash, "同内容重建必须复用版本");
    await workbench.knowledgePackages.activate(project.project.id, descriptor.versionHash);
    const knowledgeRuntime = await openKnowledgeRuntime(descriptor.filePath, descriptor.databaseSha256);
    const modelFacts = await knowledgeRuntime.exact({
      subjectKey: "model:energy-star:2399940",
      predicate: "identity.model_number",
    });
    const relations = await knowledgeRuntime.relations("category:television");
    const restrictedEvidence = await knowledgeRuntime.getEvidence(definitionEvidence.id);
    const publicEvidence = await knowledgeRuntime.getEvidence(modelEvidence.id);
    assert.match(JSON.stringify(modelFacts), /LE-32T1/);
    assert(relations.length >= 1);
    assert.equal(restrictedEvidence?.content, undefined);
    assert.match(publicEvidence?.content ?? "", /LE-32T1/);
    knowledgeRuntime.close();

    const copiedPath = path.join(temporaryRoot, "copied-knowledge-package.sqlite");
    await copyFile(descriptor.filePath, copiedPath);
    const copiedRuntime = await openKnowledgeRuntime(copiedPath, descriptor.databaseSha256);
    assert((await copiedRuntime.search("LE-32T1")).length >= 1);
    copiedRuntime.close();

    console.log(JSON.stringify({
      projectId: project.project.id,
      planId: launch.plan.id,
      categoryCode: project.categoryDefinition.categoryCode,
      sourceRecords: records.map(({ object, snapshot }) => ({
        externalKey: object.externalKey,
        contentKind: snapshot.content?.kind,
        contentHash: snapshot.contentHash,
        knowledgeNeedIds: snapshot.knowledgeNeedIds,
      })),
      evidenceIds: [
        definitionEvidence.id,
        architectureEvidence.id,
        efficiencyEvidence.id,
        modelEvidence.id,
      ],
      candidateCounts: {
        all: batch.candidates.length,
        model: batch.candidates.filter(({ derivation }) => derivation.kind === "model").length,
        deterministic: batch.candidates.filter(({ derivation }) => derivation.kind === "deterministic").length,
        relations: relations.length,
      },
      package: {
        versionHash: descriptor.versionHash,
        databaseSha256: descriptor.databaseSha256,
        bytes: descriptor.bytes,
        copiedOfflineQuery: true,
      },
      artifactsRetained: Boolean(configuredArtifactRoot),
    }, null, 2));
  } finally {
    await pipeline?.close();
    await workbench.close();
    if (!configuredArtifactRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

function productionSourceRouter() {
  const socrata = createSocrataOpenDataSource({
    allowedOrigins,
    allowedDatasetIds: ["8wj2-sec8"],
  });
  return createSourceCollectionProviderRouter({
    "readable-technical-source": createReadableTechnicalSourceCollectionProvider({
      allowedOrigins,
      pageReader: createCrawleeReadablePageReader({ allowedOrigins }),
    }),
    "document-excerpt-source": createDocumentExcerptSourceCollectionProvider({
      source: createCrawleeDocumentExcerptSource({ allowedOrigins }),
    }),
    "socrata-open-data": createSocrataSourceCollectionProvider({ source: socrata }),
  });
}

async function createConfirmedProject(
  runtime: QueueRuntime,
  workbench: Awaited<ReturnType<typeof openProductKnowledgeWorkbench>>,
) {
  const interviews = workbench.categoryInterviews!;
  const session = await interviews.start({ categoryHint: "电视" });
  runtime.push({
    assistantText: "建议用 DOE 与 EPA 公开来源验证电视底层知识、品类知识和真实型号。",
    unresolvedItems: [],
    resolvedUnresolvedKeys: [],
    proposedDecision: {
      key: "r034_scope",
      question: "第二品类纵切片采用什么公开范围？",
      selection: "DOE 电视定义/节能机制 + EPA ENERGY STAR 型号索引",
      rationale: "来源许可、结构化记录和底层机制可以在同一真实样本内验证。",
    },
  });
  await collect(interviews.runTurn({
    sessionId: session.session.id,
    trigger: "user_message",
    expectedRevision: session.session.revision,
    text: "执行已批准的 M7 第二品类真实验收。",
  }));
  let view = (await interviews.get(session.session.id))!;
  view = await interviews.confirmDecision({
    sessionId: session.session.id,
    decisionId: view.decisions[0]!.id,
    expectedRevision: view.session.revision,
  });
  const confirmedDecisionId = view.decisions.at(-1)!.id;
  runtime.push({
    assistantText: "电视真实样本任务书已形成。",
    unresolvedItems: [],
    resolvedUnresolvedKeys: [],
    briefCandidate: televisionBrief(confirmedDecisionId),
  });
  await collect(interviews.runTurn({
    sessionId: session.session.id,
    trigger: "decision_confirmed",
    expectedRevision: view.session.revision,
    decisionId: confirmedDecisionId,
  }));
  view = (await interviews.get(session.session.id))!;
  const result = await interviews.confirmBrief({
    sessionId: session.session.id,
    briefId: view.briefs[0]!.id,
    expectedRevision: view.session.revision,
  });
  return workbench.productProjects.confirm(result.project.project.id, result.project.project.revision);
}

async function createEvidenceRequests(
  workbench: Awaited<ReturnType<typeof openProductKnowledgeWorkbench>>,
  project: ProductProjectView,
) {
  const create = (input: Omit<Parameters<typeof createAcceptanceEvidenceRequest>[2],
    "evidencePolicyVersion">) => createAcceptanceEvidenceRequest(workbench, project, {
      ...input,
      evidencePolicyVersion: "r034-minimal-evidence-v1",
    });
  const [definition, architecture, efficiency, model] = await Promise.all([
    create({
      collectionLaneIds: ["lane:television:government-research"],
      knowledgeNeed: {
        id: "need:television-definition",
        kind: "competency_question",
        question: "什么条件构成电视机，适用边界是什么？",
      },
      question: "什么条件构成电视机，适用边界是什么？",
      knowledgeLayer: "identity",
      targetKeys: ["category:television", "concept:television-definition"],
      allowedSourceAuthorityTypes: ["government_research"],
    }),
    create({
      collectionLaneIds: ["lane:television:government-document"],
      knowledgeNeed: {
        id: "need:display-architecture",
        kind: "competency_question",
        question: "LCD 与 OLED 的成像架构、适用条件和主要取舍是什么？",
      },
      question: "LCD 与 OLED 的成像架构、适用条件和主要取舍是什么？",
      knowledgeLayer: "mechanism",
      targetKeys: ["category:television", "concept:display-architecture"],
      allowedSourceAuthorityTypes: ["government_research"],
      acceptedEvidenceKind: "document_excerpt",
    }),
    create({
      collectionLaneIds: ["lane:television:government-research"],
      knowledgeNeed: {
        id: "need:television-efficiency",
        kind: "competency_question",
        question: "电视全生命周期节能收益应怎样与购置溢价比较？",
      },
      question: "电视全生命周期节能收益应怎样与购置溢价比较？",
      knowledgeLayer: "decision",
      targetKeys: ["category:television", "concept:lifecycle-cost-effectiveness"],
      allowedSourceAuthorityTypes: ["government_research"],
    }),
    create({
      collectionLaneIds: ["lane:television:regulatory"],
      knowledgeNeed: { id: "need:model-number", kind: "attribute", attributeCode: "identity.model_number" },
      question: "ENERGY STAR 记录 2399940 对应哪个厂家型号？",
      knowledgeLayer: "identity",
      targetKeys: ["model:energy-star:2399940"],
      allowedSourceAuthorityTypes: ["regulatory_source"],
    }),
  ]);
  return { definition, architecture, efficiency, model };
}

async function sourceRecords(
  workbench: Awaited<ReturnType<typeof openProductKnowledgeWorkbench>>,
  projectId: string,
) {
  const runs = await workbench.sourceDatasets.listProject(projectId);
  const views = await Promise.all(runs.map(({ id }) => workbench.sourceDatasets.getRun(id)));
  return views.flatMap((view) => view?.records ?? []);
}

class QueueRuntime implements CategoryInterviewRuntime {
  private readonly outputs: CategoryInterviewRuntimeOutput[] = [];
  push(output: CategoryInterviewRuntimeOutput) { this.outputs.push(output); }
  async *run(): AsyncIterable<CategoryInterviewRuntimeEvent> {
    const output = this.outputs.shift();
    if (!output) throw new Error("missing interview output");
    yield { type: "text_delta", delta: output.assistantText };
    yield { type: "completed", output };
  }
}

async function collect<T>(events: AsyncIterable<T>) {
  for await (const _event of events) {
    // Workbench 是唯一消息与任务书事实源。
  }
}

await main();
