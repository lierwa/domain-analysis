import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PaginationControls } from "../components/PaginationControls";
import { fetchReports, type RunReport } from "../lib/api";
import { formatDateTime } from "../lib/format";

const PAGE_SIZE = 20;

export function ReportsPage() {
  const [page, setPage] = useState(1);
  const [selectedReport, setSelectedReport] = useState<RunReport | null>(null);

  const reportsQuery = useQuery({
    queryKey: ["reports", page],
    queryFn: () => fetchReports({ page, pageSize: PAGE_SIZE })
  });

  const reports = reportsQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Reports</h1>
        <p className="mt-1 text-sm text-muted">All analysis reports generated from your runs.</p>
      </div>

      {reportsQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {reportsQuery.isError && <p className="text-sm text-red-600">Failed to load reports.</p>}

      {reports.length === 0 && !reportsQuery.isLoading && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-muted">No reports yet.</p>
          <p className="text-xs text-muted">
            Generate a report from an analysis run in the Workspace.
          </p>
        </div>
      )}

      {selectedReport && (
        <div className="rounded-xl border border-line p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">{selectedReport.title}</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(selectedReport.contentMarkdown);
                }}
                className="rounded border border-line px-3 py-1.5 text-xs hover:bg-surface"
              >
                Copy markdown
              </button>
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([selectedReport.contentMarkdown], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${selectedReport.title.replace(/\s+/g, "-")}.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="rounded border border-line px-3 py-1.5 text-xs hover:bg-surface"
              >
                Export
              </button>
              <button
                type="button"
                onClick={() => setSelectedReport(null)}
                className="rounded border border-line px-3 py-1.5 text-xs text-muted hover:text-ink"
              >
                Close
              </button>
            </div>
          </div>
          <pre className="overflow-auto rounded bg-panel p-4 text-xs leading-relaxed whitespace-pre-wrap">
            {selectedReport.contentMarkdown}
          </pre>
        </div>
      )}

      <div className="flex flex-col divide-y divide-line rounded-xl border border-line overflow-hidden">
        {reports.map((report) => (
          <ReportRow
            key={report.id}
            report={report}
            onOpen={() => setSelectedReport(report)}
          />
        ))}
      </div>

      {reportsQuery.data && reportsQuery.data.page.total > PAGE_SIZE && (
        <PaginationControls
          page={reportsQuery.data.page}
          onPageChange={setPage}
          disabled={reportsQuery.isFetching}
        />
      )}
    </div>
  );
}

function ReportRow({ report, onOpen }: { report: RunReport; onOpen: () => void }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{report.title}</p>
        <p className="text-xs text-muted">{formatDateTime(report.createdAt)}</p>
      </div>
      <StatusPill status={report.status} />
      <button
        type="button"
        onClick={onOpen}
        className="rounded border border-line px-3 py-1.5 text-xs hover:bg-surface"
      >
        Open
      </button>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    ready: "bg-green-100 text-green-700",
    draft: "bg-gray-100 text-gray-600",
    failed: "bg-red-100 text-red-700"
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}
