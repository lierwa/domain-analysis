import {
  captureTaskSchema,
  crawlPlanningEventSchema,
  crawlPlanningRunRequestSchema,
  crawlPlanningViewSchema,
  categoryInterviewViewSchema,
  interviewTimelineEventSchema,
  interviewTurnRequestSchema,
  sourceDatasetTaskViewSchema,
  sourceDatasetRecordPageSchema,
  sourceDatasetRunViewSchema,
  sourceExecutionAcceptanceSchema,
  sourcePreparationSchema,
  taskModelSelectionSchema,
  type CaptureTask,
  type CategoryInterviewView,
  type CrawlPlanningEvent,
  type InterviewSession,
  type InterviewTimelineEvent,
  type InterviewTurnRequest,
  type SourceDatasetTaskView,
  type SourceDatasetRecordGroupKey,
  type SourceDatasetRecordPage,
  type SourceDatasetRunView,
  type TaskModelSelection,
} from "@domain-analysis/shared";
import { createParser } from "eventsource-parser";

import { apiErrorFromResponse, request } from "./apiClient";

export { ApiError } from "./apiClient";

export async function startCategoryInterview(
  initialRequest: string,
  modelSelection?: TaskModelSelection,
): Promise<CategoryInterviewView> {
  const data = await request<{ item: unknown }>("/api/category-interviews", {
    method: "POST",
    body: JSON.stringify({ initialRequest, modelSelection }),
  });
  return categoryInterviewViewSchema.parse(data.item);
}

export async function updateInterviewModelSelection(
  sessionId: string,
  expectedRevision: number,
  modelSelection: TaskModelSelection,
): Promise<CategoryInterviewView> {
  const data = await request<{ item: unknown }>(
    `/api/category-interviews/${encodeURIComponent(sessionId)}/model-selection`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision,
        modelSelection: taskModelSelectionSchema.parse(modelSelection),
      }),
    },
  );
  return categoryInterviewViewSchema.parse(data.item);
}

export async function fetchCategoryInterviews(): Promise<InterviewSession[]> {
  const data = await request<{ items: InterviewSession[] }>("/api/category-interviews");
  return data.items;
}

export async function fetchCategoryInterview(sessionId: string): Promise<CategoryInterviewView> {
  const data = await request<{ item: unknown }>(`/api/category-interviews/${sessionId}`);
  return categoryInterviewViewSchema.parse(data.item);
}

export async function deleteCategoryInterview(sessionId: string) {
  await request<void>(`/api/category-interviews/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

export async function fetchCaptureTaskInterview(taskId: string): Promise<CategoryInterviewView> {
  const data = await request<{ item: unknown }>(
    `/api/capture-tasks/${encodeURIComponent(taskId)}/interview`,
  );
  return categoryInterviewViewSchema.parse(data.item);
}

export async function confirmCaptureTaskDraft(
  sessionId: string,
  draftId: string,
  expectedRevision: number,
) {
  const data = await request<{ item: { interview: unknown; task: unknown } }>(
    `/api/category-interviews/${sessionId}/task-drafts/${draftId}/confirm`,
    { method: "POST", body: JSON.stringify({ expectedRevision }) },
  );
  return {
    interview: categoryInterviewViewSchema.parse(data.item.interview),
    task: captureTaskSchema.parse(data.item.task),
  };
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

export async function fetchCaptureTasks(): Promise<CaptureTask[]> {
  const data = await request<{ items: unknown[] }>("/api/capture-tasks");
  return captureTaskSchema.array().parse(data.items);
}

export async function fetchCaptureTask(taskId: string): Promise<CaptureTask> {
  const data = await request<{ item: unknown }>(`/api/capture-tasks/${encodeURIComponent(taskId)}`);
  return captureTaskSchema.parse(data.item);
}

export async function deleteCaptureTask(taskId: string) {
  await request<void>(`/api/capture-tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

export async function fetchSourceCollectionRuns(taskId: string): Promise<SourceDatasetTaskView> {
  const data = await request<{ item: unknown }>(
    `/api/capture-tasks/${encodeURIComponent(taskId)}/source-runs`,
  );
  return sourceDatasetTaskViewSchema.parse(data.item);
}

export async function fetchSourceDatasetRecords(taskId: string, input: {
  sourceKey: string;
  targetKey: string;
  groupKey: SourceDatasetRecordGroupKey;
  cursor?: string;
  limit?: number;
}): Promise<SourceDatasetRecordPage> {
  const query = new URLSearchParams({ sourceKey: input.sourceKey, targetKey: input.targetKey,
    groupKey: input.groupKey, limit: String(input.limit ?? 30) });
  if (input.cursor) query.set("cursor", input.cursor);
  const data = await request<{ item: unknown }>(
    `/api/capture-tasks/${encodeURIComponent(taskId)}/source-map/records?${query.toString()}`,
  );
  return sourceDatasetRecordPageSchema.parse(data.item);
}

export async function fetchSourceCollectionRun(taskId: string, runId: string): Promise<SourceDatasetRunView> {
  const data = await request<{ item: unknown }>(
    `/api/capture-tasks/${encodeURIComponent(taskId)}/source-runs/${encodeURIComponent(runId)}`,
  );
  return sourceDatasetRunViewSchema.parse(data.item);
}

export function sourceRunExportUrl(taskId: string, runId: string, format: "jsonl" | "csv") {
  return `/api/capture-tasks/${encodeURIComponent(taskId)}/source-runs/${encodeURIComponent(runId)}/export?format=${format}`;
}

export function sourceAssetUrl(taskId: string, runId: string, assetId: string, disposition: "inline" | "attachment" = "attachment") {
  return `/api/capture-tasks/${encodeURIComponent(taskId)}/source-runs/${encodeURIComponent(runId)}/assets/${encodeURIComponent(assetId)}?disposition=${disposition}`;
}

export async function fetchCrawlPlanning(taskId: string) {
  const data = await request<{ item: unknown }>(
    `/api/capture-tasks/${encodeURIComponent(taskId)}/crawl-planning`,
  );
  return crawlPlanningViewSchema.parse(data.item);
}

export async function streamCrawlPlanningRun(
  taskId: string,
  expectedTaskRevision: number,
  onEvent: (event: CrawlPlanningEvent) => void,
  signal?: AbortSignal,
) {
  const body = crawlPlanningRunRequestSchema.parse({ expectedTaskRevision });
  const response = await fetch(`/api/capture-tasks/${encodeURIComponent(taskId)}/crawl-planning/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) throw await apiErrorFromResponse(response);
  const parser = createParser({
    onEvent: (event) => onEvent(crawlPlanningEventSchema.parse(JSON.parse(event.data))),
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

export async function confirmCrawlPlan(taskId: string, planId: string, expectedTaskRevision: number) {
  const data = await request<{ item: unknown }>(
    `/api/capture-tasks/${encodeURIComponent(taskId)}/crawl-plans/${encodeURIComponent(planId)}/confirm`,
    { method: "POST", body: JSON.stringify({ expectedTaskRevision }) },
  );
  return crawlPlanningViewSchema.parse(data.item);
}

export async function prepareSourcePlan(taskId: string, planId: string,
  expectedTaskRevision: number, expectedPlanVersion: number) {
  const data = await request<{ item: unknown }>(
    `/api/capture-tasks/${encodeURIComponent(taskId)}/crawl-plans/${encodeURIComponent(planId)}/prepare`,
    { method: "POST", body: JSON.stringify({ expectedTaskRevision, expectedPlanVersion }) },
  );
  return sourcePreparationSchema.parse(data.item);
}

export async function startSourcePlan(taskId: string, planId: string,
  expectedTaskRevision: number, expectedPlanVersion: number) {
  const data = await request<{ item: unknown }>(
    `/api/capture-tasks/${encodeURIComponent(taskId)}/crawl-plans/${encodeURIComponent(planId)}/start`,
    { method: "POST", body: JSON.stringify({ expectedTaskRevision, expectedPlanVersion }) },
  );
  return sourceExecutionAcceptanceSchema.parse(data.item);
}
