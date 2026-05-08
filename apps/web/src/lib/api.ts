// WHY: API client 只暴露 analysis run/project/content/report 接口，避免 UI 依赖工程内部概念。

export type Platform = "reddit" | "x" | "youtube" | "tiktok" | "pinterest" | "web";

export type AnalysisRunStatus =
  | "draft"
  | "collecting"
  | "collection_failed"
  | "content_ready"
  | "analyzing"
  | "analysis_failed"
  | "insight_ready"
  | "reporting"
  | "report_ready";

export type ProjectStatus = "active" | "paused" | "archived";
export type AnalysisReportType = "run_summary" | "content_opportunities" | "keyword_analysis";
export type CollectionCadence = "manual" | "hourly" | "daily" | "weekly";
export type BrowserMode = "headless" | "headful" | "local_profile";

export interface AnalysisProject {
  id: string;
  name: string;
  goal: string;
  language: string;
  market: string;
  defaultPlatform: "reddit";
  defaultLimit: number;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  id: string;
  platform: Platform;
  name: string;
  enabled: boolean;
  requiresLogin: boolean;
  crawlerType: "cheerio" | "playwright";
  defaultLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisRun {
  id: string;
  projectId: string;
  name: string;
  status: AnalysisRunStatus;
  includeKeywords: string[];
  excludeKeywords: string[];
  platform: "reddit";
  platforms: Platform[];
  browserMode: BrowserMode;
  maxScrollsPerPlatform: number;
  maxItemsPerPlatform: number;
  limit: number;
  collectedCount: number;
  validCount: number;
  duplicateCount: number;
  analyzedCount: number;
  reportId?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionPlan {
  id: string;
  projectId: string;
  name: string;
  status: ProjectStatus;
  platform: "reddit";
  platforms: Platform[];
  browserMode: BrowserMode;
  maxScrollsPerPlatform: number;
  maxItemsPerPlatform: number;
  includeKeywords: string[];
  excludeKeywords: string[];
  language: string;
  market: string;
  cadence: CollectionCadence;
  batchLimit: number;
  maxRunsPerDay: number;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunContent {
  id: string;
  analysisRunId: string;
  crawlTaskId?: string;
  platform: Platform;
  authorName?: string;
  authorHandle?: string;
  url: string;
  text: string;
  matchedKeywords: string[];
  metricsJson: Record<string, unknown> | null;
  publishedAt?: string;
  capturedAt: string;
}

export interface RunCrawlTask {
  id: string;
  analysisRunId?: string;
  sourceId: string;
  platform: Platform;
  status: string;
  targetCount: number;
  collectedCount: number;
  validCount: number;
  duplicateCount: number;
  errorMessage?: string;
  pagesCollected: number;
  lastCursor?: string;
  stopReason?:
    | "target_reached"
    | "exhausted"
    | "rate_limited"
    | "login_required"
    | "blocked"
    | "parse_failed"
    | "error"
    | "cancelled";
  lastRequestAt?: string;
  nextRequestAt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunReport {
  id: string;
  projectId?: string;
  analysisRunId?: string;
  title: string;
  type: AnalysisReportType;
  status: "draft" | "ready" | "failed";
  contentMarkdown: string;
  contentJson?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PageParams {
  page: number;
  pageSize: number;
}

export interface PageMeta extends PageParams {
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResponse<TItem> {
  items: TItem[];
  page: PageMeta;
}

export interface CreateAnalysisRunInput {
  projectId?: string;
  projectName?: string;
  goal: string;
  includeKeywords: string[];
  excludeKeywords?: string[];
  language: string;
  market: string;
  limit?: number;
  platforms?: Platform[];
  browserMode?: BrowserMode;
  maxScrollsPerPlatform?: number;
  maxItemsPerPlatform?: number;
}

export interface CreateCollectionPlanInput {
  projectId: string;
  name: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  language: string;
  market: string;
  cadence: CollectionCadence;
  batchLimit: number;
  maxRunsPerDay: number;
  platforms: Platform[];
  browserMode: BrowserMode;
  maxScrollsPerPlatform: number;
  maxItemsPerPlatform: number;
}

// ─── Analysis Projects ────────────────────────────────────────────────────────

export async function fetchSources(): Promise<Source[]> {
  const data = await request<{ items: Source[] }>("/api/sources");
  return data.items;
}

export async function fetchAnalysisProjects(
  params: PageParams = { page: 1, pageSize: 20 }
): Promise<PaginatedResponse<AnalysisProject>> {
  return request<PaginatedResponse<AnalysisProject>>(`/api/analysis-projects${toQueryString(params)}`);
}

export async function fetchAnalysisProject(id: string): Promise<AnalysisProject> {
  const data = await request<{ item: AnalysisProject }>(`/api/analysis-projects/${id}`);
  return data.item;
}

export async function createAnalysisProject(input: {
  name: string;
  goal: string;
  language: string;
  market: string;
  defaultLimit?: number;
}): Promise<AnalysisProject> {
  const data = await request<{ item: AnalysisProject }>("/api/analysis-projects", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return data.item;
}

export async function archiveAnalysisProject(id: string): Promise<AnalysisProject> {
  const data = await request<{ item: AnalysisProject }>(`/api/analysis-projects/${id}/archive`, {
    method: "POST"
  });
  return data.item;
}

// ─── Collection Plans ─────────────────────────────────────────────────────────

export async function fetchProjectCollectionPlans(projectId: string) {
  return request<CollectionPlan[]>(`/api/projects/${projectId}/collection-plans`);
}

export async function createCollectionPlan(input: CreateCollectionPlanInput) {
  return request<CollectionPlan>("/api/collection-plans", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// ─── Analysis Runs ────────────────────────────────────────────────────────────

export async function fetchAnalysisRuns(
  params: PageParams & { projectId?: string; status?: string } = { page: 1, pageSize: 20 }
): Promise<PaginatedResponse<AnalysisRun>> {
  const { projectId, status, ...pageParams } = params;
  const qs = new URLSearchParams({
    page: String(pageParams.page),
    pageSize: String(pageParams.pageSize)
  });
  if (projectId) qs.set("projectId", projectId);
  if (status) qs.set("status", status);
  return request<PaginatedResponse<AnalysisRun>>(`/api/analysis-runs?${qs.toString()}`);
}

export async function fetchAnalysisRun(id: string): Promise<AnalysisRun> {
  const data = await request<{ item: AnalysisRun }>(`/api/analysis-runs/${id}`);
  return data.item;
}

export async function createAnalysisRun(input: CreateAnalysisRunInput): Promise<AnalysisRun> {
  const data = await request<{ item: AnalysisRun }>("/api/analysis-runs", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return data.item;
}

export async function startAnalysisRun(id: string): Promise<AnalysisRun> {
  const data = await request<{ item: AnalysisRun }>(`/api/analysis-runs/${id}/start`, {
    method: "POST"
  });
  return data.item;
}

export async function retryAnalysisRun(id: string): Promise<AnalysisRun> {
  const data = await request<{ item: AnalysisRun }>(`/api/analysis-runs/${id}/retry`, {
    method: "POST"
  });
  return data.item;
}

export async function deleteAnalysisRun(id: string): Promise<void> {
  await request<void>(`/api/analysis-runs/${id}/delete`, { method: "POST" });
}

// ─── Run Contents ─────────────────────────────────────────────────────────────

export async function fetchRunContents(
  runId: string,
  params: PageParams & { search?: string; author?: string; publishedFrom?: string; publishedTo?: string } = {
    page: 1,
    pageSize: 20
  }
): Promise<PaginatedResponse<RunContent>> {
  const { search, author, publishedFrom, publishedTo, ...pageParams } = params;
  const qs = new URLSearchParams({
    page: String(pageParams.page),
    pageSize: String(pageParams.pageSize)
  });
  if (search) qs.set("search", search);
  if (author) qs.set("author", author);
  if (publishedFrom) qs.set("publishedFrom", publishedFrom);
  if (publishedTo) qs.set("publishedTo", publishedTo);
  return request<PaginatedResponse<RunContent>>(`/api/analysis-runs/${runId}/contents?${qs.toString()}`);
}

export async function fetchRunCrawlTasks(runId: string): Promise<RunCrawlTask[]> {
  const data = await request<{ items: RunCrawlTask[] }>(`/api/analysis-runs/${runId}/crawl-tasks`);
  return data.items;
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export async function generateRunReport(runId: string): Promise<RunReport> {
  const data = await request<{ item: RunReport }>(`/api/analysis-runs/${runId}/report`, {
    method: "POST"
  });
  return data.item;
}

export async function fetchReports(
  params: PageParams & { projectId?: string } = { page: 1, pageSize: 20 }
): Promise<PaginatedResponse<RunReport>> {
  const { projectId, ...pageParams } = params;
  const qs = new URLSearchParams({
    page: String(pageParams.page),
    pageSize: String(pageParams.pageSize)
  });
  if (projectId) qs.set("projectId", projectId);
  return request<PaginatedResponse<RunReport>>(`/api/reports?${qs.toString()}`);
}

export async function fetchReport(id: string): Promise<RunReport> {
  const data = await request<{ item: RunReport }>(`/api/reports/${id}`);
  return data.item;
}

// ─── 内部工具 ──────────────────────────────────────────────────────────────────

export function buildQueryString(params: Record<string, string | number | boolean | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `?${query}` : "";
}

function toQueryString(params: PageParams) {
  return buildQueryString({ page: params.page, pageSize: params.pageSize });
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers =
    init.body === undefined
      ? { ...init.headers }
      : { "Content-Type": "application/json", ...init.headers };

  const response = await fetch(url, {
    cache: method === "GET" ? "no-store" : undefined,
    headers,
    ...init
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
