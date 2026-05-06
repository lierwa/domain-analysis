import { PageHeader } from "./PageHeader";

const metrics = [
  { label: "Today New", value: "0" },
  { label: "Week New", value: "0" },
  { label: "Valid Content", value: "0" },
  { label: "High Value", value: "0" },
  { label: "Running Tasks", value: "0" },
  { label: "Failed Tasks", value: "0" }
];

interface OverviewPageProps {
  apiOnline: boolean;
}

export function OverviewPage({ apiOnline }: OverviewPageProps) {
  return (
    <section>
      <PageHeader
        title="Overview"
        description="Monitor collection volume, topic movement, task health, and report output from one operational workspace."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {metrics.map((metric) => (
          <article key={metric.label} className="rounded-md border border-line bg-panel p-4">
            <div className="text-xs uppercase text-muted">{metric.label}</div>
            <div className="mt-2 text-2xl font-semibold">{metric.value}</div>
          </article>
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-md border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Topic Trends</h2>
            <span className="rounded border border-line px-2 py-1 text-xs text-muted">
              API {apiOnline ? "Online" : "Pending"}
            </span>
          </div>
          <div className="grid min-h-48 place-items-center border border-dashed border-line text-sm text-muted">
            No topic data yet
          </div>
        </article>
        <article className="rounded-md border border-line bg-surface p-4">
          <h2 className="mb-3 text-base font-semibold">High Value Content</h2>
          <div className="grid min-h-48 place-items-center border border-dashed border-line text-sm text-muted">
            Start a crawl task to populate this list
          </div>
        </article>
      </div>
    </section>
  );
}
