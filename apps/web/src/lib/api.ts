import {
  categoryInterviewViewSchema,
  evidenceItemSchema,
  interviewTurnRequestSchema,
  interviewTimelineEventSchema,
  knowledgeFactoryBatchViewSchema,
  knowledgePackageDescriptorSchema,
  knowledgeReviewDecisionSchema,
  marketUniverseVersionSchema,
  projectEvidenceRequestViewSchema,
  regulatoryReconciliationRunSchema,
  sourceCollectionRunSchema,
  sourceCollectionRunViewSchema,
  type CategoryInterviewView,
  type InterviewSession,
  ConfirmedProjectSnapshot,
  type InterviewTimelineEvent,
  type InterviewTurnRequest,
  type KnowledgeFactoryBatchView,
  type KnowledgePackageDescriptor,
  type KnowledgeReviewDecision,
  type KnowledgeReviewDecisionDraft,
  type ReviewedKnowledgeEntry,
  type MarketUniverseVersion,
  ProductKnowledgeProject,
  ProductProjectDraftInput,
  ProductProjectView,
  type ProjectEvidenceRequestView,
  type RegulatoryReconciliationRun,
  type SourceCollectionRun,
  type SourceCollectionRunView,
  type SourceEvidenceSelection,
} from "@domain-analysis/shared";
import { createParser } from "eventsource-parser";
import { apiErrorFromResponse, request } from "./apiClient";

export * from "./analysisApi";
export { ApiError, buildQueryString } from "./apiClient";

// WHY: API client 只暴露业务接口，避免 UI 依赖服务端内部模块。

// ─── Product Knowledge Projects ──────────────────────────────────────────────

export async function startCategoryInterview(categoryHint: string): Promise<CategoryInterviewView> {
  const data = await request<{ item: CategoryInterviewView }>("/api/category-interviews", {
    method: "POST",
    body: JSON.stringify({ categoryHint }),
  });
  return categoryInterviewViewSchema.parse(data.item);
}

export async function fetchCategoryInterviews(): Promise<InterviewSession[]> {
  const data = await request<{ items: InterviewSession[] }>("/api/category-interviews");
  return data.items;
}

export async function fetchCategoryInterview(sessionId: string): Promise<CategoryInterviewView> {
  const data = await request<{ item: CategoryInterviewView }>(`/api/category-interviews/${sessionId}`);
  return categoryInterviewViewSchema.parse(data.item);
}

export async function confirmInterviewDecision(
  sessionId: string,
  decisionId: string,
  expectedRevision: number,
): Promise<CategoryInterviewView> {
  const data = await request<{ item: CategoryInterviewView }>(
    `/api/category-interviews/${sessionId}/decisions/${decisionId}/confirm`,
    { method: "POST", body: JSON.stringify({ expectedRevision }) },
  );
  return categoryInterviewViewSchema.parse(data.item);
}

export async function confirmCategoryResearchBrief(
  sessionId: string,
  briefId: string,
  expectedRevision: number,
) {
  return request<{
    item: { interview: CategoryInterviewView; brief: { id: string }; project: ProductProjectView };
  }>(`/api/category-interviews/${sessionId}/briefs/${briefId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision }),
  });
}

export async function streamCategoryInterviewTurn(
  sessionId: string,
  input: InterviewTurnRequest,
  onEvent: (event: InterviewTimelineEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/category-interviews/${sessionId}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(interviewTurnRequestSchema.parse(input)),
    signal,
  });
  if (!response.ok || !response.body) throw await apiErrorFromResponse(response);
  const parser = createParser({
    onEvent: (event) => onEvent(interviewTimelineEventSchema.parse(JSON.parse(event.data))),
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
  }
  parser.feed(decoder.decode());
}

export async function fetchProductProjects(): Promise<ProductKnowledgeProject[]> {
  const data = await request<{ items: ProductKnowledgeProject[] }>("/api/product-projects");
  return data.items;
}

export async function fetchProductProject(projectId: string): Promise<ProductProjectView> {
  const data = await request<{ item: ProductProjectView }>(`/api/product-projects/${projectId}`);
  return data.item;
}

export async function saveProductProjectDraft(
  input: ProductProjectDraftInput
): Promise<ProductProjectView> {
  const data = await request<{ item: ProductProjectView }>("/api/product-projects/draft", {
    method: "PUT",
    body: JSON.stringify(input)
  });
  return data.item;
}

export async function confirmProductProject(
  projectId: string,
  expectedRevision: number
): Promise<ConfirmedProjectSnapshot> {
  const data = await request<{ item: ConfirmedProjectSnapshot }>(
    `/api/product-projects/${projectId}/confirm`,
    { method: "POST", body: JSON.stringify({ expectedRevision }) }
  );
  return data.item;
}

export async function fetchProjectEvidence(
  projectId: string,
): Promise<ProjectEvidenceRequestView[]> {
  const data = await request<{ items: unknown[] }>(`/api/product-projects/${projectId}/evidence`);
  return projectEvidenceRequestViewSchema.array().parse(data.items);
}

export async function fetchSourceCollectionRuns(
  projectId: string,
): Promise<SourceCollectionRun[]> {
  const data = await request<{ items: unknown[] }>(
    `/api/product-projects/${encodeURIComponent(projectId)}/source-runs`,
  );
  return sourceCollectionRunSchema.array().parse(data.items);
}

export async function fetchSourceCollectionRun(
  projectId: string,
  runId: string,
): Promise<SourceCollectionRunView> {
  const data = await request<{ item: unknown }>(
    `/api/product-projects/${encodeURIComponent(projectId)}/source-runs/${encodeURIComponent(runId)}`,
  );
  return sourceCollectionRunViewSchema.parse(data.item);
}

export function sourceRunExportUrl(
  projectId: string,
  runId: string,
  format: "jsonl" | "csv",
) {
  const project = encodeURIComponent(projectId);
  const run = encodeURIComponent(runId);
  return `/api/product-projects/${project}/source-runs/${run}/export?format=${format}`;
}

export async function materializeSourceEvidence(
  projectId: string,
  snapshotId: string,
  requestId: string,
  selection: SourceEvidenceSelection,
) {
  const data = await request<{ item: unknown }>(
    `/api/product-projects/${encodeURIComponent(projectId)}/source-snapshots/${encodeURIComponent(snapshotId)}/evidence`,
    { method: "POST", body: JSON.stringify({ requestId, selection }) },
  );
  return evidenceItemSchema.parse(data.item);
}

export async function fetchKnowledgeBatches(projectId: string): Promise<KnowledgeFactoryBatchView[]> {
  const data = await request<{ items: unknown[] }>(
    `/api/product-projects/${encodeURIComponent(projectId)}/knowledge-batches`,
  );
  return knowledgeFactoryBatchViewSchema.array().parse(data.items);
}

export async function runKnowledgeFactory(input: {
  projectId: string;
  categoryDefinitionVersionId: string;
  recipeVersion: string;
  evidenceRequestIds: string[];
}): Promise<KnowledgeFactoryBatchView> {
  const { projectId, ...body } = input;
  const data = await request<{ item: unknown }>(
    `/api/product-projects/${encodeURIComponent(projectId)}/knowledge-batches`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return knowledgeFactoryBatchViewSchema.parse(data.item);
}

export async function fetchKnowledgeBatch(projectId: string, batchId: string): Promise<{
  item: KnowledgeFactoryBatchView;
  decisions: KnowledgeReviewDecision[];
}> {
  const data = await request<{ item: unknown; decisions: unknown[] }>(
    `/api/product-projects/${encodeURIComponent(projectId)}/knowledge-batches/${encodeURIComponent(batchId)}`,
  );
  return {
    item: knowledgeFactoryBatchViewSchema.parse(data.item),
    decisions: knowledgeReviewDecisionSchema.array().parse(data.decisions),
  };
}

export async function submitKnowledgeReview(
  batchId: string,
  input: Omit<KnowledgeReviewDecisionDraft, "batchId">,
): Promise<KnowledgeReviewDecision> {
  const data = await request<{ item: unknown }>(
    `/api/knowledge-batches/${encodeURIComponent(batchId)}/reviews`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return knowledgeReviewDecisionSchema.parse(data.item);
}

export async function fetchReviewedKnowledge(projectId: string): Promise<ReviewedKnowledgeEntry[]> {
  const data = await request<{ items: ReviewedKnowledgeEntry[] }>(
    `/api/product-projects/${encodeURIComponent(projectId)}/reviewed-knowledge`,
  );
  return data.items;
}

export async function fetchKnowledgePackages(projectId: string): Promise<{
  items: KnowledgePackageDescriptor[];
  active: KnowledgePackageDescriptor | null;
}> {
  const data = await request<{ items: unknown[]; active: unknown }>(
    `/api/product-projects/${encodeURIComponent(projectId)}/knowledge-packages`,
  );
  return {
    items: knowledgePackageDescriptorSchema.array().parse(data.items),
    active: data.active ? knowledgePackageDescriptorSchema.parse(data.active) : null,
  };
}

export async function buildKnowledgePackage(projectId: string) {
  const data = await request<{ item: unknown }>(
    `/api/product-projects/${encodeURIComponent(projectId)}/knowledge-packages`,
    { method: "POST" },
  );
  return knowledgePackageDescriptorSchema.parse(data.item);
}

export async function activateKnowledgePackage(projectId: string, versionHash: string) {
  const data = await request<{ item: unknown }>(
    `/api/product-projects/${encodeURIComponent(projectId)}/knowledge-packages/${encodeURIComponent(versionHash)}/activate`,
    { method: "POST" },
  );
  return knowledgePackageDescriptorSchema.parse(data.item);
}

export async function rollbackKnowledgePackage(projectId: string) {
  const data = await request<{ item: unknown }>(
    `/api/product-projects/${encodeURIComponent(projectId)}/knowledge-packages/rollback`,
    { method: "POST" },
  );
  return knowledgePackageDescriptorSchema.parse(data.item);
}

export async function fetchMarketUniverse(projectId: string): Promise<MarketUniverseVersion | null> {
  const data = await request<{ item: unknown }>(`/api/product-projects/${projectId}/market-universe`);
  return data.item ? marketUniverseVersionSchema.parse(data.item) : null;
}

export async function refreshMarketUniverse(projectId: string): Promise<MarketUniverseVersion> {
  const data = await request<{ item: unknown }>(
    `/api/product-projects/${projectId}/market-universe/refresh`,
    { method: "POST" },
  );
  return marketUniverseVersionSchema.parse(data.item);
}

export async function confirmMarketUniverse(
  projectId: string,
  expectedVersion: number,
  expectedContentHash: string,
): Promise<MarketUniverseVersion> {
  const data = await request<{ item: unknown }>(
    `/api/product-projects/${projectId}/market-universe/confirm`,
    {
      method: "POST",
      body: JSON.stringify({ expectedVersion, expectedContentHash }),
    },
  );
  return marketUniverseVersionSchema.parse(data.item);
}

export async function startRegulatoryReconciliation(
  projectId: string,
): Promise<RegulatoryReconciliationRun> {
  const data = await request<{ item: unknown }>(
    `/api/product-projects/${projectId}/market-universe/regulatory-reconciliations`,
    { method: "POST" },
  );
  return regulatoryReconciliationRunSchema.parse(data.item);
}

export async function fetchLatestRegulatoryReconciliation(
  projectId: string,
): Promise<RegulatoryReconciliationRun | null> {
  const data = await request<{ item: unknown }>(
    `/api/product-projects/${projectId}/market-universe/regulatory-reconciliations`,
  );
  return data.item ? regulatoryReconciliationRunSchema.parse(data.item) : null;
}

export async function fetchRegulatoryReconciliation(
  projectId: string,
  runId: string,
): Promise<RegulatoryReconciliationRun> {
  const data = await request<{ item: unknown }>(
    `/api/product-projects/${projectId}/market-universe/regulatory-reconciliations/${runId}`,
  );
  return regulatoryReconciliationRunSchema.parse(data.item);
}

export async function cancelRegulatoryReconciliation(
  projectId: string,
  runId: string,
): Promise<RegulatoryReconciliationRun> {
  const data = await request<{ item: unknown }>(
    `/api/product-projects/${projectId}/market-universe/regulatory-reconciliations/${runId}/cancel`,
    { method: "POST" },
  );
  return regulatoryReconciliationRunSchema.parse(data.item);
}
