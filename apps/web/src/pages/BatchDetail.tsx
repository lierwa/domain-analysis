import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { RunStatusBadge } from "../components/RunStatusBadge";
import {
  deleteAnalysisBatch,
  fetchAnalysisBatch,
  fetchReport,
  fetchRunCrawlTasks,
  generateBatchReport,
  type AnalysisBatch,
  type AnalysisRun
} from "../lib/api";
import { formatDateTime, shortId } from "../lib/format";
import { RunContentPanel } from "./RunContentPanel";

interface BatchDetailProps {
  batch: AnalysisBatch;
  onDeleted: () => void;
}

export function BatchDetail({ batch, onDeleted }: BatchDetailProps) {
  const [contentRunId, setContentRunId] = useState<string | null>(null);
  const detailQuery = useQuery({
    queryKey: ["analysis-batch", batch.id],
    queryFn: () => fetchAnalysisBatch(batch.id),
    initialData: batch,
    refetchInterval: 5000
  });
  const currentBatch = detailQuery.data ?? batch;
  const runs = currentBatch.runs ?? [];
  const selectedContentRunId = contentRunId ?? runs.find((run) => run.validCount > 0)?.id ?? runs[0]?.id ?? null;

  const deleteMutation = useMutation({
    mutationFn: () => deleteAnalysisBatch(currentBatch.id),
    onSuccess: onDeleted,
    onError: (error) => window.alert(error instanceof Error ? error.message : "Delete failed")
  });
  const reportMutation = useMutation({
    mutationFn: () => generateBatchReport(currentBatch.id),
    onSuccess: () => detailQuery.refetch(),
    onError: (error) => window.alert(error instanceof Error ? error.message : "Report generation failed")
  });

  function handleDelete() {
    if (currentBatch.status === "collecting") return;
    if (!window.confirm("Delete this batch and all platform runs?")) return;
    deleteMutation.mutate();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{currentBatch.name}</h2>
            <RunStatusBadge status={currentBatch.status} />
          </div>
          <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted">
            {currentBatch.startedAt && <span>Started {formatDateTime(currentBatch.startedAt)}</span>}
            {currentBatch.finishedAt && <span>Finished {formatDateTime(currentBatch.finishedAt)}</span>}
            <span>
              {currentBatch.validCount} valid · {currentBatch.duplicateCount} dupes · {currentBatch.collectedCount} collected
            </span>
          </div>
        </div>
        <button
          type="button"
          title="Delete batch"
          disabled={currentBatch.status === "collecting" || deleteMutation.isPending}
          onClick={handleDelete}
          className="rounded border border-line p-1.5 text-muted hover:text-red-700 disabled:opacity-40"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
        {canGenerateReport(currentBatch) && !currentBatch.reportId && (
          <button
            type="button"
            disabled={reportMutation.isPending}
            onClick={() => reportMutation.mutate()}
            className="rounded bg-ink px-3 py-1.5 text-xs font-medium text-surface hover:bg-ink/80 disabled:opacity-50"
          >
            {reportMutation.isPending ? "Generating..." : "Generate batch report"}
          </button>
        )}
      </div>

      <SetupPanel batch={currentBatch} />
      <PlatformRunsPanel runs={runs} />
      {currentBatch.reportId && <BatchReportView reportId={currentBatch.reportId} />}

      {selectedContentRunId && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Content by platform</h3>
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setContentRunId(run.id)}
                className={`rounded border px-3 py-1.5 text-xs ${
                  selectedContentRunId === run.id ? "border-ink bg-ink text-surface" : "border-line text-muted hover:text-ink"
                }`}
              >
                {formatPlatform(run.platform)} · {run.validCount}
              </button>
            ))}
          </div>
          <RunContentPanel runId={selectedContentRunId} />
        </div>
      )}
    </div>
  );
}

function canGenerateReport(batch: AnalysisBatch) {
  return batch.status === "content_ready" || batch.status === "partial_ready";
}

function BatchReportView({ reportId }: { reportId: string }) {
  const reportQuery = useQuery({
    queryKey: ["report", reportId],
    queryFn: () => fetchReport(reportId)
  });

  if (reportQuery.isLoading) return <p className="text-sm text-muted">Loading report...</p>;
  if (!reportQuery.data) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-4">
      <h3 className="text-sm font-semibold">{reportQuery.data.title}</h3>
      <pre className="max-h-80 overflow-auto rounded bg-panel p-3 text-xs leading-relaxed whitespace-pre-wrap">
        {reportQuery.data.contentMarkdown}
      </pre>
    </div>
  );
}

function SetupPanel({ batch }: { batch: AnalysisBatch }) {
  const rows: [string, string][] = [
    ["Goal", batch.goal],
    ["Include keywords", batch.includeKeywords.join(", ")],
    ["Exclude keywords", batch.excludeKeywords.join(", ") || "-"],
    ["Language", batch.language],
    ["Market", batch.market],
    ["Created", formatDateTime(batch.createdAt)]
  ];

  return (
    <dl className="divide-y divide-line rounded-lg border border-line">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-4 px-4 py-3">
          <dt className="w-36 shrink-0 text-xs text-muted">{label}</dt>
          <dd className="text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlatformRunsPanel({ runs }: { runs: AnalysisRun[] }) {
  const rows = useMemo(() => runs.slice().sort((a, b) => a.platform.localeCompare(b.platform)), [runs]);

  if (rows.length === 0) {
    return <p className="rounded-lg border border-line p-4 text-sm text-muted">No platform runs were created.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="grid grid-cols-[1fr_5rem_5rem_5rem_5rem_8rem] gap-3 border-b border-line px-4 py-2 text-xs font-medium text-muted">
        <span>Platform</span>
        <span className="text-right">Target</span>
        <span className="text-right">Collected</span>
        <span className="text-right">Valid</span>
        <span className="text-right">Dupes</span>
        <span>Status</span>
      </div>
      {rows.map((run) => (
        <PlatformRunRow key={run.id} run={run} />
      ))}
    </div>
  );
}

function PlatformRunRow({ run }: { run: AnalysisRun }) {
  const tasksQuery = useQuery({
    queryKey: ["run-crawl-tasks", run.id],
    queryFn: () => fetchRunCrawlTasks(run.id),
    refetchInterval: run.status === "collecting" ? 3000 : false
  });
  const latestTask = tasksQuery.data?.[0];

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="grid grid-cols-[1fr_5rem_5rem_5rem_5rem_8rem] items-center gap-3 px-4 py-3 text-sm">
        <div className="min-w-0">
          <p className="font-medium">{formatPlatform(run.platform)}</p>
          <p className="font-mono text-xs text-muted">#{shortId(run.id)}</p>
        </div>
        <span className="text-right">{run.limit}</span>
        <span className="text-right">{run.collectedCount}</span>
        <span className="text-right">{run.validCount}</span>
        <span className="text-right">{run.duplicateCount}</span>
        <RunStatusBadge status={run.status} />
      </div>
      {(run.errorMessage || latestTask?.errorMessage) && (
        <p className="mx-4 mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">
          {run.errorMessage ?? latestTask?.errorMessage}
        </p>
      )}
      {run.status === "collecting" && latestTask && (
        <p className="mx-4 mb-3 text-xs text-muted">
          Task #{shortId(latestTask.id)} · {latestTask.collectedCount}/{latestTask.targetCount} collected
        </p>
      )}
    </div>
  );
}

function formatPlatform(platform: AnalysisRun["platform"]) {
  if (platform === "web") return "Web";
  if (platform === "x") return "X / Twitter";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}
