// WHY: Settings 只展示真实已配置项，不显示未实现功能的假配置入口。
export function SettingsPage() {
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
