import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSources, updateSource, type Platform, type Source, type SourceUpdateInput } from "../lib/api";
import { humanizeStatus } from "../lib/format";
import { PageHeader } from "./PageHeader";

const sourceCopy: Partial<Record<Platform, { mode: string; note: string }>> = {
  reddit: {
    mode: "Playwright (default) or HTTP JSON",
    note: "Default uses a real browser context to fetch search results (no Reddit API key). Switch to HTTP JSON only for debugging or very constrained environments."
  },
  x: {
    mode: "Nitter RSS",
    note: "Uses a public RSS-style route when available. Public instances may be unstable."
  },
  youtube: {
    mode: "Not implemented",
    note: "Configuration exists, but collection is not wired yet."
  },
  pinterest: {
    mode: "Not implemented",
    note: "Configuration exists, but browser collection is intentionally deferred."
  },
  web: {
    mode: "HTML",
    note: "Generic web collection is planned after Reddit and X are stable."
  }
};

export function SourcesPage() {
  const queryClient = useQueryClient();
  const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: fetchSources });
  const updateMutation = useMutation({
    mutationFn: (input: { platform: Platform } & SourceUpdateInput) => updateSource(input.platform, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources"] })
  });

  return (
    <section>
      <PageHeader
        title="Sources"
        description="Control which public sources can run. Reddit and X are the only active collection targets right now."
      />
      {sourcesQuery.isLoading && <div className="text-sm text-muted">Loading sources</div>}
      {sourcesQuery.isError && <div className="text-sm text-muted">Failed to load sources</div>}
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {sourcesQuery.data?.map((source) => (
          <SourceCard
            key={source.platform}
            source={source}
            saving={updateMutation.isPending}
            onToggle={(enabled) => updateMutation.mutate({ platform: source.platform, enabled })}
            onCrawlerTypeChange={
              source.platform === "reddit"
                ? (crawlerType) => updateMutation.mutate({ platform: source.platform, crawlerType })
                : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

function SourceCard({
  source,
  saving,
  onToggle,
  onCrawlerTypeChange
}: {
  source: Source;
  saving: boolean;
  onToggle: (enabled: boolean) => void;
  onCrawlerTypeChange?: (crawlerType: Source["crawlerType"]) => void;
}) {
  const copy = sourceCopy[source.platform];
  const implemented = source.platform === "reddit" || source.platform === "x";

  return (
    <article className="rounded-md border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{source.name}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{copy?.note ?? "Custom source configuration."}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={source.enabled}
            disabled={saving || !implemented}
            onChange={(event) => onToggle(event.target.checked)}
          />
          {source.enabled ? "Enabled" : "Paused"}
        </label>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Fact label="Mode" value={copy?.mode ?? humanizeStatus(source.crawlerType)} />
        <Fact label="Per Run Limit" value={String(source.defaultLimit)} />
        <Fact label="Login" value={source.requiresLogin ? "Required" : "Not required"} />
        <Fact label="Status" value={implemented ? (source.enabled ? "Ready" : "Paused") : "Coming later"} />
      </div>
      {source.platform === "reddit" && onCrawlerTypeChange ? (
        <label className="mt-3 block text-sm">
          <span className="text-xs uppercase text-muted">Reddit collection engine</span>
          <select
            className="mt-1 w-full rounded border border-line bg-surface px-2 py-1.5 text-sm"
            value={source.crawlerType}
            disabled={saving}
            onChange={(event) =>
              onCrawlerTypeChange(event.target.value as Source["crawlerType"])
            }
          >
            <option value="playwright">Playwright (browser context)</option>
            <option value="cheerio">HTTP only (public JSON, fragile)</option>
          </select>
        </label>
      ) : null}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}
