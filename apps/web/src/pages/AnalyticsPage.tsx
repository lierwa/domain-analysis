import { PageHeader } from "./PageHeader";

const emptyTrend = [
  { day: "Mon", height: "h-4" },
  { day: "Tue", height: "h-6" },
  { day: "Wed", height: "h-8" },
  { day: "Thu", height: "h-5" },
  { day: "Fri", height: "h-7" }
];

export function AnalyticsPage() {
  return (
    <section>
      <PageHeader
        title="Analytics"
        description="View volume trends, platform distribution, topic rankings, sentiment, keyword performance, and high-value content."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-md border border-line bg-surface p-4">
          <h2 className="mb-3 text-base font-semibold">Volume Trend</h2>
          <div className="flex h-72 items-end gap-3 border-b border-line px-2 pb-4">
            {emptyTrend.map((item) => (
              <div key={item.day} className="flex flex-1 flex-col items-center gap-2">
                <div className={`w-full rounded-t bg-ink ${item.height}`} />
                <span className="text-xs text-muted">{item.day}</span>
              </div>
            ))}
          </div>
        </article>
        <article className="rounded-md border border-line bg-surface p-4">
          <h2 className="mb-3 text-base font-semibold">Insight Summary</h2>
          <div className="grid min-h-72 place-items-center border border-dashed border-line text-sm text-muted">
            Aggregated AI insights will appear after analysis jobs run
          </div>
        </article>
      </div>
    </section>
  );
}
