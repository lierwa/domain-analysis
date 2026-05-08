import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PaginationControls } from "../components/PaginationControls";
import { RunStatusBadge } from "../components/RunStatusBadge";
import {
  createAnalysisRun,
  fetchAnalysisRuns,
  startAnalysisRun,
  type AnalysisRun,
  type CreateAnalysisRunInput,
  type Platform
} from "../lib/api";
import { formatRelativeTime } from "../lib/format";
import { CollectionPlansPanel } from "./CollectionPlansPanel";
import { RunDetail } from "./RunDetail";

const PAGE_SIZE = 20;

// WHY: 只有这些状态的 run 才需要持续轮询，其他状态已是终态或静态，轮询无意义且浪费资源。
const ACTIVE_RUN_STATUSES = new Set(["collecting", "analyzing", "reporting"]);
const browserPlatforms: Array<{ value: Platform; label: string }> = [
  { value: "reddit", label: "Reddit" },
  { value: "youtube", label: "YouTube" },
  { value: "x", label: "X" }
];

export function WorkspacePage() {
  const [page, setPage] = useState(1);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const runsQuery = useQuery({
    queryKey: ["analysis-runs", page],
    queryFn: () => fetchAnalysisRuns({ page, pageSize: PAGE_SIZE }),
    // WHY: 只有当列表中存在活跃 run 时才轮询；全部为终态时停止，避免 2 核 2G 环境空转。
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasActive = items.some((r) => ACTIVE_RUN_STATUSES.has(r.status));
      return hasActive ? 5000 : false;
    }
  });

  const selectedRun = runsQuery.data?.items.find((r) => r.id === selectedRunId);
  const hasRuns = (runsQuery.data?.items.length ?? 0) > 0;

  function handleRunCreated(run: AnalysisRun) {
    queryClient.invalidateQueries({ queryKey: ["analysis-runs"] });
    setSelectedRunId(run.id);
    setShowForm(false);
  }

  return (
    <div className="flex h-full gap-6">
      {/* 左侧：run 列表 */}
      <div className="flex w-72 shrink-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Analysis Runs</h2>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded bg-ink px-3 py-1.5 text-xs font-medium text-surface hover:bg-ink/80"
          >
            + New
          </button>
        </div>

        {runsQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
        {runsQuery.isError && (
          <p className="text-sm text-red-600">Failed to load runs.</p>
        )}

        {!hasRuns && !runsQuery.isLoading && !showForm && (
          <EmptyState onStart={() => setShowForm(true)} />
        )}

        <div className="flex flex-col gap-1.5">
          {runsQuery.data?.items.map((run) => (
            <RunListItem
              key={run.id}
              run={run}
              isSelected={run.id === selectedRunId}
              onClick={() => {
                setSelectedRunId(run.id);
                setShowForm(false);
              }}
            />
          ))}
        </div>

        {runsQuery.data && runsQuery.data.page.totalPages > 1 && (
          <PaginationControls page={runsQuery.data.page} onPageChange={setPage} />
        )}
      </div>

      {/* 右侧：表单或 run 详情 */}
      <div className="min-w-0 flex-1">
        {showForm && (
          <StartAnalysisForm
            onSuccess={handleRunCreated}
            onCancel={hasRuns ? () => setShowForm(false) : undefined}
          />
        )}
        {!showForm && selectedRun && (
          <div className="flex flex-col gap-4">
            <RunDetail run={selectedRun} onRefresh={() => queryClient.invalidateQueries({ queryKey: ["analysis-runs"] })} />
            <CollectionPlansPanel projectId={selectedRun.projectId} />
          </div>
        )}
        {!showForm && !selectedRun && hasRuns && (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Select a run to view details
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 空状态 ────────────────────────────────────────────────────────────────────

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-line p-8 text-center">
      <div className="text-2xl">🔍</div>
      <div>
        <p className="text-sm font-medium">No analyses yet</p>
        <p className="mt-1 text-xs text-muted">Start your first social intelligence analysis</p>
      </div>
      <button
        type="button"
        onClick={onStart}
        className="rounded bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-ink/80"
      >
        Start analysis
      </button>
    </div>
  );
}

// ─── Run 列表项 ────────────────────────────────────────────────────────────────

function RunListItem({
  run,
  isSelected,
  onClick
}: {
  run: AnalysisRun;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full rounded-lg border p-3 text-left transition",
        isSelected ? "border-ink bg-ink text-surface" : "border-line bg-panel hover:border-ink/30"
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={`truncate text-sm font-medium ${isSelected ? "text-surface" : "text-ink"}`}>
          {run.name}
        </p>
        <RunStatusBadge status={run.status} />
      </div>
      <p className={`mt-1 text-xs ${isSelected ? "text-surface/70" : "text-muted"}`}>
        {run.validCount} items · {formatRelativeTime(run.createdAt)}
      </p>
    </button>
  );
}

// ─── 创建表单 ──────────────────────────────────────────────────────────────────

function StartAnalysisForm({
  onSuccess,
  onCancel
}: {
  onSuccess: (run: AnalysisRun) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<CreateAnalysisRunInput>({
    goal: "",
    includeKeywords: [],
    excludeKeywords: [],
    language: "en",
    market: "US",
    limit: 100,
    platforms: ["reddit", "youtube", "x"],
    browserMode: "local_profile",
    maxScrollsPerPlatform: 5,
    maxItemsPerPlatform: 50
  });
  const [keywordsInput, setKeywordsInput] = useState("");
  const [excludeInput, setExcludeInput] = useState("");

  const createMutation = useMutation({ mutationFn: createAnalysisRun });
  const startMutation = useMutation({ mutationFn: startAnalysisRun });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const includeKeywords = keywordsInput
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (includeKeywords.length === 0) return;
    if (!form.platforms?.length) return;

    const excludeKeywords = excludeInput
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const run = await createMutation.mutateAsync({ ...form, includeKeywords, excludeKeywords });
    const started = await startMutation.mutateAsync(run.id);
    onSuccess(started);
  }

  const isLoading = createMutation.isPending || startMutation.isPending;

  return (
    <div className="mx-auto max-w-xl">
      <h2 className="mb-1 text-lg font-semibold">Start a social intelligence analysis</h2>
      <p className="mb-6 text-sm text-muted">Collect public browser-visible content across Reddit, YouTube, and X.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label="Analysis goal" required>
          <textarea
            required
            rows={2}
            placeholder="e.g. Understand user pain points around AI search products"
            value={form.goal}
            onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
            className="input-base w-full resize-none"
          />
        </Field>

        <Field label="Include keywords (comma separated)" required>
          <input
            required
            type="text"
            placeholder="e.g. AI search, ChatGPT, Perplexity"
            value={keywordsInput}
            onChange={(e) => setKeywordsInput(e.target.value)}
            className="input-base w-full"
          />
        </Field>

        <Field label="Exclude keywords (comma separated)">
          <input
            type="text"
            placeholder="e.g. spam, advertisement"
            value={excludeInput}
            onChange={(e) => setExcludeInput(e.target.value)}
            className="input-base w-full"
          />
        </Field>

        <Field label="Platforms" required>
          <div className="grid grid-cols-3 gap-2">
            {browserPlatforms.map((platform) => {
              const checked = form.platforms?.includes(platform.value) ?? false;
              return (
                <label
                  key={platform.value}
                  className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                    checked ? "border-ink bg-panel" : "border-line"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setForm((current) => {
                        const next = new Set(current.platforms ?? []);
                        if (event.target.checked) next.add(platform.value);
                        else next.delete(platform.value);
                        return { ...current, platforms: Array.from(next) };
                      });
                    }}
                  />
                  {platform.label}
                </label>
              );
            })}
          </div>
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Language">
            <input
              type="text"
              value={form.language}
              onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
              className="input-base w-full"
            />
          </Field>
          <Field label="Market">
            <input
              type="text"
              value={form.market}
              onChange={(e) => setForm((f) => ({ ...f, market: e.target.value }))}
              className="input-base w-full"
            />
          </Field>
          <Field label="Items / platform" hint="Browser crawler target per selected platform">
            <input
              type="number"
              min={1}
              max={500}
              value={form.maxItemsPerPlatform}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  maxItemsPerPlatform: Math.min(500, Number(e.target.value)),
                  limit: Math.min(500, Number(e.target.value))
                }))
              }
              className="input-base w-full"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Browser mode">
            <select
              value={form.browserMode}
              onChange={(e) => setForm((f) => ({ ...f, browserMode: e.target.value as CreateAnalysisRunInput["browserMode"] }))}
              className="input-base w-full"
            >
              <option value="local_profile">Local profile</option>
              <option value="headful">Headful</option>
              <option value="headless">Headless</option>
            </select>
          </Field>
          <Field label="Max scrolls">
            <input
              type="number"
              min={1}
              max={50}
              value={form.maxScrollsPerPlatform}
              onChange={(e) =>
                setForm((f) => ({ ...f, maxScrollsPerPlatform: Math.min(50, Number(e.target.value)) }))
              }
              className="input-base w-full"
            />
          </Field>
        </div>

        {(createMutation.isError || startMutation.isError) && (
          <p className="text-sm text-red-600">Something went wrong. Please try again.</p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isLoading}
            className="rounded bg-ink px-5 py-2.5 text-sm font-medium text-surface hover:bg-ink/80 disabled:opacity-50"
          >
            {isLoading ? "Starting…" : "Start analysis"}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-line px-5 py-2.5 text-sm text-muted hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}
