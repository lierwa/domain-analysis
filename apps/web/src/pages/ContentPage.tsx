import { useQuery } from "@tanstack/react-query";
import { fetchRawContents } from "../lib/api";
import { PageHeader } from "./PageHeader";

export function ContentPage() {
  const contentsQuery = useQuery({ queryKey: ["raw-contents"], queryFn: fetchRawContents });

  return (
    <section>
      <PageHeader
        title="Content Library"
        description="Review raw posts, cleaned text, AI labels, sentiment, value score, and source metadata."
      />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-md border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold">Filters</h2>
          <div className="mt-4 space-y-3 text-sm text-muted">
            <div className="rounded border border-line px-3 py-2">Topic</div>
            <div className="rounded border border-line px-3 py-2">Platform</div>
            <div className="rounded border border-line px-3 py-2">Sentiment</div>
            <div className="rounded border border-line px-3 py-2">Score Range</div>
          </div>
        </aside>
        <div className="rounded-md border border-line bg-surface">
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
          {!contentsQuery.isLoading && !contentsQuery.data?.length && (
            <div className="grid min-h-72 place-items-center border border-dashed border-line text-sm text-muted">
              Content collection will appear here
            </div>
          )}
        </div>
      </div>
      {contentsQuery.isLoading && <div className="mt-3 text-sm text-muted">Loading content</div>}
      {contentsQuery.isError && <div className="mt-3 text-sm text-muted">Failed to load content</div>}
    </section>
  );
}
