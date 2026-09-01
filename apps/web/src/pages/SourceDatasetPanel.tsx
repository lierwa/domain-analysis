import type { CaptureTask, SourceCollectionRun, SourceDatasetRecordSummary,
  SourceDatasetTaskView } from "@domain-analysis/shared";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, ListTree, Map as MapIcon, RefreshCw, Search, Spline,
  Waypoints, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { fetchSourceCollectionRun, fetchSourceCollectionRuns } from "../lib/api";
import { SourceDatasetMapInspector } from "./SourceDatasetMapInspector";
import { SourceDatasetMapOutline } from "./SourceDatasetMapOutline";
import { SourceDatasetRecordInspector } from "./SourceDatasetRecordInspector";
import { SourceExecutionControls } from "./SourceExecutionControls";
import { SourceRunDetail, renderRunStatus } from "./SourceRunDetail";
import {
  buildSourceDataGraph,
  initialSourceDataMapExpansion,
  sourceDataMapExpansionPath,
  visibleSourceDataGraph,
  type SourceDataMapEntity,
  type SourceDataMapLineMode,
  type SourceDataMapMode,
} from "./sourceDatasetMapModel";

export { SourceRunDetail } from "./SourceRunDetail";
export { buildSourceDataGraph, initialSourceDataMapExpansion,
  visibleSourceDataGraph } from "./sourceDatasetMapModel";

type SelectedNode = { id: string; entity: SourceDataMapEntity };
type DatasetTask = Pick<CaptureTask, "id" | "revision" | "name" | "content">;
const SourceDatasetMapCanvas = lazy(() => import("./SourceDatasetMapCanvas")
  .then((module) => ({ default: module.SourceDatasetMapCanvas })));

export function SourceDatasetPanel({ task }: { task: DatasetTask }) {
  const runs = useQuery({ queryKey: ["source-runs", task.id],
    queryFn: () => fetchSourceCollectionRuns(task.id),
    refetchInterval: (result) => shouldPollSourceDataset(result.state.data) ? 2_000 : false });
  if (runs.isError) return <ErrorPanel onRetry={() => runs.refetch()} />;
  if (runs.isLoading) return <LoadingPanel />;
  return runs.data ? <LoadedSourceDatasetPanel task={task} view={runs.data} /> : null;
}

function LoadedSourceDatasetPanel({ task, view }: { task: DatasetTask; view: SourceDatasetTaskView }) {
  const state = useDatasetMapController(task, view);
  const inspectorOpen = Boolean(state.selected || state.selectedRecord || state.showRunDetail);
  useEffect(() => {
    if (!inspectorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [inspectorOpen]);
  if (state.graph.stats.sourceCount === 0 && view.batches.length === 0) {
    return <div className="flex h-full min-h-0 flex-col gap-3"><SourceExecutionControls task={task} view={view} />
      <CoverageSummary coverage={view.coverage} />
      <EmptyPanel /></div>;
  }
  return <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
    <SourceExecutionControls task={task} view={view} />
    <CoverageSummary coverage={view.coverage} />
    <DatasetHeader graph={state.graph} mode={state.mode} />
    <MapToolbar mode={state.mode} query={state.query} visibleNodeCount={state.visibleGraph.nodes.length}
      onMode={state.changeMode} onQuery={state.setQuery} />
    <div className="relative min-h-[24rem] flex-1 overflow-hidden bg-white lg:min-h-0">
      <MapSurfaceControls surface={state.surface} lineMode={state.lineMode}
        onSurface={state.setSurface} onLineMode={state.setLineMode} />
      {state.surface === "canvas" ? <Suspense fallback={<div className="h-full animate-pulse bg-panel" />}>
        <SourceDatasetMapCanvas taskId={task.id} graph={state.visibleGraph} selectedNodeId={state.selected?.id}
          activeRowId={state.activeRowId} lineMode={state.lineMode} expanded={state.expanded}
          onSelect={state.selectNode} onToggle={state.toggleNode} onSelectRecord={state.selectRecord} />
      </Suspense> : <SourceDatasetMapOutline taskId={task.id} graph={state.visibleGraph}
        selectedNodeId={state.selected?.id} activeRowId={state.activeRowId} expanded={state.expanded}
        onSelect={state.selectNode} onToggle={state.toggleNode} onSelectRecord={state.selectRecord} />}
      {inspectorOpen && <InspectorDrawer onClose={state.closeInspector}>
        <MapInspectorContent taskId={task.id} view={view} state={state} />
      </InspectorDrawer>}
    </div>
    <MapLegend mode={state.mode} recordCount={state.graph.stats.recordCount} />
  </section>;
}

function CoverageSummary({ coverage }: { coverage: SourceDatasetTaskView["coverage"] }) {
  if (!coverage) return null;
  const dimensions = [...coverage.families, ...coverage.facets];
  const satisfied = dimensions.filter((item) => item.status === "satisfied").length
    + (coverage.productCatalog.status === "satisfied" ? 1 : 0);
  const total = dimensions.length + 1;
  return <details className="border-b border-line bg-panel px-4 py-3 sm:px-5">
    <summary className="cursor-pointer text-sm font-medium">
      原始资料入口最低覆盖：{coverage.status === "satisfied" ? "已达到"
        : coverage.status === "in_progress" ? `执行尚未终态，已满足 ${satisfied}/${total} 项`
          : `已满足 ${satisfied}/${total} 项`}
    </summary>
    <ul className="mt-3 grid gap-2 text-xs leading-5 text-muted sm:grid-cols-2 lg:grid-cols-4">
      <li>
        <span className={coverage.productCatalog.status === "satisfied" ? "text-ink" : "text-danger"}>
          ZOL 商品目录
        </span>：{coverage.productCatalog.status === "satisfied"
          ? <>{coverage.productCatalog.brandCount ?? "?"} 个品牌，
            {coverage.productCatalog.coveredModelCount ?? "?"}/{coverage.productCatalog.modelCount ?? "?"} 个型号有完成记录</>
          : "尚未达到"}
      </li>
      {dimensions.map((item) => <li key={item.key}>
        <span className={item.status === "satisfied" ? "text-ink" : "text-danger"}>
          {coverageLabels[item.key] ?? item.key}
        </span>：{item.acceptedSourceCount}/{item.minimumAcceptedSources} 条，
        {item.distinctOriginCount}/{item.minimumDistinctOrigins} 个网站
      </li>)}
      {coverage.unfinishedExecutionIds.length > 0 && <li className="text-danger">
        执行终态：仍有 {coverage.unfinishedExecutionIds.length} 个执行项未结束
      </li>}
    </ul>
  </details>;
}

const coverageLabels: Record<string, string> = {
  standards_and_regulation: "标准与监管来源",
  professional_technical: "专业技术来源",
  brand_official: "品牌官方来源",
  operating_principle: "运行原理主题入口",
  core_components: "核心部件主题入口",
  safety_and_regulation: "安全与法规主题入口",
  performance_and_testing: "性能与测试主题入口",
  use_and_maintenance: "使用与维护主题入口",
};

function useDatasetMapController(task: DatasetTask, view: SourceDatasetTaskView) {
  const [mode, setMode] = useState<SourceDataMapMode>("product");
  const [lineMode, setLineMode] = useState<SourceDataMapLineMode>("polyline");
  const [surface, setSurface] = useState<"canvas" | "outline">("canvas");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SelectedNode>();
  const [selectedRecord, setSelectedRecord] = useState<SourceDatasetRecordSummary>();
  const [activeRowId, setActiveRowId] = useState<string>();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [showRunDetail, setShowRunDetail] = useState(false);
  const focusReturnRef = useRef<HTMLElement>();
  const graph = useMemo(() => buildSourceDataGraph(view, { id: task.id, name: task.name,
    category: task.content.category.label }, mode), [mode, task.content.category.label, task.id, task.name, view]);
  const initialExpanded = useMemo(() => initialSourceDataMapExpansion(graph), [graph]);
  const expansionKey = `${mode}:${graph.planVersion ?? 0}`;
  const [expansion, setExpansion] = useState<{ key: string; ids: Set<string> }>();
  const expanded = expansion?.key === expansionKey ? expansion.ids : initialExpanded;
  const visibleGraph = useMemo(() => visibleSourceDataGraph(graph, expanded, query), [expanded, graph, query]);
  const detail = useQuery({ queryKey: ["source-run", task.id, selectedRunId],
    queryFn: () => fetchSourceCollectionRun(task.id, selectedRunId!),
    enabled: showRunDetail && Boolean(selectedRunId),
    refetchInterval: showRunDetail && shouldPollSourceRun(view, selectedRunId) ? 2_000 : false });

  useEffect(() => {
    if (!selected && !selectedRecord && !showRunDetail) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") closeInspector(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  });

  function closeInspector() {
    const returnTarget = focusReturnRef.current;
    focusReturnRef.current = undefined;
    setSelected(undefined); setSelectedRecord(undefined); setSelectedRunId(undefined); setShowRunDetail(false);
    // WHY：抽屉内容可能在 Run 审计跳转时被替换；保存首次地图触发元素，避免键盘关闭后焦点丢到 body。
    if (returnTarget) requestAnimationFrame(() => {
      if (returnTarget.isConnected) returnTarget.focus();
    });
  }
  function changeMode(next: SourceDataMapMode) {
    setMode(next); setExpansion(undefined); setActiveRowId(undefined); closeInspector();
  }
  function selectNode(entity: SourceDataMapEntity, nodeId: string) {
    rememberFocus();
    setSelected({ id: nodeId, entity }); setSelectedRecord(undefined); setShowRunDetail(false); setSelectedRunId(undefined);
  }
  function toggleNode(nodeId: string) {
    setActiveRowId(nodeId);
    const ids = expanded.has(nodeId) ? collapseBranch(graph, expanded, nodeId)
      : sourceDataMapExpansionPath(graph, nodeId);
    setExpansion({ key: expansionKey, ids });
  }
  function selectRecord(record: SourceDatasetRecordSummary) {
    rememberFocus();
    setSelected(undefined); setSelectedRecord(record); setSelectedRunId(undefined); setShowRunDetail(false);
  }
  function selectRun(run: SourceCollectionRun) {
    rememberFocus();
    setSelected(undefined); setSelectedRecord(undefined); setSelectedRunId(run.id); setShowRunDetail(true);
  }
  function rememberFocus() {
    // TRADE-OFF：只记录第一层地图触发元素；抽屉内的跳转按钮会随内容替换卸载，不能作为返回目标。
    if (selected || selectedRecord || showRunDetail) return;
    if (document.activeElement instanceof HTMLElement) focusReturnRef.current = document.activeElement;
  }
  return { mode, lineMode, surface, query, expanded, selected, selectedRecord, activeRowId,
    selectedRunId, showRunDetail, graph, visibleGraph, detail, setLineMode, setSurface, setQuery,
    changeMode, selectNode, toggleNode, selectRecord, selectRun, closeInspector };
}

function collapseBranch(graph: ReturnType<typeof buildSourceDataGraph>, expanded: ReadonlySet<string>, nodeId: string) {
  const next = new Set(expanded);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!; next.delete(current);
    queue.push(...graph.edges.filter((edge) => edge.source === current).map((edge) => edge.target));
  }
  return next;
}

function MapInspectorContent({ taskId, view, state }: { taskId: string; view: SourceDatasetTaskView;
  state: ReturnType<typeof useDatasetMapController> }) {
  if (state.selectedRecord) return <SourceDatasetRecordInspector taskId={taskId}
    record={state.selectedRecord} view={view} onClose={state.closeInspector} />;
  if (state.showRunDetail) {
    if (state.detail.isLoading) return <InspectorLoading onClose={state.closeInspector} />;
    if (state.detail.isError) return <div className="p-5"><ErrorPanel onRetry={() => state.detail.refetch()} /></div>;
    if (!state.detail.data) return <InspectorEmpty onClose={state.closeInspector} />;
    return <SourceRunDetail taskId={taskId} view={state.detail.data} onClose={state.closeInspector} />;
  }
  return state.selected ? <SourceDatasetMapInspector entity={state.selected.entity}
    onClose={state.closeInspector} onSelectRun={state.selectRun} /> : null;
}

function DatasetHeader({ graph, mode }: { graph: ReturnType<typeof buildSourceDataGraph>; mode: SourceDataMapMode }) {
  return <header className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-5">
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Source Dataset</p>
        <h3 className="mt-0.5 text-base font-semibold tracking-tight">{mode === "product" ? "商品原始数据" : "运行审计地图"}</h3></div>
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <HeaderStat label={mode === "product" ? "品牌" : "来源"} value={graph.stats.sourceCount} />
        <HeaderStat label="快照" value={graph.stats.recordCount} />
        <HeaderStat label="唯一问题" value={graph.stats.attentionCount} attention={graph.stats.attentionCount > 0} />
      </dl>
    </div>
  </header>;
}

function HeaderStat({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return <div className="flex items-baseline gap-1.5"><dt className="text-[11px] text-muted">{label}</dt>
    <dd className={`text-sm font-semibold tabular-nums ${attention ? "text-danger" : "text-ink"}`}>{value}</dd></div>;
}

function MapToolbar({ mode, query, visibleNodeCount, onMode, onQuery }: { mode: SourceDataMapMode; query: string;
  visibleNodeCount: number; onMode: (mode: SourceDataMapMode) => void; onQuery: (query: string) => void }) {
  return <div className="shrink-0 flex items-center justify-between gap-3 border-b border-line bg-surface px-3 py-2">
    <div className="grid grid-cols-2 rounded-md bg-panel p-1" aria-label="数据地图视角">
      {(["product", "audit"] as const).map((value) => <button key={value} type="button"
        className={`min-h-9 rounded px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${mode === value ? "bg-surface text-ink" : "text-muted hover:text-ink"}`}
        aria-pressed={mode === value} onClick={() => onMode(value)}>{value === "product" ? "商品数据" : "运行审计"}</button>)}
    </div>
    <label className="source-map-search"><Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
      <input value={query} onChange={(event) => onQuery(event.target.value)}
        placeholder={mode === "product" ? "搜索品牌或型号" : "搜索来源、Batch 或 Run"} aria-label="搜索数据地图" />
      <span>{visibleNodeCount}</span></label>
  </div>;
}

function MapSurfaceControls({ surface, lineMode, onSurface, onLineMode }: { surface: "canvas" | "outline";
  lineMode: SourceDataMapLineMode; onSurface: (surface: "canvas" | "outline") => void;
  onLineMode: (mode: SourceDataMapLineMode) => void }) {
  return <nav className="source-map-surface-controls" aria-label="地图显示控制">
    <div role="group" aria-label="地图展示方式"><MapControlButton active={surface === "canvas"}
      onClick={() => onSurface("canvas")} icon={<MapIcon aria-hidden="true" />} label="画布" />
      <MapControlButton active={surface === "outline"} onClick={() => onSurface("outline")}
        icon={<ListTree aria-hidden="true" />} label="大纲" /></div>
    <div role="group" aria-label="连线方式"><MapControlButton active={lineMode === "polyline"}
      onClick={() => onLineMode("polyline")} icon={<Waypoints aria-hidden="true" />} label="转折线" />
      <MapControlButton active={lineMode === "curve"} onClick={() => onLineMode("curve")}
        icon={<Spline aria-hidden="true" />} label="曲线" /></div>
  </nav>;
}

function MapControlButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void;
  icon: ReactNode; label: string }) {
  return <button type="button" className={active ? "is-active" : undefined}
    aria-pressed={active} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function InspectorDrawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return <><button type="button" className="fixed inset-0 z-40 bg-ink/35 md:absolute" onClick={onClose}
    aria-label="关闭详情遮罩" /><aside role="dialog" aria-modal="true" aria-label="数据节点详情"
    className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-surface shadow-2xl md:absolute md:inset-y-0 md:left-auto md:right-0 md:w-[30rem] md:border-l md:border-line">{children}</aside></>;
}

function InspectorLoading({ onClose }: { onClose: () => void }) {
  return <div className="p-5"><button type="button" className="icon-button ml-auto" onClick={onClose}
    aria-label="关闭详情"><X className="h-5 w-5" /></button><div className="mt-4 h-56 animate-pulse rounded-lg bg-line/30" /></div>;
}
function InspectorEmpty({ onClose }: { onClose: () => void }) {
  return <div className="p-5"><button type="button" className="icon-button ml-auto" onClick={onClose}
    aria-label="关闭详情"><X className="h-5 w-5" /></button><p className="mt-5 text-sm text-muted">这个运行没有审计记录。</p></div>;
}
function MapLegend({ mode, recordCount }: { mode: SourceDataMapMode; recordCount: number }) {
  return <div className="hidden shrink-0 flex-wrap items-center gap-x-5 border-t border-line bg-surface px-4 py-2 text-[11px] text-muted sm:flex">
    <span>{mode === "product" ? "一次只展开当前品牌与型号分支" : "点击 Run 查看请求与恢复审计"}</span>
    <span className="ml-auto tabular-nums">最新 Batch 原始快照 {recordCount}</span>
  </div>;
}

export function shouldPollSourceDataset(view?: SourceDatasetTaskView) {
  const execution = view?.currentExecution;
  return execution?.status === "running" || execution?.recoveryState === "pending"
    || execution?.recoveryState === "running";
}
export function shouldPollSourceRun(view?: SourceDatasetTaskView, runId?: string) {
  if (!view || !runId || !shouldPollSourceDataset(view)) return false;
  return view.runs.some((run) => run.id === runId && run.status === "running");
}
export function latestRunForPlan(view: SourceDatasetTaskView, planId: string,
  planVersion: number, sourceKey: string) {
  const execution = view.executions.find((item) => item.sourceCollectionPlanId === planId
    && item.sourceCollectionPlanVersion === planVersion);
  if (execution) return execution.latestRuns.find((run) => run.sourceCollectionPlanSourceKey === sourceKey);
  const batch = view.batches.find((item) => item.sourceCollectionPlanId === planId
    && item.sourceCollectionPlanVersion === planVersion);
  return batch ? view.runs.find((run) => run.executionBatchId === batch.id
    && run.sourceCollectionPlanSourceKey === sourceKey) : undefined;
}
export function formatRunElapsed(startedAt: string, now = Date.now()) {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return "—";
  const totalSeconds = Math.max(0, Math.floor((now - started) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours} 小时 ${String(minutes).padStart(2, "0")} 分`
    : `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
}
export function groupSourceRunsByBatch(view: SourceDatasetTaskView) {
  return view.batches.map((batch) => ({ key: batch.id, label: `批次 ${batch.id}`,
    planVersion: batch.sourceCollectionPlanVersion, status: renderRunStatus(batch), startedAt: batch.startedAt,
    runs: view.runs.filter((run) => run.executionBatchId === batch.id) }));
}

function EmptyPanel() {
  return <div className="flex h-full min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface p-10 text-center">
    <FileText className="mx-auto h-7 w-7 text-muted" aria-hidden="true" /><p className="mt-3 text-sm font-medium">还没有原始数据</p>
    <p className="mt-1 text-xs text-muted">确认并执行来源计划后，这里会展示商品原始数据与运行审计。</p></div>;
}
function LoadingPanel() { return <div className="h-full min-h-72 animate-pulse rounded-xl border border-line bg-panel" />; }
function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return <div className="rounded-lg border border-danger/30 p-4 text-sm text-danger"><span className="inline-flex items-center gap-2">
    <AlertTriangle className="h-4 w-4" aria-hidden="true" />原始数据加载失败。</span>
    <button type="button" className="button-secondary ml-3" onClick={onRetry}><RefreshCw className="h-4 w-4" />重试</button></div>;
}
