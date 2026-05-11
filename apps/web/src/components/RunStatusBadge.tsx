import type { AnalysisBatchStatus, AnalysisRunStatus } from "../lib/api";

interface RunStatusBadgeProps {
  status: AnalysisRunStatus | AnalysisBatchStatus;
}

// WHY: 状态颜色独立维护，避免分散在各个页面导致不一致。
const statusConfig: Record<AnalysisRunStatus | AnalysisBatchStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-600" },
  collecting: { label: "Collecting", className: "bg-blue-100 text-blue-700 animate-pulse" },
  collection_failed: { label: "Failed", className: "bg-red-100 text-red-700" },
  partial_ready: { label: "Partial Ready", className: "bg-amber-100 text-amber-700" },
  no_content: { label: "No Content", className: "bg-yellow-100 text-yellow-700" },
  content_ready: { label: "Content Ready", className: "bg-green-100 text-green-700" },
  analyzing: { label: "Analyzing", className: "bg-purple-100 text-purple-700 animate-pulse" },
  analysis_failed: { label: "Analysis Failed", className: "bg-red-100 text-red-700" },
  insight_ready: { label: "Insight Ready", className: "bg-emerald-100 text-emerald-700" },
  reporting: { label: "Reporting", className: "bg-yellow-100 text-yellow-700 animate-pulse" },
  report_ready: { label: "Report Ready", className: "bg-teal-100 text-teal-700" }
};

export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  const config = statusConfig[status] ?? { label: status, className: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
