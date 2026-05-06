import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import {
  createQuery,
  deleteQuery,
  fetchCrawlTasks,
  fetchQueries,
  fetchTopics,
  runCrawl,
  updateQuery,
  type Platform,
  type Query
} from "../lib/api";
import { formatDateTime, humanizeStatus } from "../lib/format";
import { PageHeader } from "./PageHeader";

const platformOptions: Platform[] = ["reddit", "x", "youtube", "pinterest", "web"];

export function QueriesPage() {
  const queryClient = useQueryClient();
  const topicsQuery = useQuery({ queryKey: ["topics"], queryFn: fetchTopics });
  const [topicId, setTopicId] = useState("");
  const [crawlNotice, setCrawlNotice] = useState<string | null>(null);
  const activeTopicId = topicId || topicsQuery.data?.[0]?.id || "";
  const queriesQuery = useQuery({
    queryKey: ["queries", activeTopicId],
    queryFn: () => fetchQueries(activeTopicId),
    enabled: Boolean(activeTopicId)
  });
  const tasksQuery = useQuery({ queryKey: ["crawl-tasks"], queryFn: fetchCrawlTasks });
  const createMutation = useMutation({
    mutationFn: (input: Parameters<typeof createQuery>[1]) => createQuery(activeTopicId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["queries", activeTopicId] })
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Query["status"] }) => updateQuery(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["queries", activeTopicId] })
  });
  const deleteMutation = useMutation({
    mutationFn: deleteQuery,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["queries", activeTopicId] })
  });
  const crawlMutation = useMutation({
    mutationFn: ({ queryId, platform }: { queryId: string; platform: "reddit" | "x" }) =>
      runCrawl(queryId, platform),
    onSuccess: (task) => {
      setCrawlNotice(`Crawl task ${task.status}: ${task.id}. Open Tasks to track progress.`);
      queryClient.invalidateQueries({ queryKey: ["crawl-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["raw-contents"] });
    },
    onError: (error) => {
      setCrawlNotice(error instanceof Error ? error.message : "Failed to start crawl task");
    }
  });
  const selectedTopicName = useMemo(
    () => topicsQuery.data?.find((topic) => topic.id === activeTopicId)?.name ?? "Select a topic",
    [activeTopicId, topicsQuery.data]
  );
  const [form, setForm] = useState({
    name: "",
    includeKeywords: "",
    excludeKeywords: "",
    platforms: ["reddit"] as Platform[],
    language: "en",
    limitPerRun: 50
  });

  function submitQuery(event: FormEvent) {
    event.preventDefault();
    if (!activeTopicId) return;

    createMutation.mutate({
      name: form.name,
      includeKeywords: parseCsv(form.includeKeywords),
      excludeKeywords: parseCsv(form.excludeKeywords),
      platforms: form.platforms,
      language: form.language,
      frequency: "manual",
      limitPerRun: form.limitPerRun
    });
    setForm((current) => ({ ...current, name: "", includeKeywords: "", excludeKeywords: "" }));
  }

  return (
    <section>
      <PageHeader
        title="Queries"
        description="Configure include keywords, exclude keywords, platforms, language, and per-run limits under each topic."
      />
      <div className="mb-4 rounded-md border border-line bg-panel p-4">
        <label className="block max-w-md">
          <span className="mb-1 block text-xs font-medium text-muted">Topic</span>
          <select
            value={activeTopicId}
            onChange={(event) => setTopicId(event.target.value)}
            className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
          >
            {topicsQuery.data?.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {crawlNotice && (
        <div className="mb-4 rounded-md border border-line bg-surface px-4 py-3 text-sm text-muted">
          {crawlNotice}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <form onSubmit={submitQuery} className="rounded-md border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold">Create Query</h2>
          <div className="mt-4 space-y-3">
            <Input label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
            <Input
              label="Include Keywords"
              value={form.includeKeywords}
              onChange={(value) => setForm({ ...form, includeKeywords: value })}
              placeholder="ai search, answer engine"
            />
            <Input
              label="Exclude Keywords"
              value={form.excludeKeywords}
              onChange={(value) => setForm({ ...form, excludeKeywords: value })}
              placeholder="jobs, hiring"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Language"
                value={form.language}
                onChange={(value) => setForm({ ...form, language: value })}
              />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Limit</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={form.limitPerRun}
                  onChange={(event) => setForm({ ...form, limitPerRun: Number(event.target.value) })}
                  className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div>
              <span className="mb-2 block text-xs font-medium text-muted">Platforms</span>
              <div className="grid grid-cols-2 gap-2">
                {platformOptions.map((platform) => (
                  <label key={platform} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.platforms.includes(platform)}
                      onChange={() => setForm({ ...form, platforms: togglePlatform(form.platforms, platform) })}
                    />
                    {platform}
                  </label>
                ))}
              </div>
            </div>
            <button
              disabled={!activeTopicId}
              className="w-full rounded bg-ink px-3 py-2 text-sm font-medium text-surface disabled:opacity-40"
              type="submit"
            >
              Create for {selectedTopicName}
            </button>
          </div>
        </form>
        <div className="rounded-md border border-line bg-surface">
          {!activeTopicId && <div className="p-6 text-sm text-muted">Create a topic first</div>}
          {activeTopicId && !queriesQuery.data?.length && <div className="p-6 text-sm text-muted">No queries yet</div>}
          <div className="divide-y divide-line">
            {queriesQuery.data?.map((query) => (
              <QueryRow
                key={query.id}
                query={query}
                tasks={tasksQuery.data ?? []}
                crawlPending={crawlMutation.isPending}
                onToggleStatus={(status) => updateMutation.mutate({ id: query.id, status })}
                onDelete={() => deleteMutation.mutate(query.id)}
                onCrawl={(platform) => crawlMutation.mutate({ queryId: query.id, platform })}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function QueryRow({
  query,
  tasks,
  crawlPending,
  onToggleStatus,
  onDelete,
  onCrawl
}: {
  query: Query;
  tasks: Array<{ queryId: string; status: string; createdAt: string; finishedAt?: string }>;
  crawlPending: boolean;
  onToggleStatus: (status: Query["status"]) => void;
  onDelete: () => void;
  onCrawl: (platform: "reddit" | "x") => void;
}) {
  const hasRunningTask = tasks.some(
    (task) => task.queryId === query.id && ["pending", "running"].includes(task.status)
  );

  return (
    <article className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{query.name}</h2>
          <p className="mt-2 text-sm text-muted">{query.includeKeywords.join(", ")}</p>
        </div>
        <span className="rounded border border-line px-2 py-1 text-xs text-muted">
          {humanizeStatus(query.status)}
        </span>
      </div>
      {query.excludeKeywords.length > 0 && (
        <p className="mt-2 text-xs text-muted">Excluding: {query.excludeKeywords.join(", ")}</p>
      )}
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <Fact label="Sources" value={query.platforms.join(", ")} />
        <Fact label="Limit" value={`${query.limitPerRun} per run`} />
        <Fact label="Last Run" value={lastRunText(tasks, query.id)} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onToggleStatus(query.status === "active" ? "paused" : "active")}
          className="rounded border border-line px-3 py-1.5 text-xs"
        >
          {query.status === "active" ? "Pause" : "Activate"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded border border-line px-3 py-1.5 text-xs text-muted"
        >
          Delete
        </button>
        {(["reddit", "x"] as const).map((platform) => (
          <button
            key={platform}
            type="button"
            disabled={
              query.status !== "active" ||
              !query.platforms.includes(platform) ||
              crawlPending ||
              hasRunningTask
            }
            onClick={() => onCrawl(platform)}
            className="rounded border border-line px-3 py-1.5 text-xs disabled:opacity-40"
          >
            {hasRunningTask ? "Crawl running" : crawlPending ? "Starting..." : `Start ${platform} crawl`}
          </button>
        ))}
      </div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

function lastRunText(tasks: Array<{ queryId: string; status: string; createdAt: string; finishedAt?: string }>, queryId: string) {
  const task = tasks.find((item) => item.queryId === queryId);
  if (!task) return "Never";
  return `${humanizeStatus(task.status)} · ${formatDateTime(task.finishedAt ?? task.createdAt)}`;
}

function Input({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input
        required={label !== "Exclude Keywords"}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
      />
    </label>
  );
}

function parseCsv(value: string) {
  // WHY: MVP 查询构建器先采用逗号输入，降低 UI 和解析复杂度；高级 AND/OR/NOT 留到第二阶段。
  // TRADE-OFF: 不能表达复杂布尔查询，但足够支撑第一阶段关键词组闭环。
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function togglePlatform(platforms: Platform[], platform: Platform) {
  if (platforms.includes(platform)) {
    const next = platforms.filter((item) => item !== platform);
    return next.length ? next : platforms;
  }
  return [...platforms, platform];
}
