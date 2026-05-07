import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RunStatusBadge } from "../components/RunStatusBadge";
import { RunStageTabs, type RunStage } from "../components/RunStageTabs";
import {
  fetchReport,
  fetchRunCrawlTasks,
  generateRunReport,
  retryAnalysisRun,
  type AnalysisRun
} from "../lib/api";
import { formatDateTime, shortId } from "../lib/format";
import { RunContentPanel } from "./RunContentPanel";

interface RunDetailProps {
  run: AnalysisRun;
  onRefresh: () => void;
}

// WHY: RunDetail 一个页面承载完整闭环，用 stage tab 替代多级导航跳转。
export function RunDetail({ run, onRefresh }: RunDetailProps) {
  const [stage, setStage] = useState<RunStage>(deriveDefaultStage(run.status));
  const queryClient = useQueryClient();

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["analysis-runs"] });
    queryClient.invalidateQueries({ queryKey: ["run-contents", run.id] });
    queryClient.invalidateQueries({ queryKey: ["run-crawl-tasks", run.id] });
    onRefresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{run.name}</h2>
            <RunStatusBadge status={run.status} />
          </div>
          <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted">
            {run.startedAt && <span>Started {formatDateTime(run.startedAt)}</span>}
            {run.finishedAt && <span>Finished {formatDateTime(run.finishedAt)}</span>}
            <span>{run.validCount} valid · {run.duplicateCount} dupes · {run.collectedCount} collected</span>
          </div>
        </div>
        <RunActions run={run} onRefresh={handleRefresh} />
      </div>

      {/* Stage tabs */}
      <RunStageTabs active={stage} onChange={setStage} status={run.status} />

      {/* Stage content */}
      <div className="mt-2">
        {stage === "setup" && <SetupTab run={run} />}
        {stage === "collection" && <CollectionTab runId={run.id} />}
        {stage === "content" && <RunContentPanel runId={run.id} />}
        {stage === "insights" && <InsightsTab />}
        {stage === "report" && <ReportTab run={run} onRefresh={handleRefresh} />}
      </div>
    </div>
  );
}

// WHY: 默认 tab 由当前状态驱动，避免用户进入后看到空白 tab。
function deriveDefaultStage(status: AnalysisRun["status"]): RunStage {
  if (status === "draft") return "setup";
  if (status === "collecting" || status === "collection_failed") return "collection";
  if (status === "content_ready" || status === "analyzing" || status === "analysis_failed") return "content";
  if (status === "insight_ready") return "insights";
  if (status === "report_ready") return "report";
  return "collection";
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function RunActions({ run, onRefresh }: { run: AnalysisRun; onRefresh: () => void }) {
  const retryMutation = useMutation({
    mutationFn: () => retryAnalysisRun(run.id),
    onSuccess: onRefresh
  });
  const reportMutation = useMutation({
    mutationFn: () => generateRunReport(run.id),
    onSuccess: onRefresh
  });

  return (
    <div className="flex gap-2">
      {run.status === "collection_failed" && (
        <button
          type="button"
          disabled={retryMutation.isPending}
          onClick={() => retryMutation.mutate()}
          className="rounded border border-line px-3 py-1.5 text-xs hover:bg-surface disabled:opacity-50"
        >
          {retryMutation.isPending ? "Retrying…" : "Retry"}
        </button>
      )}
      {(run.status === "content_ready" || run.status === "insight_ready") && !run.reportId && (
        <button
          type="button"
          disabled={reportMutation.isPending}
          onClick={() => reportMutation.mutate()}
          className="rounded bg-ink px-3 py-1.5 text-xs font-medium text-surface hover:bg-ink/80 disabled:opacity-50"
        >
          {reportMutation.isPending ? "Generating…" : "Generate report"}
        </button>
      )}
    </div>
  );
}

// ─── Setup Tab ────────────────────────────────────────────────────────────────

function SetupTab({ run }: { run: AnalysisRun }) {
  const rows: [string, string][] = [
    ["Goal", run.name],
    ["Platform", "Reddit"],
    ["Include keywords", run.includeKeywords.join(", ")],
    ["Exclude keywords", run.excludeKeywords.join(", ") || "—"],
    ["Limit", String(run.limit)],
    ["Status", run.status],
    ["Created", formatDateTime(run.createdAt)]
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

// ─── Collection Tab ───────────────────────────────────────────────────────────

function CollectionTab({ runId }: { runId: string }) {
  const tasksQuery = useQuery({
    queryKey: ["run-crawl-tasks", runId],
    queryFn: () => fetchRunCrawlTasks(runId),
    refetchInterval: 3000
  });

  if (tasksQuery.isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (!tasksQuery.data?.length) {
    return <p className="text-sm text-muted">No crawl tasks yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {tasksQuery.data.map((task) => (
        <div key={task.id} className="rounded-lg border border-line p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-muted">#{shortId(task.id)}</span>
            <StatusPill status={task.status} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center text-sm">
            <Metric label="Target" value={task.targetCount} />
            <Metric label="Collected" value={task.collectedCount} />
            <Metric label="Valid" value={task.validCount} />
          </div>
          {task.errorMessage && (
            <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{task.errorMessage}</p>
          )}
          {task.startedAt && (
            <p className="mt-2 text-xs text-muted">Started {formatDateTime(task.startedAt)}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const isRunning = status === "running" || status === "pending";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        isRunning
          ? "bg-blue-100 text-blue-700 animate-pulse"
          : status === "success"
            ? "bg-green-100 text-green-700"
            : status === "no_content"
              ? "bg-yellow-100 text-yellow-700"
              : "bg-red-100 text-red-700"
      }`}
    >
      {status}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-lg font-semibold">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

// ─── Insights Tab ─────────────────────────────────────────────────────────────

function InsightsTab() {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-sm font-medium text-muted">Analysis is not configured yet</p>
      <p className="text-xs text-muted">AI analysis will be enabled in a future release.</p>
      <button
        type="button"
        disabled
        className="rounded border border-line px-4 py-2 text-sm text-muted/40 cursor-not-allowed"
      >
        Run analysis
      </button>
    </div>
  );
}

// ─── Report Tab ───────────────────────────────────────────────────────────────

function ReportTab({ run, onRefresh }: { run: AnalysisRun; onRefresh: () => void }) {
  const reportMutation = useMutation({
    mutationFn: () => generateRunReport(run.id),
    onSuccess: onRefresh
  });

  if (!run.reportId) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-sm text-muted">No report generated yet.</p>
        {(run.status === "content_ready" || run.status === "insight_ready") && (
          <button
            type="button"
            disabled={reportMutation.isPending}
            onClick={() => reportMutation.mutate()}
            className="rounded bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-ink/80 disabled:opacity-50"
          >
            {reportMutation.isPending ? "Generating…" : "Generate report from this run"}
          </button>
        )}
      </div>
    );
  }

  return <ReportView reportId={run.reportId} />;
}

function ReportView({ reportId }: { reportId: string }) {
  const { data: reportData, isLoading } = useQuery({
    queryKey: ["report", reportId],
    queryFn: () => fetchReport(reportId)
  });

  if (isLoading) return <p className="text-sm text-muted">Loading report…</p>;
  if (!reportData) return <p className="text-sm text-red-600">Report not found.</p>;

  function copyMarkdown() {
    void navigator.clipboard.writeText(reportData!.contentMarkdown);
  }

  function downloadMarkdown() {
    const blob = new Blob([reportData!.contentMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportData!.title.replace(/\s+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{reportData.title}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copyMarkdown}
            className="rounded border border-line px-3 py-1.5 text-xs hover:bg-surface"
          >
            Copy markdown
          </button>
          <button
            type="button"
            onClick={downloadMarkdown}
            className="rounded border border-line px-3 py-1.5 text-xs hover:bg-surface"
          >
            Export
          </button>
        </div>
      </div>
      <pre className="overflow-auto rounded-lg bg-panel p-4 text-xs leading-relaxed whitespace-pre-wrap">
        {reportData.contentMarkdown}
      </pre>
    </div>
  );
}
