import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PaginationControls } from "../components/PaginationControls";
import { fetchAnalysisRuns, fetchRunContents } from "../lib/api";
import { formatDateTime } from "../lib/format";

// WHY: Library 必须强制用户先选 run，禁止展示全局混杂内容，保证上下文可追溯。
export function LibraryPage() {
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [page, setPage] = useState(1);

  const runsQuery = useQuery({
    queryKey: ["analysis-runs-all"],
    queryFn: () => fetchAnalysisRuns({ page: 1, pageSize: 100 })
  });

  const contentsQuery = useQuery({
    queryKey: ["library-contents", selectedRunId, page],
    queryFn: () => fetchRunContents(selectedRunId, { page, pageSize: 20 }),
    enabled: !!selectedRunId
  });

  const runs = runsQuery.data?.items ?? [];
  const selectedRun = runs.find((r) => r.id === selectedRunId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Content Library</h1>
        <p className="mt-1 text-sm text-muted">
          Browse collected content from a specific analysis run.
        </p>
      </div>

      {/* Run selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium" htmlFor="run-select">
          Select run
        </label>
        <select
          id="run-select"
          value={selectedRunId}
          onChange={(e) => {
            setSelectedRunId(e.target.value);
            setPage(1);
          }}
          className="input-base min-w-64"
        >
          <option value="">— Choose an analysis run —</option>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.name} ({run.validCount} items)
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      {!selectedRunId && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-muted">
            Select an analysis run above to browse its content.
          </p>
        </div>
      )}

      {selectedRunId && selectedRun && (
        <div>
          <p className="mb-4 text-sm text-muted">
            Showing content from <strong>{selectedRun.name}</strong> ·{" "}
            {selectedRun.validCount} valid items
          </p>

          {contentsQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {contentsQuery.isError && (
            <p className="text-sm text-red-600">Failed to load content.</p>
          )}

          <div className="flex flex-col gap-3">
            {contentsQuery.data?.items.map((content) => (
              <article key={content.id} className="rounded-lg border border-line p-4">
                <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted">
                  <span className="font-medium text-ink capitalize">{content.platform}</span>
                  {content.authorName && <span>u/{content.authorName}</span>}
                  {content.publishedAt && <span>{formatDateTime(content.publishedAt)}</span>}
                  <span className="ml-auto text-xs text-muted">
                    {selectedRun.name}
                  </span>
                </div>
                <p className="text-sm leading-relaxed line-clamp-4">{content.text}</p>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex flex-wrap gap-1">
                    {content.matchedKeywords.map((kw) => (
                      <span key={kw} className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                        {kw}
                      </span>
                    ))}
                  </div>
                  <a
                    href={content.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted underline hover:text-ink"
                  >
                    Source ↗
                  </a>
                </div>
              </article>
            ))}
          </div>

          {contentsQuery.data && contentsQuery.data.page.total > 20 && (
            <div className="mt-4">
              <PaginationControls
                page={contentsQuery.data.page}
                onPageChange={setPage}
                disabled={contentsQuery.isFetching}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
