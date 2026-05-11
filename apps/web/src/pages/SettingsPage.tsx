import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { fetchXLoginStatus, openXLoginBrowser } from "../lib/api";

// WHY: Settings 只展示真实已配置项，不显示未实现功能的假配置入口。
export function SettingsPage() {
  const queryClient = useQueryClient();
  const xStatusQuery = useQuery({
    queryKey: ["settings", "x-login"],
    queryFn: fetchXLoginStatus,
    refetchInterval: 5000
  });
  const openLoginMutation = useMutation({
    mutationFn: openXLoginBrowser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings", "x-login"] })
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted">Runtime configuration for the analysis platform.</p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Reddit Collection</h2>
        <div className="rounded-xl border border-line p-4">
          <dl className="divide-y divide-line">
            <SettingRow label="Mode" value="Public JSON API (no login required)" />
            <SettingRow label="Default limit" value="100 posts per run" />
            <SettingRow label="Max concurrency" value="1 (conservative, rate-limit friendly)" />
          </dl>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">X Collection</h2>
        <div className="rounded-xl border border-line p-4">
          <dl className="divide-y divide-line">
            <SettingRow label="Mode" value={xStatusQuery.data?.mode ?? "browser_profile"} />
            <SettingRow label="Profile" value={xStatusQuery.data?.profileDir ?? "Loading..."} />
            <SettingRow
              label="Login"
              value={xStatusQuery.data?.loggedIn ? "Ready" : xStatusQuery.data?.message ?? "Checking..."}
            />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={openLoginMutation.isPending}
              onClick={() => openLoginMutation.mutate()}
              className="inline-flex items-center gap-2 rounded bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-ink/80 disabled:opacity-50"
            >
              <ExternalLink size={15} aria-hidden="true" />
              {openLoginMutation.isPending ? "Opening..." : "Open login browser"}
            </button>
            <button
              type="button"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["settings", "x-login"] })}
              className="inline-flex items-center gap-2 rounded border border-line px-4 py-2 text-sm text-muted hover:text-ink"
            >
              <RefreshCw size={15} aria-hidden="true" />
              Check status
            </button>
          </div>
          <p className="mt-3 text-xs text-muted">
            X uses a dedicated local Chrome profile. Finish login manually in the opened browser, then retry the failed run.
          </p>
          {openLoginMutation.isError && (
            <p className="mt-2 text-sm text-red-600">
              {openLoginMutation.error instanceof Error ? openLoginMutation.error.message : "Could not open login browser."}
            </p>
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
            <SettingRow label="Queue" value="In-process p-queue (single-node)" />
            <SettingRow label="Persistence" value="SQLite (local file)" />
            <SettingRow label="Note" value="Process restart will clear in-progress jobs" />
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
