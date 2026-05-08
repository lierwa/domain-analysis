import { useQuery } from "@tanstack/react-query";
import { fetchSources } from "../lib/api";

// WHY: Settings 只展示真实已配置项，不显示未实现功能的假配置入口。
export function SettingsPage() {
  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: fetchSources
  });
  const browserSources = (sourcesQuery.data ?? []).filter((source) =>
    ["reddit", "youtube", "x"].includes(source.platform)
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted">Runtime configuration for the analysis platform.</p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Browser Collection</h2>
        <div className="rounded-xl border border-line p-4">
          <dl className="divide-y divide-line">
            <SettingRow label="Mode" value="Crawlee + Playwright browser crawler" />
            <SettingRow label="Platforms" value="Reddit, YouTube, X" />
            <SettingRow label="Browser profile" value="BROWSER_PROFILE_PATH for local_profile mode" />
            <SettingRow label="Default scrolls" value="5 scrolls per platform" />
            <SettingRow label="Max concurrency" value="1 browser task at a time" />
            <SettingRow label="Safety boundary" value="No captcha bypass, no paid platform APIs" />
          </dl>
          {browserSources.length > 0 && (
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {browserSources.map((source) => (
                <div key={source.id} className="rounded border border-line px-3 py-2">
                  <p className="text-sm font-medium">{source.name}</p>
                  <p className="mt-1 text-xs text-muted">
                    {source.crawlerType} · {source.requiresLogin ? "local login" : "public page"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">AI Provider</h2>
        <div className="rounded-xl border border-dashed border-line p-4">
          <p className="text-sm text-muted">
            AI analysis and LLM report generation are not yet configured.
          </p>
          <p className="mt-1 text-xs text-muted">This will be available in a future release.</p>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Worker Runtime</h2>
        <div className="rounded-xl border border-line p-4">
          <dl className="divide-y divide-line">
            <SettingRow label="Queue" value="BullMQ / Redis crawl queue" />
            <SettingRow label="Persistence" value="Shared SQLite data/domain-analysis.sqlite" />
            <SettingRow label="Recovery" value="Stale collecting runs are failed on worker startup" />
          </dl>
        </div>
      </section>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-4 py-3">
      <dt className="w-32 shrink-0 text-xs text-muted">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
