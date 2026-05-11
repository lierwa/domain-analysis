import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { PaginationControls } from "../components/PaginationControls";
import { RunStatusBadge } from "../components/RunStatusBadge";
import {
  createAnalysisRun,
  deleteAnalysisBatch,
  deleteAnalysisRun,
  fetchAnalysisBatches,
  fetchAnalysisRuns,
  startAnalysisRun,
  type AnalysisBatch,
  type AnalysisRun,
  type CreateAnalysisRunInput,
  type Platform
} from "../lib/api";
import { formatRelativeTime } from "../lib/format";
import { BatchDetail } from "./BatchDetail";
import { CollectionPlansPanel } from "./CollectionPlansPanel";
import { RunDetail } from "./RunDetail";
import { StartAnalysisBatchForm } from "./StartAnalysisBatchForm";

const PAGE_SIZE = 20;

export function WorkspacePage() {
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<"batch" | "run">("batch");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const batchesQuery = useQuery({
    queryKey: ["analysis-batches", page],
    queryFn: () => fetchAnalysisBatches({ page, pageSize: PAGE_SIZE }),
    refetchInterval: 5000 // WHY: batch 状态由多个 child run 汇总，轮询让主列表保持可观测。
  });
  const runsQuery = useQuery({
    queryKey: ["analysis-runs", page],
    queryFn: () => fetchAnalysisRuns({ page, pageSize: PAGE_SIZE }),
    refetchInterval: 5000,
    enabled: mode === "run"
  });

  const selectedBatch = batchesQuery.data?.items.find((batch) => batch.id === selectedBatchId);
  const selectedRun = runsQuery.data?.items.find((run) => run.id === selectedRunId);
  const hasBatches = (batchesQuery.data?.items.length ?? 0) > 0;
  const hasRuns = (runsQuery.data?.items.length ?? 0) > 0;

  function refreshBatches() {
    queryClient.invalidateQueries({ queryKey: ["analysis-batches"] });
    if (selectedBatchId) queryClient.invalidateQueries({ queryKey: ["analysis-batch", selectedBatchId] });
  }

  function handleBatchCreated(batch: AnalysisBatch) {
    refreshBatches();
    setSelectedBatchId(batch.id);
    setShowForm(false);
  }

  function handleBatchDeleted(batchId: string) {
    refreshBatches();
    if (selectedBatchId === batchId) setSelectedBatchId(null);
  }
  function refreshRuns() {
    queryClient.invalidateQueries({ queryKey: ["analysis-runs"] });
  }

  function handleRunCreated(run: AnalysisRun) {
    refreshRuns();
    setSelectedRunId(run.id);
    setShowForm(false);
  }

  function handleRunDeleted(runId: string) {
    refreshRuns();
    if (selectedRunId === runId) setSelectedRunId(null);
  }

  const isBatchMode = mode === "batch";
  const listHasItems = isBatchMode ? hasBatches : hasRuns;

  return (
    <div className="flex h-full gap-6">
      <div className="flex w-72 shrink-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{isBatchMode ? "Analysis Batches" : "Single Runs"}</h2>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded bg-ink px-3 py-1.5 text-xs font-medium text-surface hover:bg-ink/80"
          >
            + New
          </button>
        </div>
        <div className="grid grid-cols-2 rounded-lg border border-line p-0.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setMode("batch");
              setShowForm(false);
            }}
            className={`rounded px-2 py-1.5 ${isBatchMode ? "bg-ink text-surface" : "text-muted hover:text-ink"}`}
          >
            Batch
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("run");
              setShowForm(false);
            }}
            className={`rounded px-2 py-1.5 ${!isBatchMode ? "bg-ink text-surface" : "text-muted hover:text-ink"}`}
          >
            Single
          </button>
        </div>

        {isBatchMode && batchesQuery.isLoading && <p className="text-sm text-muted">Loading...</p>}
        {!isBatchMode && runsQuery.isLoading && <p className="text-sm text-muted">Loading...</p>}
        {isBatchMode && batchesQuery.isError && <p className="text-sm text-red-600">Failed to load batches.</p>}
        {!isBatchMode && runsQuery.isError && <p className="text-sm text-red-600">Failed to load runs.</p>}

        {!listHasItems && !showForm && <EmptyState mode={mode} onStart={() => setShowForm(true)} />}

        <div className="flex flex-col gap-1.5">
          {isBatchMode && batchesQuery.data?.items.map((batch) => (
            <BatchListItem
              key={batch.id}
              batch={batch}
              isSelected={batch.id === selectedBatchId}
              onDeleted={() => handleBatchDeleted(batch.id)}
              onClick={() => {
                setSelectedBatchId(batch.id);
                setShowForm(false);
              }}
            />
          ))}
          {!isBatchMode && runsQuery.data?.items.map((run) => (
            <RunListItem
              key={run.id}
              run={run}
              isSelected={run.id === selectedRunId}
              onDeleted={() => handleRunDeleted(run.id)}
              onClick={() => {
                setSelectedRunId(run.id);
                setShowForm(false);
              }}
            />
          ))}
        </div>

        {isBatchMode && batchesQuery.data && batchesQuery.data.page.totalPages > 1 && (
          <PaginationControls page={batchesQuery.data.page} onPageChange={setPage} />
        )}
        {!isBatchMode && runsQuery.data && runsQuery.data.page.totalPages > 1 && (
          <PaginationControls page={runsQuery.data.page} onPageChange={setPage} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {showForm && isBatchMode && (
          <StartAnalysisBatchForm
            onSuccess={handleBatchCreated}
            onCancel={listHasItems ? () => setShowForm(false) : undefined}
          />
        )}
        {showForm && !isBatchMode && (
          <StartAnalysisRunForm
            onSuccess={handleRunCreated}
            onCancel={listHasItems ? () => setShowForm(false) : undefined}
          />
        )}
        {!showForm && isBatchMode && selectedBatch && (
          <div className="flex flex-col gap-4">
            <BatchDetail
              batch={selectedBatch}
              onDeleted={() => handleBatchDeleted(selectedBatch.id)}
            />
            <CollectionPlansPanel projectId={selectedBatch.projectId} />
          </div>
        )}
        {!showForm && !isBatchMode && selectedRun && (
          <div className="flex flex-col gap-4">
            <RunDetail
              run={selectedRun}
              onDeleted={() => handleRunDeleted(selectedRun.id)}
              onRefresh={refreshRuns}
            />
            <CollectionPlansPanel projectId={selectedRun.projectId} />
          </div>
        )}
        {!showForm && isBatchMode && !selectedBatch && hasBatches && (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Select a batch to view details
          </div>
        )}
        {!showForm && !isBatchMode && !selectedRun && hasRuns && (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Select a run to view details
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ mode, onStart }: { mode: "batch" | "run"; onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-line p-8 text-center">
      <div>
        <p className="text-sm font-medium">{mode === "batch" ? "No analysis batches yet" : "No single runs yet"}</p>
        <p className="mt-1 text-xs text-muted">Create one goal and run it across multiple platforms.</p>
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

function RunListItem({
  run,
  isSelected,
  onClick,
  onDeleted
}: {
  run: AnalysisRun;
  isSelected: boolean;
  onClick: () => void;
  onDeleted: () => void;
}) {
  const deleteMutation = useMutation({
    mutationFn: () => deleteAnalysisRun(run.id),
    onSuccess: onDeleted,
    onError: (error) => window.alert(error instanceof Error ? error.message : "Delete failed")
  });

  function handleDelete(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (run.status === "collecting") return;
    if (!window.confirm("Delete this analysis run?")) return;
    deleteMutation.mutate();
  }

  return (
    <div
      className={[
        "flex w-full items-start gap-2 rounded-lg border p-3 text-left transition",
        isSelected ? "border-ink bg-ink text-surface" : "border-line bg-panel hover:border-ink/30"
      ].join(" ")}
    >
      <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
        <div className="flex items-start justify-between gap-2">
          <p className={`truncate text-sm font-medium ${isSelected ? "text-surface" : "text-ink"}`}>{run.name}</p>
          <RunStatusBadge status={run.status} />
        </div>
        <p className={`mt-1 text-xs ${isSelected ? "text-surface/70" : "text-muted"}`}>
          {run.validCount} valid · {run.platform} · {formatRelativeTime(run.createdAt)}
        </p>
      </button>
      <button
        type="button"
        title="Delete run"
        disabled={run.status === "collecting" || deleteMutation.isPending}
        onClick={handleDelete}
        className={`mt-0.5 rounded p-1.5 ${
          isSelected ? "text-surface/70 hover:text-red-200" : "text-muted hover:text-red-700"
        } disabled:opacity-40`}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function BatchListItem({
  batch,
  isSelected,
  onClick,
  onDeleted
}: {
  batch: AnalysisBatch;
  isSelected: boolean;
  onClick: () => void;
  onDeleted: () => void;
}) {
  const deleteMutation = useMutation({
    mutationFn: () => deleteAnalysisBatch(batch.id),
    onSuccess: onDeleted,
    onError: (error) => window.alert(error instanceof Error ? error.message : "Delete failed")
  });

  function handleDelete(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (batch.status === "collecting") return;
    if (!window.confirm("Delete this analysis batch and all platform runs?")) return;
    deleteMutation.mutate();
  }

  return (
    <div
      className={[
        "flex w-full items-start gap-2 rounded-lg border p-3 text-left transition",
        isSelected ? "border-ink bg-ink text-surface" : "border-line bg-panel hover:border-ink/30"
      ].join(" ")}
    >
      <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
        <div className="flex items-start justify-between gap-2">
          <p className={`truncate text-sm font-medium ${isSelected ? "text-surface" : "text-ink"}`}>
            {batch.name}
          </p>
          <RunStatusBadge status={batch.status} />
        </div>
        <p className={`mt-1 text-xs ${isSelected ? "text-surface/70" : "text-muted"}`}>
          {batch.validCount} valid · {batch.runCount ?? batch.runs?.length ?? 0} platforms · {formatRelativeTime(batch.createdAt)}
        </p>
      </button>
      <button
        type="button"
        title="Delete batch"
        disabled={batch.status === "collecting" || deleteMutation.isPending}
        onClick={handleDelete}
        className={`mt-0.5 rounded p-1.5 ${
          isSelected ? "text-surface/70 hover:text-red-200" : "text-muted hover:text-red-700"
        } disabled:opacity-40`}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function StartAnalysisRunForm({
  onSuccess,
  onCancel
}: {
  onSuccess: (run: AnalysisRun) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<CreateAnalysisRunInput>({
    platform: "reddit",
    goal: "",
    includeKeywords: [],
    excludeKeywords: [],
    language: "en",
    market: "US",
    limit: 100
  });
  const [keywordsInput, setKeywordsInput] = useState("");
  const [excludeInput, setExcludeInput] = useState("");
  const createMutation = useMutation({ mutationFn: createAnalysisRun });
  const startMutation = useMutation({ mutationFn: startAnalysisRun });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const includeKeywords = splitCommaList(keywordsInput);
    if (includeKeywords.length === 0) return;
    const run = await createMutation.mutateAsync({
      ...form,
      includeKeywords,
      excludeKeywords: splitCommaList(excludeInput)
    });
    onSuccess(await startMutation.mutateAsync(run.id));
  }

  const isLoading = createMutation.isPending || startMutation.isPending;

  return (
    <div className="mx-auto max-w-xl">
      <h2 className="mb-1 text-lg font-semibold">Start a single-platform run</h2>
      <p className="mb-6 text-sm text-muted">
        Compatibility path for one platform at a time. Batch remains the recommended multi-platform flow.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label="Analysis goal" required>
          <textarea
            required
            rows={2}
            value={form.goal}
            onChange={(event) => setForm((value) => ({ ...value, goal: event.target.value }))}
            className="input-base w-full resize-none"
          />
        </Field>
        <Field label="Include keywords (comma separated)" required>
          <input
            required
            value={keywordsInput}
            onChange={(event) => setKeywordsInput(event.target.value)}
            className="input-base w-full"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Platform" required>
            <select
              value={form.platform}
              onChange={(event) => setForm((value) => ({ ...value, platform: event.target.value as Platform }))}
              className="input-base w-full"
            >
              <option value="reddit">Reddit</option>
              <option value="youtube">YouTube</option>
              <option value="x">X / Twitter</option>
              <option value="web">Web</option>
            </select>
          </Field>
          <Field label="Limit" required>
            <input
              type="number"
              min={1}
              max={500}
              value={form.limit}
              onChange={(event) => setForm((value) => ({ ...value, limit: Number(event.target.value) }))}
              className="input-base w-full"
            />
          </Field>
        </div>
        <Field label="Exclude keywords (comma separated)">
          <input
            value={excludeInput}
            onChange={(event) => setExcludeInput(event.target.value)}
            className="input-base w-full"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Language">
            <input
              value={form.language}
              onChange={(event) => setForm((value) => ({ ...value, language: event.target.value }))}
              className="input-base w-full"
            />
          </Field>
          <Field label="Market">
            <input
              value={form.market}
              onChange={(event) => setForm((value) => ({ ...value, market: event.target.value }))}
              className="input-base w-full"
            />
          </Field>
        </div>
        {(createMutation.isError || startMutation.isError) && (
          <p className="text-sm text-red-600">
            {(createMutation.error ?? startMutation.error) instanceof Error
              ? (createMutation.error ?? startMutation.error)?.message
              : "Run creation failed."}
          </p>
        )}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isLoading}
            className="rounded bg-ink px-5 py-2.5 text-sm font-medium text-surface hover:bg-ink/80 disabled:opacity-50"
          >
            {isLoading ? "Starting..." : "Start run"}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="rounded border border-line px-5 py-2.5 text-sm">
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
  children
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function splitCommaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
