import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PaginationControls } from "../components/PaginationControls";
import { fetchInsightCandidates, fetchRunContents, type AiInsightCandidate, type RunContent } from "../lib/api";
import { formatDateTime, shortId } from "../lib/format";

interface RunContentPanelProps {
  runId: string;
}

const PAGE_SIZE = 20;

// WHY: RunContentPanel 只查询当前 run 的内容，禁止跨 run 混用，保证分析可追溯。
export function RunContentPanel({ runId }: RunContentPanelProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [author, setAuthor] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [authorInput, setAuthorInput] = useState("");

  const contentsQuery = useQuery({
    queryKey: ["run-contents", runId, page, search, author],
    queryFn: () =>
      fetchRunContents(runId, {
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        author: author || undefined
      })
  });
  const candidatesQuery = useQuery({
    queryKey: ["run-insights", runId, "content-candidates"],
    queryFn: () => fetchInsightCandidates(runId, { page: 1, pageSize: 100 })
  });
  const candidateByRawId = new Map((candidatesQuery.data?.items ?? []).map((candidate) => [candidate.rawContentId, candidate]));

  function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    setSearch(searchInput);
    setAuthor(authorInput);
    setPage(1);
  }

  function handleReset() {
    setSearch("");
    setAuthor("");
    setSearchInput("");
    setAuthorInput("");
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search content…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="input-base flex-1 min-w-36"
        />
        <input
          type="text"
          placeholder="Author"
          value={authorInput}
          onChange={(e) => setAuthorInput(e.target.value)}
          className="input-base w-36"
        />
        <button
          type="submit"
          className="rounded border border-line px-3 py-1.5 text-sm hover:bg-surface"
        >
          Filter
        </button>
        {(search || author) && (
          <button
            type="button"
            onClick={handleReset}
            className="rounded border border-line px-3 py-1.5 text-sm text-muted hover:text-ink"
          >
            Reset
          </button>
        )}
      </form>

      {/* Content list */}
      {contentsQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {contentsQuery.isError && <p className="text-sm text-red-600">Failed to load contents.</p>}

      {contentsQuery.data?.items.length === 0 && (
        <p className="text-sm text-muted">No content found for this run.</p>
      )}

      <div className="flex flex-col gap-3">
        {contentsQuery.data?.items.map((content) => (
          <ContentCard key={content.id} content={content} aiCandidate={candidateByRawId.get(content.id)} />
        ))}
      </div>

      {contentsQuery.data && contentsQuery.data.page.total > PAGE_SIZE && (
        <PaginationControls
          page={contentsQuery.data.page}
          onPageChange={setPage}
          disabled={contentsQuery.isFetching}
        />
      )}

      {contentsQuery.data && (
        <p className="text-xs text-muted">
          {contentsQuery.data.page.total} items in this run
        </p>
      )}
    </div>
  );
}

// Content Card

export function ContentCard({ content, aiCandidate }: { content: RunContent; aiCandidate?: AiInsightCandidate }) {
  const score = (content.metricsJson?.score as number | undefined) ?? null;
  const comments = getCommentCount(content.metricsJson);

  return (
    <article className="rounded-lg border border-line p-4">
      {/* Meta */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {content.authorName && <span className="font-medium text-ink">u/{content.authorName}</span>}
        {content.publishedAt && <span>{formatDateTime(content.publishedAt)}</span>}
        {score !== null && <span>↑ {score}</span>}
        {comments !== null && <span>💬 {comments}</span>}
        {content.crawlTaskId && (
          <span className="font-mono opacity-60">task #{shortId(content.crawlTaskId)}</span>
        )}
        {aiCandidate && <AiStatusBadge candidate={aiCandidate} />}
      </div>

      {/* Text */}
      <p className="text-sm leading-relaxed line-clamp-4">{content.text}</p>

      {/* Footer */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {content.matchedKeywords.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {content.matchedKeywords.map((kw) => (
              <span
                key={kw}
                className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700"
              >
                {kw}
              </span>
            ))}
          </div>
        )}
        <a
          href={content.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-muted underline hover:text-ink"
        >
          View source ↗
        </a>
      </div>

      <p className="mt-2 text-xs text-muted">
        Captured {formatDateTime(content.capturedAt)}
      </p>
    </article>
  );
}

function AiStatusBadge({ candidate }: { candidate: AiInsightCandidate }) {
  if (candidate.selected) {
    return <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700">Selected for AI</span>;
  }
  const label =
    candidate.excludedReason === "duplicate"
      ? "Excluded: duplicate"
      : candidate.excludedReason === "budget_cap"
        ? "Excluded: budget cap"
        : "Excluded: low signal";
  return <span className="rounded bg-surface px-1.5 py-0.5 text-muted">{label}</span>;
}

function getCommentCount(metrics: Record<string, unknown> | null) {
  const comments = metrics?.comments;
  if (typeof comments === "number") return comments;
  const legacyComments = metrics?.num_comments;
  return typeof legacyComments === "number" ? legacyComments : null;
}
