import {
  captureTaskSchema,
  categoryInterviewViewSchema,
  interviewTimelineEventSchema,
  interviewTurnRequestSchema,
  sourceCollectionRunSchema,
  sourceDatasetRunViewSchema,
  type CaptureTask,
  type CategoryInterviewView,
  type InterviewSession,
  type InterviewTimelineEvent,
  type InterviewTurnRequest,
  type SourceCollectionRun,
  type SourceDatasetRunView,
} from "@domain-analysis/shared";
import { createParser } from "eventsource-parser";

import { apiErrorFromResponse, request } from "./apiClient";

export { ApiError } from "./apiClient";

export async function startCategoryInterview(initialRequest: string): Promise<CategoryInterviewView> {
  const data = await request<{ item: unknown }>("/api/category-interviews", {
    method: "POST",
    body: JSON.stringify({ initialRequest }),
  });
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

export async function confirmInterviewDecision(
  sessionId: string,
  decisionId: string,
  selection: string,
  expectedRevision: number,
) {
  const data = await request<{ item: unknown }>(
    `/api/category-interviews/${sessionId}/decisions/${decisionId}/confirm`,
    { method: "POST", body: JSON.stringify({ expectedRevision, selection }) },
  );
  return categoryInterviewViewSchema.parse(data.item);
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

export async function fetchSourceCollectionRuns(taskId: string): Promise<SourceCollectionRun[]> {
  const data = await request<{ items: unknown[] }>(
    `/api/capture-tasks/${encodeURIComponent(taskId)}/source-runs`,
  );
  return sourceCollectionRunSchema.array().parse(data.items);
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
