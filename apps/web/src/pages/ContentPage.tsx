import { useQuery } from "@tanstack/react-query";
import { fetchRawContentsByTopic, fetchTopics } from "../lib/api";
import { PageHeader } from "./PageHeader";

export function ContentPage({
  topicId,
  onOpenTopics,
  onTopicIdChange
}: {
  topicId: string;
  onOpenTopics: () => void;
  onTopicIdChange: (id: string) => void;
}) {
  const topicsQuery = useQuery({ queryKey: ["topics"], queryFn: fetchTopics });
  const activeTopicId = topicId || topicsQuery.data?.[0]?.id || "";

  const contentsQuery = useQuery({
    queryKey: ["raw-contents", activeTopicId],
    queryFn: () => fetchRawContentsByTopic(activeTopicId),
    enabled: Boolean(activeTopicId)
  });

  const errorMessage =
    contentsQuery.error instanceof Error ? contentsQuery.error.message : String(contentsQuery.error ?? "");

  return (
    <section>
      <PageHeader
        title="Content Library"
        description="Raw posts for the selected topic (per CONTEXT: topic-scoped first, then cleaning and AI)."
      />
      <div className="mb-4 rounded-md border border-line bg-panel p-4">
        <label className="block max-w-md">
          <span className="mb-1 block text-xs font-medium text-muted">Topic</span>
          <select
            value={activeTopicId}
            onChange={(event) => onTopicIdChange(event.target.value)}
            className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
            disabled={!topicsQuery.data?.length}
          >
            {topicsQuery.data?.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </select>
        </label>
        {!topicsQuery.data?.length && (
          <p className="mt-3 text-sm text-muted">
            No topics yet.{" "}
            <button type="button" className="underline" onClick={onOpenTopics}>
              Create a topic
            </button>
          </p>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-md border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold">Filters</h2>
          <div className="mt-4 space-y-3 text-sm text-muted">
            <div className="rounded border border-line px-3 py-2">Platform (soon)</div>
            <div className="rounded border border-line px-3 py-2">Query (soon)</div>
          </div>
        </aside>
        <div className="rounded-md border border-line bg-surface">
          {errorMessage === "topic_not_found" && (
            <div className="p-4 text-sm text-muted">Topic not found. It may have been deleted — pick another above.</div>
          )}
          {errorMessage && errorMessage !== "topic_not_found" && contentsQuery.isError && (
            <div className="p-4 text-sm text-muted">Failed to load: {errorMessage}</div>
          )}
          <div className="divide-y divide-line">
            {contentsQuery.data?.map((content) => (
              <article key={content.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-muted">
                    {content.platform} · {content.authorHandle ?? content.authorName ?? "unknown author"}
                  </div>
                  <a
                    href={content.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-line px-2 py-1 text-xs"
                  >
                    Open
                  </a>
                </div>
                <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm">{content.text}</p>
                <div className="mt-3 text-xs text-muted">
                  {content.publishedAt ?? content.capturedAt}
                </div>
              </article>
            ))}
          </div>
          {!contentsQuery.isLoading && !contentsQuery.data?.length && !contentsQuery.isError && activeTopicId && (
            <div className="grid min-h-72 place-items-center border border-dashed border-line text-sm text-muted">
              No raw posts for this topic yet. Run a crawl from Queries.
            </div>
          )}
        </div>
      </div>
      {contentsQuery.isLoading && <div className="mt-3 text-sm text-muted">Loading content</div>}
    </section>
  );
}
