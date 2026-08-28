import type {
  CaptureTask,
  SourceCollectionRun,
  SourceDatasetRecordSummary,
  SourceDatasetTaskView,
} from "@domain-analysis/shared";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, ListTree, Map as MapIcon, RefreshCw, Search, Spline, Waypoints, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  fetchSourceCollectionRun,
  fetchSourceCollectionRuns,
} from "../lib/api";
import { formatDateTime } from "../lib/format";
import { SourceDatasetMapInspector } from "./SourceDatasetMapInspector";
import { SourceDatasetMapOutline } from "./SourceDatasetMapOutline";
import {
  buildSourceDataGraph,
  initialSourceDataMapExpansion,
  visibleSourceDataGraph,
  type SourceDataMapEntity,
  type SourceDataMapLineMode,
  type SourceDataMapMode,
} from "./sourceDatasetMapModel";
import { SourceRunDetail, renderRunStatus } from "./SourceRunDetail";

export { SourceRunDetail } from "./SourceRunDetail";
export { buildSourceDataGraph, initialSourceDataMapExpansion,
  visibleSourceDataGraph } from "./sourceDatasetMapModel";

type SelectedNode = { id: string; entity: SourceDataMapEntity };
type DatasetTask = Pick<CaptureTask, "id" | "revision" | "name" | "content">;
const SourceDatasetMapCanvas = lazy(() => import("./SourceDatasetMapCanvas")
  .then((module) => ({ default: module.SourceDatasetMapCanvas })));

export function SourceDatasetPanel({ task }: { task: DatasetTask }) {
  const runs = useQuery({
    queryKey: ["source-runs", task.id],
    queryFn: () => fetchSourceCollectionRuns(task.id),
    refetchInterval: (result) => shouldPollSourceDataset(result.state.data) ? 2_000 : false,
  });
  if (runs.isError) return <ErrorPanel onRetry={() => runs.refetch()} />;
  if (runs.isLoading) return <LoadingPanel />;
  return runs.data ? <LoadedSourceDatasetPanel task={task} view={runs.data} /> : null;
}

function LoadedSourceDatasetPanel({ task, view }: { task: DatasetTask; view: SourceDatasetTaskView }) {
  const state = useDatasetMapController(task, view);
  const inspectorOpen = Boolean(state.selected) || state.showRunDetail;
  useEffect(() => {
    if (!inspectorOpen) return;
    // WHY：手机详情占满视窗时锁住背景，避免关闭抽屉后画布和页面位置同时漂移。
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [inspectorOpen]);
  if (state.graph.stats.sourceCount === 0 && view.batches.length === 0 && view.runs.length === 0) return <EmptyPanel />;
  return <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
    <DatasetHeader graph={state.graph} />
    <MapToolbar mode={state.mode} query={state.query} visibleNodeCount={state.visibleGraph.nodes.length}
      onMode={state.changeMode} onQuery={state.setQuery} />
    <div className="relative min-h-[24rem] flex-1 overflow-hidden bg-white lg:min-h-0">
      <MapSurfaceControls surface={state.surface} lineMode={state.lineMode}
        onSurface={state.setSurface} onLineMode={state.setLineMode} />
      {state.surface === "canvas" ? <Suspense fallback={<div className="h-full animate-pulse bg-panel" />}>
        <SourceDatasetMapCanvas taskId={task.id} graph={state.visibleGraph} selectedNodeId={state.selected?.id}
          activeRowId={state.activeRowId}
          lineMode={state.lineMode} expanded={state.expanded} onSelect={state.selectNode} onToggle={state.toggleNode}
          onSelectRecord={state.selectRecord} />
      </Suspense>
        : <SourceDatasetMapOutline taskId={task.id} graph={state.visibleGraph} selectedNodeId={state.selected?.id}
          activeRowId={state.activeRowId} expanded={state.expanded} onSelect={state.selectNode} onToggle={state.toggleNode}
          onSelectRecord={state.selectRecord} />}
      {state.visibleGraph.nodes.length === 1 && state.graph.stats.sourceCount === 0 && <div className="pointer-events-none absolute inset-x-4 top-5 mx-auto max-w-md rounded-lg border border-line bg-surface/95 p-4 text-center text-sm text-muted shadow-sm">当前确认计划没有可展示的来源。</div>}
      {inspectorOpen && <InspectorDrawer onClose={state.closeInspector}>
        <MapInspectorContent taskId={task.id} state={state} />
      </InspectorDrawer>}
    </div>
    <MapLegend lineageCount={state.graph.stats.lineageCount} recordCount={state.graph.stats.recordCount} />
    <BatchHistory view={view} selectedRunId={state.selectedRunId} onSelectRun={state.selectRun} />
  </section>;
}

function useDatasetMapController(task: DatasetTask, view: SourceDatasetTaskView) {
  const [mode, setMode] = useState<SourceDataMapMode>("source");
  const [lineMode, setLineMode] = useState<SourceDataMapLineMode>("polyline");
  const [surface, setSurface] = useState<"canvas" | "outline">("canvas");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SelectedNode>();
  const [activeRowId, setActiveRowId] = useState<string>();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>();
  const [showRunDetail, setShowRunDetail] = useState(false);
  const graph = useMemo(() => buildSourceDataGraph(view, {
    id: task.id, name: task.name, category: task.content.category.label,
  }, mode), [mode, task.content.category.label, task.id, task.name, view]);
  const initialExpanded = useMemo(() => initialSourceDataMapExpansion(graph), [graph]);
  const expansionKey = `${mode}:${graph.planId ?? "none"}:${graph.planVersion ?? 0}:${[...initialExpanded].join("|")}`;
  const [expansion, setExpansion] = useState<{ key: string; ids: Set<string> }>();
  const expanded = expansion?.key === expansionKey ? expansion.ids : initialExpanded;
  const visibleGraph = useMemo(() => visibleSourceDataGraph(graph, expanded, query), [expanded, graph, query]);
  const detail = useQuery({
    queryKey: ["source-run", task.id, selectedRunId],
    queryFn: () => fetchSourceCollectionRun(task.id, selectedRunId!),
    enabled: showRunDetail && Boolean(selectedRunId),
    refetchInterval: showRunDetail && shouldPollSourceRun(view, selectedRunId) ? 2_000 : false,
  });

  useEffect(() => {
    if (!selected && !showRunDetail) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelected(undefined); setSelectedRunId(undefined); setSelectedSnapshotId(undefined); setShowRunDetail(false);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected, showRunDetail]);

  function changeMode(next: SourceDataMapMode) {
    setMode(next);
    setExpansion(undefined);
    setSelected(undefined);
    setActiveRowId(undefined);
    setShowRunDetail(false);
  }

  function selectNode(entity: SourceDataMapEntity, nodeId: string) {
    setSelected({ id: nodeId, entity });
    setShowRunDetail(false);
    setSelectedRunId(undefined);
    setSelectedSnapshotId(undefined);
  }

  function toggleNode(nodeId: string) {
    setActiveRowId(nodeId);
    setExpansion({ key: expansionKey, ids: toggleSetValue(expanded, nodeId) });
  }

  function selectRecord(record: SourceDatasetRecordSummary) {
    setSelectedRunId(record.runId);
    setSelectedSnapshotId(record.snapshotId);
    setShowRunDetail(true);
  }

  function selectRun(run: SourceCollectionRun) {
    setSelectedRunId(run.id);
    setSelectedSnapshotId(undefined);
    setShowRunDetail(true);
  }

  function closeInspector() {
    setSelected(undefined);
    setSelectedRunId(undefined);
    setSelectedSnapshotId(undefined);
    setShowRunDetail(false);
  }
  return { mode, lineMode, surface, query, expanded, selected, activeRowId, selectedRunId, selectedSnapshotId, showRunDetail,
    graph, visibleGraph, detail, setLineMode, setSurface, setQuery, changeMode, selectNode, toggleNode,
    selectRecord, selectRun, closeInspector };
}

function MapInspectorContent({ taskId, state }: {
  taskId: string;
  state: ReturnType<typeof useDatasetMapController>;
}) {
  if (state.showRunDetail) {
    if (state.detail.isLoading) return <InspectorLoading onClose={state.closeInspector} />;
    if (state.detail.isError) return <div className="p-5"><ErrorPanel onRetry={() => state.detail.refetch()} /></div>;
    if (!state.detail.data) return <InspectorEmpty onClose={state.closeInspector} />;
    return <SourceRunDetail taskId={taskId} view={state.detail.data} selectedSnapshotId={state.selectedSnapshotId}
      onClose={state.closeInspector} />;
  }
  return state.selected ? <SourceDatasetMapInspector entity={state.selected.entity}
    onClose={state.closeInspector} onSelectRun={state.selectRun} /> : null;
}

function DatasetHeader({ graph }: { graph: ReturnType<typeof buildSourceDataGraph> }) {
  const stats = graph.stats;
  return <header className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-5">
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Source Dataset</p>
        <h3 className="mt-0.5 text-base font-semibold tracking-tight">原始数据地图</h3>
      </div>
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <HeaderStat label="计划" value={graph.planVersion ? `v${graph.planVersion}` : "—"} />
        <HeaderStat label="来源" value={stats.sourceCount} />
        <HeaderStat label="快照" value={stats.recordCount} />
        <HeaderStat label="需关注" value={stats.attentionCount} attention={stats.attentionCount > 0} />
      </dl>
    </div>
  </header>;
}

function HeaderStat({ label, value, attention = false }: { label: string; value: string | number; attention?: boolean }) {
  return <div className="flex items-baseline gap-1.5"><dt className="text-[11px] text-muted">{label}</dt>
    <dd className={`text-sm font-semibold tabular-nums ${attention ? "text-danger" : "text-ink"}`}>{value}</dd></div>;
}

function MapToolbar({ mode, query, visibleNodeCount, onMode, onQuery }: {
  mode: SourceDataMapMode;
  query: string;
  visibleNodeCount: number;
  onMode: (mode: SourceDataMapMode) => void;
  onQuery: (query: string) => void;
}) {
  return <div className="shrink-0 flex items-center justify-between gap-3 border-b border-line bg-surface px-3 py-2">
    <div className="grid grid-cols-3 rounded-md bg-panel p-1" aria-label="数据地图视角">
      {(["source", "brand", "content"] as const).map((value) => <button key={value} type="button"
        className={`min-h-9 rounded px-3 text-sm font-medium focus-visible:outline-none focus-visible:bg-surface ${mode === value ? "bg-surface text-ink" : "text-muted hover:text-ink"}`}
        aria-pressed={mode === value} onClick={() => onMode(value)}>{modeLabel(value)}</button>)}
    </div>
    <label className="source-map-search">
      <Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
      <input value={query} onChange={(event) => onQuery(event.target.value)}
        placeholder="搜索品牌、来源、主题或资源类型" aria-label="搜索数据地图" />
      <span>{visibleNodeCount}</span>
    </label>
  </div>;
}

function MapSurfaceControls({ surface, lineMode, onSurface, onLineMode }: {
  surface: "canvas" | "outline";
  lineMode: SourceDataMapLineMode;
  onSurface: (surface: "canvas" | "outline") => void;
  onLineMode: (mode: SourceDataMapLineMode) => void;
}) {
  return <nav className="source-map-surface-controls" aria-label="地图显示控制">
    <div role="group" aria-label="地图展示方式">
      <MapControlButton active={surface === "canvas"} onClick={() => onSurface("canvas")}
        icon={<MapIcon aria-hidden="true" />} label="画布" />
      <MapControlButton active={surface === "outline"} onClick={() => onSurface("outline")}
        icon={<ListTree aria-hidden="true" />} label="大纲" />
    </div>
    <div role="group" aria-label="连线与布局方式">
      <MapControlButton active={lineMode === "polyline"} onClick={() => onLineMode("polyline")}
        icon={<Waypoints aria-hidden="true" />} label="转折线" />
      <MapControlButton active={lineMode === "curve"} onClick={() => onLineMode("curve")}
        icon={<Spline aria-hidden="true" />} label="曲线" />
    </div>
  </nav>;
}

function MapControlButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: ReactNode; label: string;
}) {
  return <button type="button" className={active ? "is-active" : undefined}
    aria-pressed={active} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function InspectorDrawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return <>
    <button type="button" className="fixed inset-0 z-40 bg-ink/35 md:absolute" onClick={onClose} aria-label="关闭详情遮罩" />
    <aside role="dialog" aria-modal="true" aria-label="数据节点详情"
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-surface shadow-2xl md:absolute md:inset-y-0 md:left-auto md:right-0 md:w-[30rem] md:border-l md:border-line">
      {children}
    </aside>
  </>;
}

function InspectorLoading({ onClose }: { onClose: () => void }) {
  return <div className="p-5"><button type="button" className="icon-button ml-auto" onClick={onClose} aria-label="关闭详情"><X className="h-5 w-5" /></button><div className="mt-4 h-56 animate-pulse rounded-lg bg-line/30" /></div>;
}

function InspectorEmpty({ onClose }: { onClose: () => void }) {
  return <div className="p-5"><button type="button" className="icon-button ml-auto" onClick={onClose} aria-label="关闭详情"><X className="h-5 w-5" /></button><p className="mt-5 text-sm text-muted">这个运行没有可查看的快照。</p></div>;
}

function MapLegend({ lineageCount, recordCount }: { lineageCount: number; recordCount: number }) {
  return <div className="hidden shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-surface px-4 py-2 text-[11px] text-muted sm:flex">
    <span>选择节点查看详情</span>
    <span>展开记录组后按页读取单条快照</span>
    {recordCount > 0 && <span className="ml-auto tabular-nums">已保存血缘 {lineageCount} / {recordCount}</span>}
  </div>;
}

function BatchHistory({ view, selectedRunId, onSelectRun }: {
  view: SourceDatasetTaskView;
  selectedRunId?: string;
  onSelectRun: (run: SourceCollectionRun) => void;
}) {
  const groups = groupSourceRunsByBatch(view);
  return <details className="max-h-[min(42dvh,28rem)] shrink-0 overflow-y-auto border-t border-line bg-panel px-4 py-3 sm:px-5">
    <summary className="min-h-6 cursor-pointer text-sm font-semibold">运行审计 · {view.batches.length} 批 / {view.runs.length} Run</summary>
    <div className="mt-3 grid gap-4 lg:grid-cols-2">{groups.map((group) => <section key={group.key} className="border-t border-line pt-3">
      <div className="flex items-start justify-between gap-3 text-xs"><span className="font-semibold">{group.label}</span>
        <span className="text-muted">{group.planVersion ? `计划 v${group.planVersion} · ` : ""}{group.status}</span></div>
      <p className="mt-1 text-[11px] text-muted">{group.startedAt ? formatDateTime(group.startedAt) : "时间未记录"} · {group.runs.length} 个历史 Run{group.latestCount !== undefined ? ` · 最新 ${group.latestCount}/${group.plannedCount} 个来源有终态` : ""}</p>
      {group.failureSummary && <p className="mt-1 text-[11px] text-danger">{group.failureSummary}</p>}
      <div className="mt-2 flex flex-wrap gap-2">{group.runs.map((run) => <button key={run.id} type="button"
        className={`min-h-11 rounded-md border px-2.5 py-2 text-left text-xs ${selectedRunId === run.id ? "border-ink bg-ink text-surface" : "border-line bg-surface hover:bg-line/40"}`}
        onClick={() => onSelectRun(run)}>{run.sourceCollectionPlanSourceKey ?? "未关联来源"} · {run.snapshotCount} 条 · {renderRunStatus(run)}</button>)}</div>
      {group.runs.length === 0 && <p className="mt-2 text-xs text-muted">这个批次没有创建来源运行。</p>}
    </section>)}</div>
  </details>;
}

export function shouldPollSourceDataset(view?: SourceDatasetTaskView) {
  // WHY：恢复期间历史 Batch 已是 stopped；轮询必须读取同一 execution/recovery 投影，不能退回 UI 猜测。
  const latestExecution = view?.executions?.[0];
  const latestBatch = view?.batches[0];
  return latestExecution?.status === "running"
    || latestBatch?.recoveryState === "pending" || latestBatch?.recoveryState === "running"
    || (!latestExecution && latestBatch?.status === "running");
}

export function shouldPollSourceRun(view?: SourceDatasetTaskView, runId?: string) {
  if (!view || !runId) return false;
  const activeExecution = view.executions?.[0];
  if (activeExecution) {
    return activeExecution.status === "running"
      && activeExecution.latestRuns.some((run) => run.id === runId && run.status === "running");
  }
  const activeBatch = view.batches[0];
  return activeBatch?.status === "running" && view.runs.some((run) => run.id === runId
    && run.executionBatchId === activeBatch.id && run.status === "running");
}

export function groupSourceRunsByBatch(view: SourceDatasetTaskView) {
  const runsByBatch = new Map<string, SourceCollectionRun[]>();
  const unbatchedRuns: SourceCollectionRun[] = [];
  for (const run of view.runs) {
    if (!run.executionBatchId) unbatchedRuns.push(run);
    else runsByBatch.set(run.executionBatchId, [...(runsByBatch.get(run.executionBatchId) ?? []), run]);
  }
  const executions = new Map((view.executions ?? []).map((execution) => [execution.batchId, execution]));
  const groups: Array<{ key: string; label: string; planVersion?: number; status: string;
    startedAt?: string; runs: SourceCollectionRun[]; latestCount?: number; plannedCount?: number;
    failureSummary?: string }> = view.batches.map((batch) => {
    const execution = executions.get(batch.id);
    return {
    key: batch.id,
    label: `批次 ${batch.id}`,
    planVersion: batch.sourceCollectionPlanVersion,
    status: execution ? execution.status : renderRunStatus(batch),
    startedAt: batch.startedAt,
    runs: runsByBatch.get(batch.id) ?? [],
    latestCount: execution ? execution.counts.completed + execution.counts.failed
      + execution.counts.stopped : undefined,
    plannedCount: execution?.plannedSourceCount,
    failureSummary: executionFailureSummary(execution?.failureCounts),
  }; });
  if (unbatchedRuns.length > 0) groups.push({ key: "unbatched", label: "未关联批次的记录",
    status: "仅用于审计", runs: unbatchedRuns });
  return groups;
}

function executionFailureSummary(counts?: Record<string, number>) {
  if (!counts) return undefined;
  const labels: Record<string, string> = {
    system_configuration: "系统配置",
    transient_transport: "瞬时网络重试耗尽",
    source_restricted: "来源受限",
    plan_revision_required: "计划需修订",
    content_not_accepted: "内容未达标",
    contract_fault: "代码或契约故障",
    execution_process_lost: "执行进程失联",
  };
  const parts = Object.entries(counts).filter(([, count]) => count > 0)
    .map(([category, count]) => `${labels[category] ?? category} ${count}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function toggleSetValue(current: ReadonlySet<string>, value: string) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function modeLabel(mode: SourceDataMapMode) {
  if (mode === "brand") return "按品牌";
  if (mode === "content") return "按内容";
  return "按来源";
}

function EmptyPanel() {
  return <div className="flex h-full min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface p-10 text-center">
    <FileText className="mx-auto h-7 w-7 text-muted" aria-hidden="true" /><p className="mt-3 text-sm font-medium">还没有原始数据地图</p>
    <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted">确认来源计划后，这里会先展示计划节点；执行后再沿发现路径展示原始快照。</p>
  </div>;
}

function LoadingPanel() {
  return <div className="flex h-full min-h-72 flex-col overflow-hidden rounded-xl border border-line bg-surface"><div className="h-16 shrink-0 animate-pulse bg-line/30" /><div className="min-h-0 flex-1 animate-pulse bg-panel" /></div>;
}

function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return <div className="rounded-lg border border-danger/30 p-4 text-sm text-danger">
    <span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden="true" />原始数据加载失败。</span>
    <button type="button" className="button-secondary ml-3" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden="true" />重试</button>
  </div>;
}
