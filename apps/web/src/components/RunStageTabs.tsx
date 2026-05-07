import type { AnalysisRunStatus } from "../lib/api";

export type RunStage = "setup" | "collection" | "content" | "insights" | "report";

interface RunStageTabsProps {
  active: RunStage;
  onChange: (stage: RunStage) => void;
  status: AnalysisRunStatus;
}

// WHY: tab 的可用性由 run status 驱动，避免用户看到无数据的 tab 并困惑。
function isStageEnabled(stage: RunStage, status: AnalysisRunStatus): boolean {
  switch (stage) {
    case "setup":
      return true;
    case "collection":
      return status !== "draft";
    case "content":
      return ["content_ready", "analyzing", "analysis_failed", "insight_ready", "reporting", "report_ready"].includes(status);
    case "insights":
      return ["insight_ready", "reporting", "report_ready"].includes(status);
    case "report":
      return status === "report_ready";
  }
}

const stages: { key: RunStage; label: string }[] = [
  { key: "setup", label: "Setup" },
  { key: "collection", label: "Collection" },
  { key: "content", label: "Content" },
  { key: "insights", label: "Insights" },
  { key: "report", label: "Report" }
];

export function RunStageTabs({ active, onChange, status }: RunStageTabsProps) {
  return (
    <div className="flex border-b border-line">
      {stages.map(({ key, label }) => {
        const enabled = isStageEnabled(key, status);
        const isActive = key === active;
        return (
          <button
            key={key}
            type="button"
            disabled={!enabled}
            onClick={() => enabled && onChange(key)}
            className={[
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition",
              isActive ? "border-ink text-ink" : "border-transparent",
              enabled && !isActive ? "text-muted hover:text-ink hover:border-muted" : "",
              !enabled ? "text-muted/40 cursor-not-allowed" : "cursor-pointer"
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
