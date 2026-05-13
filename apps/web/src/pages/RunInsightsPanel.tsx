import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  fetchAiProviderStatus,
  fetchInsightBatches,
  fetchInsightCandidates,
  fetchLatestInsightRun,
  fetchRunInsights,
  generateRunInsights,
  type AiInsightBatch,
  type AiInsightCandidate,
  type AiInsightRunDiagnostics,
  type AiProviderStatus,
  type AnalysisRun,
  type RunInsight,
  type RunInsightsResponse
} from "../lib/api";

interface RunInsightsPanelProps {
  run: AnalysisRun;
  onRefresh: () => void;
}

export function RunInsightsPanel({ run, onRefresh }: RunInsightsPanelProps) {
  const providerQuery = useQuery({ queryKey: ["settings", "ai"], queryFn: fetchAiProviderStatus });
  const insightsQuery = useQuery({
    queryKey: ["run-insights", run.id],
    queryFn: () => fetchRunInsights(run.id, { page: 1, pageSize: 50 })
  });
  const latestRunQuery = useQuery({
    queryKey: ["run-insights", run.id, "latest-run"],
    queryFn: () => fetchLatestInsightRun(run.id)
  });
  const candidatesQuery = useQuery({
    queryKey: ["run-insights", run.id, "candidates"],
    queryFn: () => fetchInsightCandidates(run.id, { page: 1, pageSize: 100 })
  });
  const batchesQuery = useQuery({
    queryKey: ["run-insights", run.id, "batches"],
    queryFn: () => fetchInsightBatches(run.id)
  });
  const analysisMutation = useMutation({
    mutationFn: () => generateRunInsights(run.id),
    onSuccess: () => {
      insightsQuery.refetch();
      latestRunQuery.refetch();
      candidatesQuery.refetch();
      batchesQuery.refetch();
      onRefresh();
    }
  });
  function handleRunAnalysis() {
    if (!canRequestAiInsights(canRunAnalysis(run.status), providerQuery.data)) return;
    analysisMutation.mutate();
  }

  if (insightsQuery.isLoading || providerQuery.isLoading) return <p className="text-sm text-muted">Loading insights...</p>;
  return (
    <InsightsWorkspace
      data={insightsQuery.data}
      diagnostics={latestRunQuery.data ?? undefined}
      candidates={candidatesQuery.data?.items ?? []}
      batches={batchesQuery.data ?? []}
      providerStatus={providerQuery.data}
      canRunAnalysis={canRunAnalysis(run.status)}
      isAnalyzing={analysisMutation.isPending}
      error={analysisMutation.error instanceof Error ? analysisMutation.error.message : undefined}
      onRunAnalysis={handleRunAnalysis}
    />
  );
}

export function InsightsWorkspace({
  data,
  diagnostics,
  candidates = [],
  batches = [],
  providerStatus,
  canRunAnalysis,
  isAnalyzing,
  error,
  onRunAnalysis
}: {
  data?: RunInsightsResponse;
  diagnostics?: AiInsightRunDiagnostics;
  candidates?: AiInsightCandidate[];
  batches?: AiInsightBatch[];
  providerStatus?: AiProviderStatus;
  canRunAnalysis: boolean;
  isAnalyzing: boolean;
  error?: string;
  onRunAnalysis: () => void;
}) {
  const hasInsights = Boolean(data?.summary.totalInsights);
  const [themeFilter, setThemeFilter] = useState("");
  const [minConfidence, setMinConfidence] = useState(0);
  const [view, setView] = useState<"overview" | "selection" | "batches" | "results">(hasInsights ? "results" : "overview");
  const items = useMemo(
    () => filterInsights(data?.items ?? [], themeFilter, minConfidence),
    [data?.items, themeFilter, minConfidence]
  );
  const canRefreshInsights = canRequestAiInsights(canRunAnalysis, providerStatus);

  if (!hasInsights && !diagnostics) {
    return (
      <EmptyInsights
        providerStatus={providerStatus}
        canRunAnalysis={canRefreshInsights}
        isAnalyzing={isAnalyzing}
        error={error}
        onRunAnalysis={onRunAnalysis}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Header providerStatus={providerStatus} canRunAnalysis={canRefreshInsights} isAnalyzing={isAnalyzing} onRunAnalysis={onRunAnalysis} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <InsightViewTabs active={view} onChange={setView} />
      {view === "overview" && <InsightOverview data={data} diagnostics={diagnostics} providerStatus={providerStatus} />}
      {view === "selection" && <CandidateList candidates={candidates} />}
      {view === "batches" && <BatchList batches={batches} />}
      {view === "results" && data && (
        <>
          <InsightMetrics data={data} providerStatus={providerStatus} />
          <ThemeBuckets data={data} />
          <InsightFilters
            themeFilter={themeFilter}
            minConfidence={minConfidence}
            themes={data.summary.themes}
            onThemeChange={setThemeFilter}
            onMinConfidenceChange={setMinConfidence}
          />
          <div className="flex flex-col gap-3">
            {items.map((item) => <InsightRow key={item.id} item={item} />)}
            {!items.length && <p className="text-sm text-muted">No insights match the current filters.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function InsightViewTabs({
  active,
  onChange
}: {
  active: "overview" | "selection" | "batches" | "results";
  onChange: (value: "overview" | "selection" | "batches" | "results") => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-line pb-2">
      {(["overview", "selection", "batches", "results"] as const).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`rounded border px-3 py-1.5 text-xs capitalize ${active === item ? "border-ink bg-ink text-surface" : "border-line text-muted hover:text-ink"}`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function InsightOverview({
  data,
  diagnostics,
  providerStatus
}: {
  data?: RunInsightsResponse;
  diagnostics?: AiInsightRunDiagnostics;
  providerStatus?: AiProviderStatus;
}) {
  const config = diagnostics?.configSnapshot ?? {};
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Raw" value={diagnostics?.totalRawCount ?? data?.summary.totalContents ?? 0} />
        <Metric label="Eligible" value={diagnostics?.eligibleCount ?? 0} />
        <Metric label="Selected" value={diagnostics?.selectedCandidateCount ?? 0} />
        <Metric label="Batches" value={diagnostics?.batchCount ?? 0} />
        <Metric label="Insights" value={diagnostics?.outputInsightCount ?? data?.summary.totalInsights ?? 0} />
      </div>
      <section className="rounded-lg border border-line bg-panel p-3">
        <h4 className="text-xs font-semibold uppercase text-muted">Run configuration</h4>
        <div className="mt-2 grid gap-2 text-xs text-muted md:grid-cols-3">
          <span>Model: {diagnostics?.modelName ?? providerStatus?.model ?? "AI"}</span>
          <span>Max candidates: {String(config.maxCandidates ?? "default")}</span>
          <span>Batch size: {String(config.maxItemsPerBatch ?? "default")}</span>
          <span>Concurrent batches: {String(config.maxConcurrentBatches ?? "default")}</span>
          <span>Token budget: {String(config.maxInputTokensPerBatch ?? "default")}</span>
          <span>Text chars: {String(config.textCharLimit ?? "default")}</span>
        </div>
        {diagnostics?.errorMessage && <p className="mt-3 text-sm text-red-600">{diagnostics.errorMessage}</p>}
      </section>
    </div>
  );
}

function CandidateList({ candidates }: { candidates: AiInsightCandidate[] }) {
  if (!candidates.length) return <p className="text-sm text-muted">No candidate diagnostics available.</p>;
  return (
    <div className="flex flex-col gap-2">
      {candidates.map((candidate) => (
        <article key={candidate.id} className="rounded-lg border border-line bg-panel p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className={candidate.selected ? "font-medium text-green-700" : "font-medium text-muted"}>
              {candidate.selected ? "Selected for AI" : `Excluded: ${candidate.excludedReason ?? "low_signal"}`}
            </span>
            <span>Score {candidate.selectionScore}</span>
            {candidate.batchIndex !== undefined && <span>Batch {candidate.batchIndex + 1}</span>}
            <span className="font-mono">{candidate.rawContentId}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm">{candidate.inputTextPreview}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {candidate.selectionReasons.map((reason) => (
              <span key={reason} className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{reason}</span>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function BatchList({ batches }: { batches: AiInsightBatch[] }) {
  if (!batches.length) return <p className="text-sm text-muted">No batch diagnostics available.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {batches.map((batch) => (
        <section key={batch.id} className="rounded-lg border border-line bg-panel p-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-medium">Batch {batch.batchIndex + 1}</h4>
            <span className="text-xs text-muted">{batch.status}</span>
          </div>
          <div className="mt-2 grid gap-1 text-xs text-muted">
            <span>Input records: {batch.candidateCount}</span>
            <span>Output insights: {batch.outputInsightCount}</span>
            <span>Raw IDs: {batch.rawContentIds.slice(0, 4).join(", ")}{batch.rawContentIds.length > 4 ? "..." : ""}</span>
          </div>
          {batch.errorMessage && <p className="mt-2 text-xs text-red-600">{batch.errorMessage}</p>}
        </section>
      ))}
    </div>
  );
}

function EmptyInsights(props: {
  providerStatus?: AiProviderStatus;
  canRunAnalysis: boolean;
  isAnalyzing: boolean;
  error?: string;
  onRunAnalysis: () => void;
}) {
  const configured = props.providerStatus?.configured;
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="text-sm font-medium text-muted">
        {configured ? "No AI insights generated yet." : "AI provider is not configured."}
      </p>
      {configured && props.canRunAnalysis && (
        <RunButton isAnalyzing={props.isAnalyzing} label="Run AI insights" onRunAnalysis={props.onRunAnalysis} />
      )}
      {!configured && <p className="max-w-xl text-xs text-muted">Set AI_PROVIDER, AI_MODEL, AI_API_KEY, and optional AI_BASE_URL in the API environment.</p>}
      {props.error && <p className="text-sm text-red-600">{props.error}</p>}
    </div>
  );
}

function Header(props: {
  providerStatus?: AiProviderStatus;
  canRunAnalysis: boolean;
  isAnalyzing: boolean;
  onRunAnalysis: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">AI Opportunity Workspace</h3>
        <p className="text-xs text-muted">{formatProvider(props.providerStatus)}</p>
      </div>
      {props.canRunAnalysis && (
        <RunButton isAnalyzing={props.isAnalyzing} label="Refresh AI insights" onRunAnalysis={props.onRunAnalysis} />
      )}
    </div>
  );
}

function InsightMetrics({ data, providerStatus }: { data: RunInsightsResponse; providerStatus?: AiProviderStatus }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Metric label="Samples" value={data.summary.totalContents} />
      <Metric label="Analyzed" value={data.summary.totalInsights} />
      <Metric label="Engagement" value={data.summary.totalEngagement} />
      <Metric label="Completeness" value={`${data.summary.dataCompleteness}%`} />
      <Metric label="Model" value={providerStatus?.model ?? "AI"} />
    </div>
  );
}

function ThemeBuckets({ data }: { data: RunInsightsResponse }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <ThemeList title="机会主题" themes={data.summary.themes} />
      <Bucket title="需求信号" items={data.summary.topDemandSignals} />
      <Bucket title="Subreddit" items={data.summary.topSubreddits} />
    </div>
  );
}

function InsightFilters(props: {
  themeFilter: string;
  minConfidence: number;
  themes: Array<{ themeName: string }>;
  onThemeChange: (value: string) => void;
  onMinConfidenceChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={props.themeFilter} onChange={(event) => props.onThemeChange(event.target.value)} className="rounded border border-line bg-panel px-3 py-2 text-sm">
        <option value="">All themes</option>
        {props.themes.map((theme) => <option key={theme.themeName} value={theme.themeName}>{theme.themeName}</option>)}
      </select>
      <input
        type="number"
        min={0}
        max={100}
        value={props.minConfidence}
        onChange={(event) => props.onMinConfidenceChange(Number(event.target.value) || 0)}
        className="w-36 rounded border border-line bg-panel px-3 py-2 text-sm"
        aria-label="Minimum confidence percentage"
      />
    </div>
  );
}

function InsightRow({ item }: { item: RunInsight }) {
  return (
    <article className="rounded-lg border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-medium text-ink">{item.needType}</span>
        <span>{Math.round(item.confidence * 100)}%</span>
        <span>{item.sentiment}</span>
        <span>Engagement {item.engagementScore}</span>
        {item.batchIndex !== undefined && <span>Batch {item.batchIndex + 1}</span>}
        {item.source?.authorName && <span>u/{item.source.authorName}</span>}
      </div>
      <p className="mt-2 text-sm font-medium">{item.problemStatement}</p>
      <p className="mt-1 text-sm text-muted">{item.recommendedAction}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.painPoints.slice(0, 8).map((point) => (
          <span key={point} className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{point}</span>
        ))}
        {item.selectionReasons?.map((reason) => (
          <span key={reason} className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">{reason}</span>
        ))}
      </div>
      {item.evidence.map((evidence) => (
        <blockquote key={`${evidence.source}-${evidence.quote}`} className="mt-3 border-l-2 border-line pl-3 text-xs leading-relaxed text-muted">
          {evidence.quote}
        </blockquote>
      ))}
      {item.source?.url && (
        <a className="mt-3 inline-flex items-center gap-1 text-xs underline" href={item.source.url} target="_blank" rel="noreferrer">
          View source <ExternalLink size={12} aria-hidden="true" />
        </a>
      )}
    </article>
  );
}

function RunButton({ isAnalyzing, label, onRunAnalysis }: { isAnalyzing: boolean; label: string; onRunAnalysis: () => void }) {
  return (
    <button type="button" disabled={isAnalyzing} onClick={onRunAnalysis} className="inline-flex items-center gap-2 rounded bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-ink/80 disabled:opacity-50">
      <RefreshCw className={isAnalyzing ? "size-4 animate-spin" : "size-4"} />
      {isAnalyzing ? "Analyzing..." : label}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <p className="truncate text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function ThemeList({ title, themes }: { title: string; themes: Array<{ themeName: string; whyItMatters: string }> }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-3">
      <h4 className="text-xs font-semibold uppercase text-muted">{title}</h4>
      <div className="mt-2 flex flex-col gap-2">
        {themes.slice(0, 4).map((theme) => (
          <div key={theme.themeName}>
            <p className="text-sm font-medium">{theme.themeName}</p>
            <p className="text-xs text-muted">{theme.whyItMatters}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Bucket({ title, items }: { title: string; items: Array<{ key: string; count: number }> }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-3">
      <h4 className="text-xs font-semibold uppercase text-muted">{title}</h4>
      <div className="mt-2 flex flex-col gap-1.5">
        {items.slice(0, 6).map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{item.key}</span>
            <span className="text-muted">{item.count}</span>
          </div>
        ))}
        {!items.length && <p className="text-sm text-muted">None</p>}
      </div>
    </section>
  );
}

function filterInsights(items: RunInsight[], themeFilter: string, minConfidence: number) {
  return items.filter((item) => {
    const confidence = Math.round(item.confidence * 100);
    const matchesTheme = !themeFilter || item.painPoints.includes(themeFilter) || item.needType === themeFilter;
    return matchesTheme && confidence >= minConfidence;
  });
}

function formatProvider(status?: AiProviderStatus) {
  if (!status?.configured) return "AI provider not configured";
  return [status.provider, status.model].filter(Boolean).join(" / ");
}

function canRunAnalysis(status: AnalysisRun["status"]) {
  return ["content_ready", "insight_ready", "report_ready", "analysis_failed"].includes(status);
}

// WHY: 刷新 AI insights 是付费/外部依赖动作，UI 和点击入口都必须复用同一前置条件，避免状态漂移时误触发后端配置错误。
function canRequestAiInsights(canRunAnalysis: boolean, providerStatus?: AiProviderStatus) {
  return canRunAnalysis && providerStatus?.configured === true;
}
