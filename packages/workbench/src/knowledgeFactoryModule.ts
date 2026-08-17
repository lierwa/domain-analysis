import {
  knowledgeClaimCandidateSchema,
  knowledgeClaimCandidateDraftSchema,
  knowledgeConflictSchema,
  knowledgeFactoryBatchSchema,
  knowledgeFactoryBatchViewSchema,
  knowledgeUnknownSchema,
  runKnowledgeFactorySchema,
  type EvidenceItem,
  type EvidenceRequest,
  type KnowledgeClaimCandidate,
  type KnowledgeClaimCandidateDraft,
  type KnowledgeConflict,
  type KnowledgeFactoryBatchView,
  type KnowledgeSubject,
  type KnowledgeValue,
  type ProductProjectView,
} from "@domain-analysis/shared";
import {
  knowledgeFactoryBatches,
  type ProductKnowledgeDb,
} from "@domain-analysis/db";
import { and, eq } from "drizzle-orm";

import { contentHash } from "./contentHash";
import type { EvidenceModule } from "./evidenceModule";
import { KnowledgeFactoryError } from "./knowledgeFactoryError";
import {
  listProjectKnowledgeBatches,
  loadKnowledgeFactoryBatchView,
  persistKnowledgeFactoryOutput,
  requireKnowledgeFactoryBatchView,
} from "./knowledgeFactoryPersistence";
import type {
  KnowledgeCandidateModelInput,
  KnowledgeCandidateModelPort,
  KnowledgeFactoryModuleOptions,
  RunKnowledgeFactory,
} from "./knowledgeFactoryTypes";
import type { ProductProjectModule } from "./productProjectModule";

export type {
  KnowledgeCandidateModelInput,
  KnowledgeCandidateModelPort,
  KnowledgeFactoryModuleOptions,
  RunKnowledgeFactory,
} from "./knowledgeFactoryTypes";
export { KnowledgeFactoryError } from "./knowledgeFactoryError";

export interface KnowledgeFactoryModule {
  run(input: RunKnowledgeFactory): Promise<KnowledgeFactoryBatchView>;
  get(batchId: string): Promise<KnowledgeFactoryBatchView | null>;
  listProject(projectId: string): Promise<KnowledgeFactoryBatchView[]>;
}

export function createKnowledgeFactoryModule(
  db: ProductKnowledgeDb,
  projects: Pick<ProductProjectModule, "get">,
  evidence: Pick<EvidenceModule, "getRequest" | "getObservation" | "assess" | "read">,
  options: KnowledgeFactoryModuleOptions = {},
): KnowledgeFactoryModule {
  const now = options.now ?? (() => new Date());
  return {
    run: (input) => runFactory(db, projects, evidence, input, now, options.candidateModel),
    get: (batchId) => loadKnowledgeFactoryBatchView(db, batchId),
    listProject: (projectId) => listProjectKnowledgeBatches(db, projectId),
  };
}

async function runFactory(
  db: ProductKnowledgeDb,
  projects: Pick<ProductProjectModule, "get">,
  evidence: Pick<EvidenceModule, "getRequest" | "getObservation" | "assess" | "read">,
  rawInput: RunKnowledgeFactory,
  now: () => Date,
  candidateModel: KnowledgeCandidateModelPort | undefined,
) {
  const input = normalizeInput(rawInput);
  const project = await requireProject(projects, input);
  const materials = await Promise.all(input.evidenceRequestIds.map((id) => loadMaterial(evidence, id)));
  validateMaterials(input, materials);
  const inputHash = contentHash({
    ...input,
    materials: materials.map(({ request, assessment, items }) => ({
      request,
      assessment,
      items: items.map(({ item }) => ({ id: item.id, manifestIntegrity: item.manifestIntegrity })),
    })),
  });
  const existing = await db.query.knowledgeFactoryBatches.findFirst({
    where: and(
      eq(knowledgeFactoryBatches.projectId, input.projectId),
      eq(knowledgeFactoryBatches.inputHash, inputHash),
    ),
  });
  if (existing) return requireKnowledgeFactoryBatchView(db, existing.id);

  const createdAt = now().toISOString();
  const batchId = `knowledge-batch-${inputHash.slice(0, 32)}`;
  const output = await buildOutput(
    batchId,
    inputHash,
    input,
    project,
    materials,
    createdAt,
    candidateModel,
  );
  await persistKnowledgeFactoryOutput(db, output);
  return output;
}

function normalizeInput(input: RunKnowledgeFactory) {
  const parsed = runKnowledgeFactorySchema.parse(input);
  return { ...parsed, evidenceRequestIds: [...parsed.evidenceRequestIds].sort() };
}

async function requireProject(
  projects: Pick<ProductProjectModule, "get">,
  input: ReturnType<typeof normalizeInput>,
) {
  const project = await projects.get(input.projectId);
  if (!project || project.project.status !== "ready") {
    throw new KnowledgeFactoryError("project_not_confirmed", "知识工厂只能读取已确认项目");
  }
  if (project.categoryDefinition.id !== input.categoryDefinitionVersionId) {
    throw new KnowledgeFactoryError("input_mismatch", "知识工厂没有绑定当前已确认品类定义");
  }
  return project;
}

async function loadMaterial(
  evidence: Pick<EvidenceModule, "getRequest" | "getObservation" | "assess" | "read">,
  requestId: string,
) {
  const request = await evidence.getRequest(requestId);
  if (!request) throw new KnowledgeFactoryError("request_not_found", `证据请求不存在：${requestId}`);
  const assessment = await evidence.assess(requestId);
  const items = await Promise.all(assessment.evidenceItemIds.map(async (itemId) => {
    const result = await evidence.read(itemId);
    if (!result) throw new KnowledgeFactoryError("request_not_found", `证据不存在：${itemId}`);
    const observation = await evidence.getObservation(result.item.observationId);
    if (!observation) {
      throw new KnowledgeFactoryError("request_not_found", `证据来源观察不存在：${result.item.observationId}`);
    }
    return { ...result, observation };
  }));
  return { request, assessment, items };
}

function validateMaterials(
  input: ReturnType<typeof normalizeInput>,
  materials: Awaited<ReturnType<typeof loadMaterial>>[],
) {
  for (const { request } of materials) {
    if (request.projectId !== input.projectId
      || request.categoryDefinitionVersionId !== input.categoryDefinitionVersionId) {
      throw new KnowledgeFactoryError("input_mismatch", `证据请求不属于冻结输入：${request.id}`);
    }
  }
}

async function buildOutput(
  batchId: string,
  inputHash: string,
  input: ReturnType<typeof normalizeInput>,
  project: ProductProjectView,
  materials: Awaited<ReturnType<typeof loadMaterial>>[],
  createdAt: string,
  candidateModel: KnowledgeCandidateModelPort | undefined,
): Promise<KnowledgeFactoryBatchView> {
  const deterministicCandidates = materials
    .filter(({ request }) => request.knowledgeNeed.kind === "attribute")
    .flatMap((material) => candidatesFromMaterial(
    material,
    input.recipeVersion,
    project,
  ));
  const modelCandidates = await candidatesFromModel(
    input,
    project,
    materials,
    candidateModel,
  );
  const rawCandidates = [...deterministicCandidates, ...modelCandidates];
  const merged = mergeEquivalentCandidates(rawCandidates);
  const conflicts = detectAttributeConflicts(batchId, input, merged, createdAt);
  const conflictKeys = new Set(conflicts.map(conflictKey));
  const candidates = merged.filter((candidate) => !conflictKeys.has(candidateKey(candidate)))
    .map((draft) => persistableCandidate(batchId, input, draft, createdAt));
  const unknowns = [
    ...materials.flatMap((material) => unknownsFromMaterial(
    batchId,
    input,
    material,
    project,
    createdAt,
    )),
    ...unmappedKnowledgeUnknowns(batchId, input, materials, rawCandidates, project, createdAt),
  ];
  const batch = knowledgeFactoryBatchSchema.parse({
    id: batchId,
    projectId: input.projectId,
    categoryDefinitionVersionId: input.categoryDefinitionVersionId,
    recipeVersion: input.recipeVersion,
    inputHash,
    evidenceRequestIds: input.evidenceRequestIds,
    status: "completed",
    candidateCount: candidates.length,
    conflictCount: conflicts.length,
    unknownCount: unknowns.length,
    createdAt,
    finishedAt: createdAt,
  });
  return knowledgeFactoryBatchViewSchema.parse({ batch, candidates, conflicts, unknowns });
}

async function candidatesFromModel(
  input: ReturnType<typeof normalizeInput>,
  project: ProductProjectView,
  materials: Awaited<ReturnType<typeof loadMaterial>>[],
  model: KnowledgeCandidateModelPort | undefined,
) {
  if (!model) return [];
  const modelInput = buildModelInput(input, project, materials);
  if (modelInput.materials.length === 0) return [];
  const candidates = await model.propose(modelInput);
  return candidates.map((candidate) => validateModelCandidate(candidate, modelInput));
}

function buildModelInput(
  input: ReturnType<typeof normalizeInput>,
  project: ProductProjectView,
  materials: Awaited<ReturnType<typeof loadMaterial>>[],
): KnowledgeCandidateModelInput {
  return {
    projectId: input.projectId,
    categoryDefinitionVersionId: input.categoryDefinitionVersionId,
    recipeVersion: input.recipeVersion,
    category: {
      code: project.categoryDefinition.categoryCode,
      label: project.categoryDefinition.label,
    },
    materials: materials.flatMap((material) => {
      if (material.request.knowledgeNeed.kind !== "competency_question") return [];
      const permittedEvidence = material.items.filter(({ observation }) =>
        observation.usagePermission?.modelInput === "allowed");
      if (permittedEvidence.length === 0) return [];
      return [{
        knowledgeNeedId: material.request.knowledgeNeed.id,
        question: material.request.knowledgeNeed.question,
        knowledgeLayer: material.request.knowledgeLayer,
        subjects: material.request.targetKeys.map((key) => subjectFor(project, key)),
        evidence: permittedEvidence.map(({ item, content, observation }) => ({
          id: item.id,
          content: decodeEvidence(content, item),
          sourceIdentity: observation.sourceIdentity,
          sourceAuthorityType: observation.sourceAuthorityType,
        })),
      }];
    }),
  };
}

function validateModelCandidate(
  rawCandidate: KnowledgeClaimCandidateDraft,
  input: KnowledgeCandidateModelInput,
) {
  const candidate = knowledgeClaimCandidateDraftSchema.parse(rawCandidate);
  if (candidate.derivation.kind !== "model") {
    throw new KnowledgeFactoryError("input_mismatch", "模型候选必须记录模型 derivation");
  }
  const material = input.materials.find(({ knowledgeNeedId }) =>
    knowledgeNeedId === candidate.knowledgeNeedId);
  if (!material || material.knowledgeLayer !== candidate.knowledgeLayer
    || !material.subjects.some(({ key }) => key === candidate.subject.key)) {
    throw new KnowledgeFactoryError("input_mismatch", "模型候选引用了批次范围外知识对象");
  }
  const evidenceIds = new Set(material.evidence.map(({ id }) => id));
  if (candidate.evidenceIds.some((id) => !evidenceIds.has(id))) {
    throw new KnowledgeFactoryError("input_mismatch", "模型候选引用了未授权或批次外证据");
  }
  return candidate;
}

function candidatesFromMaterial(
  material: Awaited<ReturnType<typeof loadMaterial>>,
  recipeVersion: string,
  project: ProductProjectView,
) {
  const { request, items } = material;
  return items.flatMap(({ item, content }) => {
    const value = valueFromEvidence(request, item, content, project);
    return item.subjectKeys.map((subjectKey) => ({
      knowledgeNeedId: request.knowledgeNeed.id,
      subject: subjectFor(project, subjectKey),
      knowledgeLayer: request.knowledgeLayer,
      predicate: request.knowledgeNeed.kind === "attribute" ? request.knowledgeNeed.attributeCode : "answers",
      value,
      evidenceIds: [item.id],
      limitations: [request.knowledgeNeed.kind === "attribute"
        ? value.kind === "text"
          ? "证据值没有满足当前属性的确定性规范化条件，保留原文等待审核。"
          : "属性值只做了由品类定义约束的确定性规范化。"
        : "候选保留最小证据原文，尚未经过摘要或跨对象外推。"],
      derivation: { kind: "deterministic" as const, recipeVersion },
      status: "review_required" as const,
    }));
  });
}

function valueFromEvidence(
  request: EvidenceRequest,
  item: EvidenceItem,
  content: Uint8Array,
  project: ProductProjectView,
): KnowledgeValue {
  const raw = decodeEvidence(content, item);
  if (request.knowledgeNeed.kind !== "attribute") return { kind: "text", raw };
  const attributeCode = request.knowledgeNeed.attributeCode;
  const attribute = project.categoryDefinition.attributes.find(
    ({ code }) => code === attributeCode,
  );
  if (!attribute) return { kind: "text", raw };
  const exact = "quote" in item.locator ? item.locator.quote.exact.trim() : raw;
  if (attribute.valueKind === "decimal" && attribute.canonicalUnitCode
    && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(exact)
    && locatorUnitMatches(item, attribute.canonicalUnitCode)) {
    return { kind: "decimal", raw, value: Number(exact), unitCode: attribute.canonicalUnitCode };
  }
  if (attribute.valueKind === "enum" && attribute.allowedValues?.includes(exact)) {
    return { kind: "enum", raw, value: exact };
  }
  return { kind: "text", raw };
}

function locatorUnitMatches(item: EvidenceItem, canonicalUnitCode: string) {
  if (!("quote" in item.locator)) return false;
  return item.locator.quote.suffix?.trim() === canonicalUnitCode;
}

function mergeEquivalentCandidates(drafts: KnowledgeClaimCandidateDraft[]) {
  const groups = groupBy(drafts, (draft) => contentHash({
    knowledgeNeedId: draft.knowledgeNeedId,
    subject: draft.subject,
    knowledgeLayer: draft.knowledgeLayer,
    predicate: draft.predicate,
    value: draft.value,
    limitations: draft.limitations,
    derivation: draft.derivation,
  }));
  return [...groups.values()].map((group) => ({
    ...group[0]!,
    evidenceIds: [...new Set(group.flatMap(({ evidenceIds }) => evidenceIds))].sort(),
  }));
}

function detectAttributeConflicts(
  batchId: string,
  input: ReturnType<typeof normalizeInput>,
  candidates: KnowledgeClaimCandidateDraft[],
  createdAt: string,
) {
  // WHY：不同原理陈述可以共享语义 predicate，并不等于互斥值；冲突比较只适用于确定性属性值。
  const attributeCandidates = candidates.filter(({ derivation, predicate }) =>
    derivation.kind === "deterministic" && predicate !== "answers");
  const groups = groupBy(attributeCandidates, candidateKey);
  return [...groups.entries()].flatMap(([key, group]) => {
    if (group.length < 2) return [];
    const draft = group[0]!;
    return [knowledgeConflictSchema.parse({
      id: `knowledge-conflict-${contentHash({ batchId, key, alternatives: group }).slice(0, 32)}`,
      batchId,
      projectId: input.projectId,
      categoryDefinitionVersionId: input.categoryDefinitionVersionId,
      knowledgeNeedId: draft.knowledgeNeedId,
      subject: draft.subject,
      knowledgeLayer: draft.knowledgeLayer,
      predicate: draft.predicate,
      alternatives: group.map(({ value, evidenceIds }) => ({ value, evidenceIds })),
      reasonCode: "distinct_normalized_values",
      status: "review_required",
      createdAt,
    })];
  });
}

function unknownsFromMaterial(
  batchId: string,
  input: ReturnType<typeof normalizeInput>,
  material: Awaited<ReturnType<typeof loadMaterial>>,
  project: ProductProjectView,
  createdAt: string,
) {
  if (material.assessment.status === "sufficient") return [];
  return material.assessment.targets.filter(({ status }) => status !== "sufficient").map((target) =>
    knowledgeUnknownSchema.parse({
      id: `knowledge-unknown-${contentHash({ batchId, requestId: material.request.id, target }).slice(0, 32)}`,
      batchId,
      projectId: input.projectId,
      categoryDefinitionVersionId: input.categoryDefinitionVersionId,
      knowledgeNeedId: material.request.knowledgeNeed.id,
      subject: subjectFor(project, target.targetKey),
      question: material.request.question,
      reasonCode: target.evidenceItemIds.length === 0 ? "evidence_missing" : "evidence_insufficient",
      evidenceRequestIds: [material.request.id],
      examinedEvidenceIds: target.evidenceItemIds,
      status: "unknown",
      createdAt,
    }));
}

function unmappedKnowledgeUnknowns(
  batchId: string,
  input: ReturnType<typeof normalizeInput>,
  materials: Awaited<ReturnType<typeof loadMaterial>>[],
  candidates: KnowledgeClaimCandidateDraft[],
  project: ProductProjectView,
  createdAt: string,
) {
  return materials.flatMap((material) => {
    if (material.request.knowledgeNeed.kind !== "competency_question"
      || material.assessment.status !== "sufficient") return [];
    const needId = material.request.knowledgeNeed.id;
    return material.request.targetKeys.flatMap((targetKey) => {
      const covered = candidates.some((candidate) =>
        candidate.knowledgeNeedId === needId && candidate.subject.key === targetKey);
      if (covered) return [];
      return [knowledgeUnknownSchema.parse({
        id: `knowledge-unknown-${contentHash({ batchId, requestId: material.request.id, targetKey, reason: "unmapped_evidence" }).slice(0, 32)}`,
        batchId,
        projectId: input.projectId,
        categoryDefinitionVersionId: input.categoryDefinitionVersionId,
        knowledgeNeedId: needId,
        subject: subjectFor(project, targetKey),
        question: material.request.question,
        reasonCode: "unmapped_evidence",
        evidenceRequestIds: [material.request.id],
        examinedEvidenceIds: material.items
          .filter(({ item }) => item.subjectKeys.includes(targetKey))
          .map(({ item }) => item.id),
        status: "unknown",
        createdAt,
      })];
    });
  });
}

function persistableCandidate(
  batchId: string,
  input: ReturnType<typeof normalizeInput>,
  draft: KnowledgeClaimCandidateDraft,
  createdAt: string,
): KnowledgeClaimCandidate {
  return knowledgeClaimCandidateSchema.parse({
    ...draft,
    id: `knowledge-candidate-${contentHash({ batchId, draft }).slice(0, 32)}`,
    batchId,
    projectId: input.projectId,
    categoryDefinitionVersionId: input.categoryDefinitionVersionId,
    createdAt,
  });
}

function subjectFor(project: ProductProjectView, key: string): KnowledgeSubject {
  const target = project.confirmedScope.targets.find((item) => item.key === key);
  if (!target) throw new KnowledgeFactoryError("input_mismatch", `证据引用了未知项目目标：${key}`);
  return { key, kind: target.kind, label: target.label };
}

function decodeEvidence(content: Uint8Array, item: EvidenceItem) {
  if (!item.mediaType.startsWith("text/") && item.mediaType !== "application/json") {
    throw new KnowledgeFactoryError("input_mismatch", `确定性 recipe 不支持证据媒体：${item.mediaType}`);
  }
  const value = new TextDecoder("utf-8", { fatal: true }).decode(content).trim();
  if (!value) throw new KnowledgeFactoryError("input_mismatch", `证据内容为空：${item.id}`);
  return value;
}

function candidateKey(candidate: Pick<KnowledgeClaimCandidateDraft, "knowledgeNeedId" | "subject" | "predicate">) {
  return `${candidate.knowledgeNeedId}\0${candidate.subject.key}\0${candidate.predicate}`;
}

function conflictKey(conflict: KnowledgeConflict) {
  return `${conflict.knowledgeNeedId}\0${conflict.subject.key}\0${conflict.predicate}`;
}

function groupBy<T>(items: readonly T[], keyFor: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}
