import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSources, updateSource, type Platform, type Source } from "../lib/api";
import { humanizeStatus } from "../lib/format";
import { PageHeader } from "./PageHeader";

const sourceCopy: Partial<Record<Platform, { mode: string; note: string }>> = {
  reddit: {
    mode: "Public JSON",
    note: "No secret required by default. Runs slowly against public Reddit JSON pages."
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
    mutationFn: ({ platform, enabled }: { platform: Platform; enabled: boolean }) =>
      updateSource(platform, enabled),
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
          />
        ))}
      </div>
    </section>
  );
}

function SourceCard({
  source,
  saving,
  onToggle
}: {
  source: Source;
  saving: boolean;
  onToggle: (enabled: boolean) => void;
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
