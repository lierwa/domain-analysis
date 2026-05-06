import { PageHeader } from "./PageHeader";

const reportTypes = [
  "Topic Trend Report",
  "Keyword Analysis Report",
  "Platform Content Report",
  "High Value Digest",
  "Opportunity Report"
];

export function ReportsPage() {
  return (
    <section>
      <PageHeader
        title="Reports"
        description="Generate web and Markdown reports from dashboard metrics, high-value samples, and content opportunities."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {reportTypes.map((type) => (
          <article key={type} className="rounded-md border border-line bg-panel p-4">
            <h2 className="text-sm font-semibold">{type}</h2>
            <p className="mt-3 text-sm leading-6 text-muted">Template scaffold ready</p>
          </article>
        ))}
      </div>
    </section>
  );
}
