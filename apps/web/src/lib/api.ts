export interface ApiModule {
  key: string;
  label: string;
  description: string;
}

export interface Topic {
  id: string;
  name: string;
  description?: string;
  language: string;
  market: string;
  status: "active" | "paused" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface Query {
  id: string;
  topicId: string;
  name: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  platforms: Platform[];
  language: string;
  frequency: "manual" | "hourly" | "daily" | "weekly";
  limitPerRun: number;
  status: "active" | "paused" | "archived";
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
}

export interface CrawlTask {
  id: string;
  topicId: string;
  queryId: string;
  sourceId: string;
  status:
    | "pending"
    | "running"
    | "success"
    | "failed"
    | "no_content"
    | "paused"
    | "login_required"
    | "rate_limited"
    | "parse_failed";
  targetCount: number;
  collectedCount: number;
  validCount: number;
  duplicateCount: number;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RawContent {
  id: string;
  platform: Platform;
  sourceId: string;
  queryId: string;
  topicId: string;
  externalId?: string;
  url: string;
  authorName?: string;
  authorHandle?: string;
  text: string;
  metricsJson: Record<string, unknown> | null;
  publishedAt?: string;
  capturedAt: string;
}

export type Platform = "reddit" | "x" | "youtube" | "pinterest" | "web";

export interface CreateTopicInput {
  name: string;
  description?: string;
  language: string;
  market: string;
}

export type UpdateTopicInput = Partial<CreateTopicInput> & {
  status?: Topic["status"];
};

export interface CreateQueryInput {
  name: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  platforms: Platform[];
  language: string;
  frequency: "manual" | "hourly" | "daily" | "weekly";
  limitPerRun: number;
}

export interface CreateSourceInput {
  platform: Platform;
  name: string;
  enabled: boolean;
  requiresLogin: boolean;
  crawlerType: "cheerio" | "playwright";
  defaultLimit: number;
}

export type UpdateQueryInput = Partial<CreateQueryInput> & {
  status?: Query["status"];
};

export async function fetchModules(): Promise<ApiModule[]> {
  const data = await request<{ modules: ApiModule[] }>("/api/modules");
  return data.modules;
}

export async function fetchTopics(): Promise<Topic[]> {
  const data = await request<{ items: Topic[] }>("/api/topics");
  return data.items;
}

export async function createTopic(input: CreateTopicInput): Promise<Topic> {
  const data = await request<{ item: Topic }>("/api/topics", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return data.item;
}

export async function updateTopic(id: string, input: UpdateTopicInput): Promise<Topic> {
  const data = await request<{ item: Topic }>(`/api/topics/${id}/update`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return data.item;
}

export async function deleteTopic(id: string): Promise<void> {
  await request<void>(`/api/topics/${id}/delete`, { method: "POST" });
}

export async function fetchQueries(topicId: string): Promise<Query[]> {
  if (!topicId) return [];
  const data = await request<{ items: Query[] }>(`/api/topics/${topicId}/queries`);
  return data.items;
}

export async function createQuery(topicId: string, input: CreateQueryInput): Promise<Query> {
  const data = await request<{ item: Query }>(`/api/topics/${topicId}/queries`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return data.item;
}

export async function updateQuery(id: string, input: UpdateQueryInput): Promise<Query> {
  const data = await request<{ item: Query }>(`/api/queries/${id}/update`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return data.item;
}

export async function deleteQuery(id: string): Promise<void> {
  await request<void>(`/api/queries/${id}/delete`, { method: "POST" });
}

export async function fetchSources(): Promise<Source[]> {
  const data = await request<{ items: Source[] }>("/api/sources");
  return data.items;
}

export async function createSource(input: CreateSourceInput): Promise<Source> {
  const data = await request<{ item: Source }>("/api/sources", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return data.item;
}

export type SourceUpdateInput = { enabled?: boolean; crawlerType?: Source["crawlerType"] };

export async function updateSource(platform: Platform, input: SourceUpdateInput): Promise<Source> {
  const data = await request<{ item: Source }>(`/api/sources/${platform}/update`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return data.item;
}

export async function fetchCrawlTasks(): Promise<CrawlTask[]> {
  const data = await request<{ items: CrawlTask[] }>("/api/crawl-tasks");
  return data.items;
}

export async function deleteCrawlTask(id: string): Promise<void> {
  await request<void>(`/api/crawl-tasks/${id}/delete`, { method: "POST" });
}

export async function clearFinishedCrawlTasks(): Promise<number> {
  const data = await request<{ deletedCount: number }>("/api/crawl-tasks/clear-finished", {
    method: "POST"
  });
  return data.deletedCount;
}

export async function runCrawl(queryId: string, platform: "reddit" | "x"): Promise<CrawlTask> {
  const data = await request<{ item: CrawlTask }>(`/api/queries/${queryId}/crawl`, {
    method: "POST",
    body: JSON.stringify({ platform })
  });
  return data.item;
}

export async function fetchRawContents(): Promise<RawContent[]> {
  const data = await request<{ items: RawContent[] }>("/api/raw-contents");
  return data.items;
}

export async function fetchRawContentsByTopic(topicId: string): Promise<RawContent[]> {
  const data = await request<{ items: RawContent[] }>(`/api/topics/${topicId}/raw-contents`);
  return data.items;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers =
    init.body === undefined
      ? { ...init.headers }
      : {
          "Content-Type": "application/json",
          ...init.headers
        };
  const response = await fetch(url, {
    cache: method === "GET" ? "no-store" : undefined,
    headers,
    ...init
  });

  if (!response.ok) {
    const message = await parseApiErrorMessage(response);
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function parseApiErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.clone().json()) as { error?: string; message?: string };
    if (data?.error === "topic_not_found") return "topic_not_found";
    if (typeof data?.error === "string") return data.error;
    if (typeof data?.message === "string") return data.message;
  } catch {
    /* ignore non-JSON error bodies */
  }
  return `API request failed: ${response.status}`;
}
