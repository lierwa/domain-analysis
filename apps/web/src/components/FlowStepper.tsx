const flowSteps = [
  { page: "topics", label: "Topics" },
  { page: "queries", label: "Queries" },
  { page: "tasks", label: "Tasks" },
  { page: "content", label: "Content" }
] as const;

interface FlowStepperProps {
  activePage: string;
  onNavigate: (page: string) => void;
}

/** WHY: E2 流程提示 —— 与 CONTEXT 阶段 1 漏斗对齐，降低「不知道下一步去哪」的割裂感。 */
export function FlowStepper({ activePage, onNavigate }: FlowStepperProps) {
  return (
    <nav
      aria-label="Collection workflow"
      className="mb-5 flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm"
    >
      {flowSteps.map((step, index) => {
        const isActive = activePage === step.page;
        return (
          <div key={step.page} className="flex items-center gap-2">
            {index > 0 ? <span className="text-muted" aria-hidden="true">→</span> : null}
            <button
              type="button"
              onClick={() => onNavigate(step.page)}
              className={[
                "rounded px-2 py-1 font-medium transition",
                isActive ? "bg-ink text-surface" : "text-muted hover:bg-surface hover:text-ink"
              ].join(" ")}
            >
              {step.label}
            </button>
          </div>
        );
      })}
      <span className="ml-auto hidden text-xs text-muted sm:inline">Sources · Analytics · Reports — next</span>
    </nav>
  );
}
