import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearFinishedCrawlTasks,
  deleteCrawlTask,
  fetchCrawlTasks,
  fetchQueries,
  fetchSources,
  fetchTopics,
  type CrawlTask,
  type Query
} from "../lib/api";
import { formatDateTime, humanizeStatus, shortId } from "../lib/format";
import { PageHeader } from "./PageHeader";

const statusTone: Record<CrawlTask["status"], string> = {
  pending: "border-line text-muted",
  running: "border-ink text-ink",
  success: "border-line text-ink",
  failed: "border-line text-muted",
  no_content: "border-line text-muted",
  paused: "border-line text-muted",
  login_required: "border-line text-muted",
  rate_limited: "border-line text-muted",
  parse_failed: "border-line text-muted"
};

export function TasksPage({ onViewRawContent }: { onViewRawContent: (topicId: string) => void }) {
  const queryClient = useQueryClient();
  const tasksQuery = useQuery({
    queryKey: ["crawl-tasks"],
    queryFn: fetchCrawlTasks,
    refetchInterval: (query) => {
      const hasRunningTask = query.state.data?.some((task) => ["pending", "running"].includes(task.status));
      return hasRunningTask ? 2500 : false;
    }
  });
  const topicsQuery = useQuery({ queryKey: ["topics"], queryFn: fetchTopics });
  const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: fetchSources });
  const queryLookups = useQueries({
    queries:
      topicsQuery.data?.map((topic) => ({
        queryKey: ["queries", topic.id],
        queryFn: () => fetchQueries(topic.id)
      })) ?? []
  });
  const queryById = new Map(
    queryLookups.flatMap((lookup) => lookup.data ?? []).map((query) => [query.id, query])
  );
  const sourceById = new Map((sourcesQuery.data ?? []).map((source) => [source.id, source]));
  const summary = summarizeTasks(tasksQuery.data ?? []);
  const deleteMutation = useMutation({
    mutationFn: deleteCrawlTask,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crawl-tasks"] })
  });
  const clearMutation = useMutation({
    mutationFn: clearFinishedCrawlTasks,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crawl-tasks"] })
  });

  return (
    <section>
      <PageHeader
        title="Tasks"
        description="Track collection runs by platform, query, result count, and actionable failure reason."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Running" value={summary.running} />
        <Metric label="Successful" value={summary.success} />
        <Metric label="Rate Limited" value={summary.rateLimited} />
        <Metric label="Collected" value={summary.collected} />
      </div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          disabled={clearMutation.isPending || !hasClearableFinishedTasks(tasksQuery.data ?? [])}
          onClick={() => clearMutation.mutate()}
          className="rounded border border-line px-3 py-2 text-sm disabled:opacity-40"
        >
          Clear finished runs
        </button>
      </div>
      <div className="rounded-md border border-line bg-surface">
        {tasksQuery.isLoading && <div className="p-6 text-sm text-muted">Loading tasks</div>}
        {tasksQuery.isError && <div className="p-6 text-sm text-muted">Failed to load tasks</div>}
        {!tasksQuery.isLoading && !tasksQuery.data?.length && (
          <div className="p-6 text-sm text-muted">No collection runs yet</div>
        )}
        <div className="divide-y divide-line">
          {tasksQuery.data?.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              query={queryById.get(task.queryId)}
              sourceName={sourceById.get(task.sourceId)?.name}
              deleting={deleteMutation.isPending}
              onDelete={() => deleteMutation.mutate(task.id)}
              onViewRawContent={onViewRawContent}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function TaskRow({
  task,
  query,
  sourceName,
  deleting,
  onDelete,
  onViewRawContent
}: {
  task: CrawlTask;
  query?: Query;
  sourceName?: string;
  deleting: boolean;
  onDelete: () => void;
  onViewRawContent: (topicId: string) => void;
}) {
  const resultText =
    task.status === "success"
      ? `${task.validCount} saved, ${task.duplicateCount} duplicate`
      : `${task.collectedCount}/${task.targetCount} collected`;

  return (
    <article className="grid gap-4 p-4 lg:grid-cols-[1.4fr_0.9fr_1fr]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{query?.name ?? "Unknown query"}</h2>
          <span className={`rounded border px-2 py-1 text-xs ${statusTone[task.status]}`}>
            {humanizeStatus(task.status)}
          </span>
        </div>
        <div className="mt-2 text-sm text-muted">
          {sourceName ?? "Unknown source"} · run #{shortId(task.id)}
        </div>
        {query && (
          <div className="mt-2 line-clamp-2 text-xs text-muted">
            Keywords: {query.includeKeywords.join(", ")}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Fact label="Result" value={resultText} />
        <Fact label="Started" value={formatDateTime(task.startedAt ?? task.createdAt)} />
        <Fact label="Finished" value={formatDateTime(task.finishedAt)} />
        <Fact label="Limit" value={String(task.targetCount)} />
      </div>
      <div>
        <div className="text-xs font-medium uppercase text-muted">What this means</div>
        <p className="mt-2 text-sm leading-6 text-muted">{taskMessage(task)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={deleting}
            onClick={onDelete}
            className="rounded border border-line px-3 py-1.5 text-xs disabled:opacity-40"
          >
            Delete run
          </button>
          {task.status === "success" && task.validCount > 0 ? (
            <button
              type="button"
              onClick={() => onViewRawContent(task.topicId)}
              className="rounded border border-ink bg-ink px-3 py-1.5 text-xs text-surface"
            >
              View raw posts for this topic
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** 与「单条删除」分离：仅统计可批量清理的终态任务（与 API clear-finished 一致）。 */
function hasClearableFinishedTasks(tasks: CrawlTask[]) {
  const finished: CrawlTask["status"][] = [
    "success",
    "failed",
    "no_content",
    "paused",
    "login_required",
    "rate_limited",
    "parse_failed"
  ];
  return tasks.some((task) => finished.includes(task.status));
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-md border border-line bg-panel p-4">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}

function summarizeTasks(tasks: CrawlTask[]) {
  return {
    running: tasks.filter((task) => ["pending", "running"].includes(task.status)).length,
    success: tasks.filter((task) => task.status === "success").length,
    rateLimited: tasks.filter((task) => task.status === "rate_limited").length,
    collected: tasks.reduce((total, task) => total + task.validCount, 0)
  };
}

function taskMessage(task: CrawlTask) {
  if (task.status === "success") {
    if (task.validCount === 0) return "The run completed, but no new content matched or everything was duplicate.";
    return "The run completed. Open Content to review saved posts.";
  }
  if (task.status === "no_content") return task.errorMessage ?? "The source returned no matching public posts.";
  if (task.status === "running") {
    return "The crawler is running in the background. This page refreshes automatically. If a run stays here too long, you can delete it to clear the list; a stuck worker may still write content without this row.";
  }
  if (task.status === "rate_limited") return "The source refused this run. Wait before retrying or lower the query limit.";
  if (task.status === "login_required") return "The source requires login. This app does not automate account login yet.";
  if (task.status === "parse_failed") return "The page format changed or returned unexpected content.";
  if (task.errorMessage) return task.errorMessage;
  return "No action is needed yet.";
}
