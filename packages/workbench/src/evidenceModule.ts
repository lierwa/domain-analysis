import { createHash, randomUUID } from "node:crypto";

import {
  evidenceAssessmentSchema,
  evidenceCandidateSchema,
  evidenceItemSchema,
  evidenceManifestSchema,
  evidenceRequestDraftSchema,
  evidenceRequestSchema,
  sourceObservationDraftSchema,
  sourceObservationSchema,
  type EvidenceAssessment,
  type EvidenceCandidate,
  type EvidenceItem,
  type EvidenceRequest,
  type EvidenceRequestDraft,
  type ProjectEvidenceRequestView,
  type SourceObservation,
  type SourceObservationDraft,
} from "@domain-analysis/shared";
import {
  evidenceItems,
  evidenceRequests,
  sourceObservations,
  type ProductKnowledgeDb,
} from "@domain-analysis/db";
import canonicalize from "canonicalize";
import { and, asc, eq } from "drizzle-orm";

import type { ContentAddressedStore } from "./cacacheContentStore";
import { contentHash } from "./contentHash";
import type { ProductProjectModule } from "./productProjectModule";
import { listProjectEvidence } from "./projectEvidenceReader";
import { validateEvidenceCandidate } from "./evidenceCandidateValidation";
import { EvidenceError } from "./evidenceError";

export { EvidenceError, type EvidenceErrorCode } from "./evidenceError";

export interface EvidenceModule {
  createRequest(input: EvidenceRequestDraft): Promise<EvidenceRequest>;
  getRequest(requestId: string): Promise<EvidenceRequest | null>;
  getObservation(observationId: string): Promise<SourceObservation | null>;
  recordObservation(input: SourceObservationDraft): Promise<SourceObservation>;
  commit(candidate: EvidenceCandidate, content: Uint8Array): Promise<EvidenceItem>;
  read(itemId: string): Promise<{ item: EvidenceItem; content: Uint8Array } | null>;
  assess(requestId: string): Promise<EvidenceAssessment>;
  listProject(projectId: string): Promise<ProjectEvidenceRequestView[]>;
}

export interface EvidenceModuleOptions {
  now?: () => Date;
  createId?: (kind: "request" | "observation" | "evidence") => string;
}

export function createEvidenceModule(
  db: ProductKnowledgeDb,
  projects: ProductProjectModule,
  contentStore: ContentAddressedStore,
  options: EvidenceModuleOptions = {},
): EvidenceModule {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((kind) => `${kind}-${randomUUID()}`);

  const evidence: EvidenceModule = {
    createRequest: (input) => createRequest(db, projects, input, now, createId),
    getRequest: (requestId) => loadRequest(db, requestId),
    getObservation: (observationId) => loadObservation(db, observationId),
    recordObservation: (input) => recordObservation(db, input, now, createId),
    commit: (candidate, content) => commitEvidence(
      db, contentStore, candidate, content, now, createId,
    ),
    read: (itemId) => readEvidence(db, contentStore, itemId),
    assess: (requestId) => assessEvidence(db, requestId),
    listProject: (projectId) => listProjectEvidence(db, evidence, projectId),
  };
  return evidence;
}
async function createRequest(
  db: ProductKnowledgeDb,
  projects: ProductProjectModule,
  rawInput: EvidenceRequestDraft,
  now: () => Date,
  createId: NonNullable<EvidenceModuleOptions["createId"]>,
) {
  const input = evidenceRequestDraftSchema.parse(rawInput);
  const project = await projects.get(input.projectId);
  validateRequestAgainstProject(input, project);
  const requestContentHash = contentHash(input);
  const existing = await db.query.evidenceRequests.findFirst({
    where: (table, operators) => operators.and(
      operators.eq(table.projectId, input.projectId),
      operators.eq(table.contentHash, requestContentHash),
    ),
  });
  // WHY：证据请求是“为什么采”的内容事实；相同冻结输入重试时复用同一请求，避免重复事实源。
  if (existing) return evidenceRequestSchema.parse(existing.request);
  const request = evidenceRequestSchema.parse({
    ...input,
    id: createId("request"),
    createdAt: now().toISOString(),
  });
  await db.insert(evidenceRequests).values({
    id: request.id,
    projectId: request.projectId,
    categoryDefinitionVersionId: request.categoryDefinitionVersionId,
    confirmedScopeVersionId: request.confirmedScopeVersionId,
    collectionBoardVersionId: request.collectionBoardVersionId,
    contentHash: requestContentHash,
    request,
    createdAt: request.createdAt,
  });
  return request;
}
function validateRequestAgainstProject(
  request: EvidenceRequestDraft,
  view: Awaited<ReturnType<ProductProjectModule["get"]>>,
) {
  if (!view || view.project.status !== "ready") {
    throw new EvidenceError("project_not_confirmed", "证据请求只能绑定已确认项目");
  }
  const versionMatches = request.categoryDefinitionVersionId === view.categoryDefinition.id
    && request.confirmedScopeVersionId === view.confirmedScope.id
    && request.collectionBoardVersionId === view.collectionBoard.id;
  if (!versionMatches) rejectScope("证据请求没有绑定当前已确认版本");

  const includedTargets = new Set(view.confirmedScope.targets
    .filter((target) => target.disposition === "included")
    .map((target) => target.key));
  if (request.targetKeys.some((key) => !includedTargets.has(key))) {
    rejectScope("证据请求包含未确认目标");
  }
  validateKnowledgeNeed(request, view.categoryDefinition);

  const lanes = request.collectionLaneIds.map((id) =>
    view.collectionBoard.lanes.find((lane) => lane.id === id));
  if (lanes.some((lane) => !lane)) rejectScope("证据请求引用了未知搜集路线");
  const confirmedLanes = lanes.filter((lane) => lane !== undefined);
  const sourceTypes = new Set(confirmedLanes.map((lane) => lane.sourceAuthorityType));
  if (request.allowedSourceAuthorityTypes.some((source) => !sourceTypes.has(source))) {
    rejectScope("证据请求使用了搜集板之外的来源类型");
  }
  for (const targetKey of request.targetKeys) {
    const covered = confirmedLanes.some((lane) => lane.targetKeys.includes(targetKey)
      && lane.knowledgeLayers.includes(request.knowledgeLayer));
    if (!covered) rejectScope(`目标 ${targetKey} 没有覆盖该知识层的搜集路线`);
  }
}
function validateKnowledgeNeed(
  request: EvidenceRequestDraft,
  definition: NonNullable<Awaited<ReturnType<ProductProjectModule["get"]>>>["categoryDefinition"],
) {
  if (request.knowledgeNeed.kind === "attribute") {
    const attributeCode = request.knowledgeNeed.attributeCode;
    const attribute = definition.attributes.find(
      (item) => item.code === attributeCode,
    );
    if (!attribute || attribute.knowledgeLayer !== request.knowledgeLayer) {
      rejectScope("属性知识需求不属于当前品类定义或知识层不一致");
    }
    return;
  }
  if (!definition.competencyQuestions.includes(request.knowledgeNeed.question)) {
    rejectScope("问题知识需求没有经过当前品类定义确认");
  }
}
async function recordObservation(
  db: ProductKnowledgeDb,
  rawInput: SourceObservationDraft,
  now: () => Date,
  createId: NonNullable<EvidenceModuleOptions["createId"]>,
) {
  const input = sourceObservationDraftSchema.parse(rawInput);
  const request = await requireRequest(db, input.requestId);
  if (!request.allowedSourceAuthorityTypes.includes(input.sourceAuthorityType)) {
    rejectCandidate("来源观察不属于证据请求允许的来源");
  }
  if (input.subjectKeys.some((key) => !request.targetKeys.includes(key))) {
    rejectCandidate("来源观察包含证据请求之外的对象");
  }
  if (input.sourceSnapshotId) {
    const existing = await db.query.sourceObservations.findFirst({
      where: and(
        eq(sourceObservations.requestId, input.requestId),
        eq(sourceObservations.sourceSnapshotId, input.sourceSnapshotId),
      ),
    });
    if (existing) {
      const observation = sourceObservationSchema.parse(existing.observation);
      const { id: _id, createdAt: _createdAt, ...draft } = observation;
      if (contentHash(draft) !== contentHash(input)) {
        rejectCandidate("同一证据请求和来源快照对应了不同来源观察");
      }
      return observation;
    }
  }
  const observation = sourceObservationSchema.parse({
    ...input,
    id: createId("observation"),
    createdAt: now().toISOString(),
  });
  await db.insert(sourceObservations).values({
    id: observation.id,
    requestId: observation.requestId,
    sourceSnapshotId: observation.sourceSnapshotId,
    sourceIdentity: observation.sourceIdentity,
    sourceAuthorityType: observation.sourceAuthorityType,
    finalUrl: observation.finalUrl,
    state: observation.state,
    observation,
    observedAt: observation.observedAt,
    createdAt: observation.createdAt,
  });
  return observation;
}

async function commitEvidence(
  db: ProductKnowledgeDb,
  store: ContentAddressedStore,
  rawCandidate: EvidenceCandidate,
  content: Uint8Array,
  now: () => Date,
  createId: NonNullable<EvidenceModuleOptions["createId"]>,
) {
  const candidate = evidenceCandidateSchema.parse(rawCandidate);
  if (!(content instanceof Uint8Array) || content.byteLength === 0) {
    rejectCandidate("最小证据内容不能为空");
  }
  const [request, observation] = await Promise.all([
    requireRequest(db, candidate.requestId),
    requireObservation(db, candidate.observationId),
  ]);
  await validateEvidenceCandidate(candidate, content, request, observation, now());

  if (candidate.idempotencyKey) {
    const existing = await db.query.evidenceItems.findFirst({
      where: and(
        eq(evidenceItems.requestId, candidate.requestId),
        eq(evidenceItems.idempotencyKey, candidate.idempotencyKey),
      ),
    });
    if (existing) {
      const saved = await readEvidence(db, store, existing.id);
      if (!saved) throw new EvidenceError("not_found", `幂等证据不存在：${existing.id}`);
      assertIdempotentEvidence(saved.item, candidate, content);
      return saved.item;
    }
  }

  const storedContent = await store.put({
    privacyClass: candidate.privacyClass,
    content,
    metadata: { requestId: request.id, observationId: observation.id, kind: candidate.kind },
  });
  const createdAt = now().toISOString();
  const manifest = evidenceManifestSchema.parse({
    ...candidate,
    id: createId("evidence"),
    contentIntegrity: storedContent.integrity,
    contentBytes: storedContent.bytes,
    evidencePolicyVersion: request.evidencePolicyVersion,
    capturedAt: observation.observedAt,
    createdAt,
  });
  const storedManifest = await store.put({
    privacyClass: manifest.privacyClass,
    content: new TextEncoder().encode(serializeCanonical(manifest)),
    metadata: { evidenceId: manifest.id, role: "evidence-manifest" },
  });
  const item = evidenceItemSchema.parse({ ...manifest, manifestIntegrity: storedManifest.integrity });
  await db.insert(evidenceItems).values({
    id: item.id,
    requestId: item.requestId,
    observationId: item.observationId,
    idempotencyKey: item.idempotencyKey,
    subjectKeys: item.subjectKeys,
    kind: item.kind,
    privacyClass: item.privacyClass,
    contentIntegrity: item.contentIntegrity,
    contentBytes: item.contentBytes,
    manifestIntegrity: item.manifestIntegrity,
    evidencePolicyVersion: item.evidencePolicyVersion,
    createdAt: item.createdAt,
  });
  return item;
}

async function readEvidence(
  db: ProductKnowledgeDb,
  store: ContentAddressedStore,
  itemId: string,
) {
  const row = await db.query.evidenceItems.findFirst({ where: eq(evidenceItems.id, itemId) });
  if (!row) return null;
  const manifestBytes = await store.get(row.privacyClass, row.manifestIntegrity);
  const manifest = evidenceManifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
  assertManifestMatchesRow(manifest, row);
  const item = evidenceItemSchema.parse({ ...manifest, manifestIntegrity: row.manifestIntegrity });
  const content = await store.get(item.privacyClass, item.contentIntegrity);
  if (content.byteLength !== item.contentBytes) {
    throw new EvidenceError("integrity_mismatch", `证据字节数不匹配：${item.id}`);
  }
  return { item, content };
}

async function assessEvidence(db: ProductKnowledgeDb, requestId: string) {
  const request = await requireRequest(db, requestId);
  const [observationRows, items] = await Promise.all([
    db.select().from(sourceObservations)
      .where(eq(sourceObservations.requestId, requestId))
      .orderBy(asc(sourceObservations.observedAt)),
    db.select().from(evidenceItems)
      .where(eq(evidenceItems.requestId, requestId))
      .orderBy(asc(evidenceItems.createdAt)),
  ]);
  const observations = observationRows.map((row) => sourceObservationSchema.parse(row.observation));
  const targets = request.targetKeys.map((targetKey) =>
    assessTarget(request, targetKey, observations, items));
  const reasons = [...new Set(targets.flatMap((target) => target.reasonCodes))];
  return evidenceAssessmentSchema.parse({
    requestId,
    status: resolveOverallStatus(targets),
    evidenceItemIds: items.map((item) => item.id),
    observationIds: observations.map((observation) => observation.id),
    targets,
    reasonCodes: reasons,
  });
}

function assessTarget(
  request: EvidenceRequest,
  targetKey: string,
  observations: SourceObservation[],
  items: Array<typeof evidenceItems.$inferSelect>,
): EvidenceAssessment["targets"][number] {
  const targetObservations = observations.filter((item) => item.subjectKeys.includes(targetKey));
  const targetItems = items.filter((item) => item.subjectKeys.includes(targetKey));
  const usedObservationIds = new Set(targetItems.map((item) => item.observationId));
  const distinctSources = new Set(targetObservations
    .filter((observation) => usedObservationIds.has(observation.id))
    .map((observation) => observation.sourceIdentity));
  const reasons: EvidenceAssessment["reasonCodes"] = [];
  if (targetItems.length < request.minimumEvidenceItemsPerTarget) {
    reasons.push("minimum_evidence_not_met");
  }
  if (distinctSources.size < request.minimumDistinctSourcesPerTarget) {
    reasons.push("minimum_distinct_sources_not_met");
  }
  return {
    targetKey,
    status: resolveAssessmentStatus(targetObservations, reasons),
    evidenceItemIds: targetItems.map((item) => item.id),
    observationIds: targetObservations.map((item) => item.id),
    distinctSourceCount: distinctSources.size,
    reasonCodes: addAccessReason(targetObservations, reasons),
  };
}

function resolveOverallStatus(
  targets: EvidenceAssessment["targets"],
): EvidenceAssessment["status"] {
  if (targets.every((target) => target.status === "sufficient")) return "sufficient";
  if (targets.some((target) => target.status === "waiting")) return "waiting";
  if (targets.every((target) => target.status === "not_started")) return "not_started";
  if (targets.every((target) => target.status === "failed")) return "failed";
  return "insufficient";
}

function resolveAssessmentStatus(
  observations: Array<{ state: string }>,
  reasons: EvidenceAssessment["reasonCodes"],
): EvidenceAssessment["status"] {
  if (reasons.length === 0) return "sufficient";
  if (observations.length === 0) return "not_started";
  if (observations.some((item) => ["login_required", "verification_required"].includes(item.state))) {
    return "waiting";
  }
  if (observations.some((item) => item.state === "accessible")) return "insufficient";
  return "failed";
}

function addAccessReason(
  observations: Array<{ state: string }>,
  reasons: EvidenceAssessment["reasonCodes"],
) {
  const result = [...reasons];
  if (observations.some((item) => ["login_required", "verification_required"].includes(item.state))) {
    result.push("access_waiting");
  } else if (observations.length > 0 && !observations.some((item) => item.state === "accessible")) {
    result.push("no_accessible_source");
  }
  return result;
}

async function loadRequest(db: ProductKnowledgeDb, requestId: string) {
  const row = await db.query.evidenceRequests.findFirst({ where: eq(evidenceRequests.id, requestId) });
  return row ? evidenceRequestSchema.parse(row.request) : null;
}

async function requireRequest(db: ProductKnowledgeDb, requestId: string) {
  const request = await loadRequest(db, requestId);
  if (!request) throw new EvidenceError("not_found", `证据请求不存在：${requestId}`);
  return request;
}

async function requireObservation(db: ProductKnowledgeDb, observationId: string) {
  const observation = await loadObservation(db, observationId);
  if (!observation) throw new EvidenceError("not_found", `来源观察不存在：${observationId}`);
  return observation;
}

async function loadObservation(db: ProductKnowledgeDb, observationId: string) {
  const row = await db.query.sourceObservations.findFirst({
    where: eq(sourceObservations.id, observationId),
  });
  return row ? sourceObservationSchema.parse(row.observation) : null;
}

function assertManifestMatchesRow(
  manifest: ReturnType<typeof evidenceManifestSchema.parse>,
  row: typeof evidenceItems.$inferSelect,
) {
  const matches = manifest.id === row.id
    && manifest.requestId === row.requestId
    && manifest.observationId === row.observationId
    && manifest.idempotencyKey === (row.idempotencyKey ?? undefined)
    && manifest.contentIntegrity === row.contentIntegrity
    && manifest.contentBytes === row.contentBytes
    && manifest.privacyClass === row.privacyClass
    && manifest.subjectKeys.join("\0") === row.subjectKeys.join("\0");
  if (!matches) throw new EvidenceError("integrity_mismatch", `证据 manifest 与目录不一致：${row.id}`);
}

function assertIdempotentEvidence(
  item: EvidenceItem,
  candidate: EvidenceCandidate,
  content: Uint8Array,
) {
  const expectedIntegrity = `sha256-${createHash("sha256").update(content).digest("base64")}`;
  const same = item.requestId === candidate.requestId
    && item.observationId === candidate.observationId
    && item.idempotencyKey === candidate.idempotencyKey
    && item.kind === candidate.kind
    && item.mediaType === candidate.mediaType
    && item.privacyClass === candidate.privacyClass
    && item.contentIntegrity === expectedIntegrity
    && contentHash(item.subjectKeys) === contentHash(candidate.subjectKeys)
    && contentHash(item.relationProof) === contentHash(candidate.relationProof)
    && contentHash(item.locator) === contentHash(candidate.locator);
  if (!same) rejectCandidate("证据幂等键已对应不同内容或定位");
}

function serializeCanonical(value: unknown) {
  const serialized = canonicalize(value);
  if (serialized === undefined) throw new Error("RFC 8785 不能序列化证据 manifest");
  return serialized;
}

function rejectScope(message: string): never {
  throw new EvidenceError("request_outside_confirmed_scope", message);
}

function rejectCandidate(message: string): never {
  throw new EvidenceError("candidate_rejected", message);
}
