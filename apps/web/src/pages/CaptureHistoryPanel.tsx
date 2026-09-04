import type { CaptureTask, SourceCollectionBatch, SourceDatasetTaskView } from "@domain-analysis/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, RefreshCw } from "lucide-react";

import { fetchCrawlPlanning, fetchSourceCollectionRuns } from "../lib/api";

type HistoryTask = Pick<CaptureTask, "id" | "revision">;

export function CaptureHistoryPanel({ task, onOpenData }: {
  task: HistoryTask;
  onOpenData: () => void;
}) {
  const planning = useQuery({ queryKey: ["crawl-planning", task.id],
    queryFn: () => fetchCrawlPlanning(task.id) });
  const dataset = useQuery({ queryKey: ["source-runs", task.id],
    queryFn: () => fetchSourceCollectionRuns(task.id) });
  if (planning.isLoading || dataset.isLoading) return <div className="h-56 animate-pulse rounded-xl bg-line/30" />;
  if (!planning.data || !dataset.data || planning.isError || dataset.isError) {
    return <div className="rounded-xl border border-danger/30 bg-surface p-5 text-sm text-danger">
      <p>采集历史加载失败。</p>
      <button type="button" className="button-secondary mt-3" onClick={() => void Promise.all([
        planning.refetch(), dataset.refetch(),
      ])}><RefreshCw className="h-4 w-4" />重新读取</button>
    </div>;
  }
  const catalog = dataset.data.coverage?.productCatalog.status === "satisfied"
    ? dataset.data.coverage.productCatalog : undefined;
  return <div className="space-y-4">
    <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h3 className="text-base font-semibold">采集历史</h3>
          <p className="mt-1 text-sm leading-6 text-muted">每个采集方案都标出对应的抓取范围修订、执行批次和实际产量。</p></div>
        <button type="button" className="button-secondary" onClick={onOpenData}>查看当前可用资料
          <ArrowRight className="h-4 w-4" /></button>
      </div>
      <dl className="mt-5 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        <SummaryMetric label="抓取范围修订" value={task.revision} />
        <SummaryMetric label="采集方案" value={planning.data.plans.length} />
        <SummaryMetric label="执行批次" value={dataset.data.batches.length} />
        <SummaryMetric label="当前资料覆盖" value={catalog
          ? `${catalog.brandCount ?? 0} 品牌 / ${catalog.coveredModelCount ?? 0} 型号`
          : `${dataset.data.coverage?.acceptedSources.length ?? 0} 个公开来源`} />
      </dl>
    </section>
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="hidden grid-cols-[minmax(260px,1.5fr)_120px_120px_minmax(180px,1fr)] gap-4 bg-panel px-5 py-3 text-xs font-medium text-muted md:grid">
        <span>采集方案</span><span>方案状态</span><span>来源数</span><span>执行结果</span>
      </div>
      {planning.data.plans.map((plan) => <HistoryRow key={plan.id} plan={plan} view={dataset.data!} />)}
    </section>
  </div>;
}

function HistoryRow({ plan, view }: {
  plan: Awaited<ReturnType<typeof fetchCrawlPlanning>>["plans"][number];
  view: SourceDatasetTaskView;
}) {
  const batches = view.batches.filter((batch) => batch.sourceCollectionPlanId === plan.id
    && batch.sourceCollectionPlanVersion === plan.version);
  const snapshots = batches.reduce((sum, batch) => sum + batchRuns(view, batch)
    .reduce((count, run) => count + run.snapshotCount, 0), 0);
  const assets = batches.reduce((sum, batch) => sum + batchRuns(view, batch)
    .reduce((count, run) => count + run.assetCount, 0), 0);
  return <article className="border-t border-line px-5 py-4 first:border-t-0">
    <div className="grid gap-3 md:grid-cols-[minmax(260px,1.5fr)_120px_120px_minmax(180px,1fr)] md:items-start md:gap-4">
      <div><h4 className="font-semibold">采集方案 v{plan.version}</h4>
        <p className="mt-0.5 text-xs text-muted">对应抓取范围修订 v{plan.taskRevision} · {formatDate(plan.createdAt)}</p>
        <p className="mt-2 text-sm leading-6 text-ink">{plan.content.summary}</p></div>
      <HistoryStatus planStatus={plan.status} batches={batches} />
      <div><span className="text-xs text-muted md:hidden">计划来源：</span>
        <strong className="text-sm tabular-nums">{plan.content.sources.length}</strong></div>
      <div className="text-sm"><strong>{batches.length > 0 ? `${snapshots} 份快照` : "没有执行批次"}</strong>
        {batches.length > 0 && <p className="mt-1 text-xs text-muted">{assets} 个附件 · {batches.length} 个批次</p>}</div>
    </div>
    {batches.map((batch) => <BatchRow key={batch.id} batch={batch} view={view} />)}
  </article>;
}

function BatchRow({ batch, view }: { batch: SourceCollectionBatch; view: SourceDatasetTaskView }) {
  const runs = batchRuns(view, batch);
  const completed = runs.filter((run) => run.status === "completed").length;
  const snapshots = runs.reduce((sum, run) => sum + run.snapshotCount, 0);
  const assets = runs.reduce((sum, run) => sum + run.assetCount, 0);
  return <details className="mt-3 rounded-lg border border-line bg-panel px-3 py-2.5">
    <summary className="cursor-pointer text-sm font-medium">
      执行批次 {shortId(batch.id)} · {batchStatus(batch.status)} · {completed}/{batch.plannedSourceCount} 个来源完成
    </summary>
    <div className="mt-3 grid gap-3 border-t border-line pt-3 text-xs text-muted sm:grid-cols-4">
      <span>开始<br /><strong className="text-ink">{formatDate(batch.startedAt)}</strong></span>
      <span>结束<br /><strong className="text-ink">{batch.finishedAt ? formatDate(batch.finishedAt) : "执行中"}</strong></span>
      <span>原始快照<br /><strong className="text-ink">{snapshots}</strong></span>
      <span>附件<br /><strong className="text-ink">{assets}</strong></span>
    </div>
    <ul className="mt-3 divide-y divide-line border-t border-line text-xs">
      {runs.map((run) => <li key={run.id} className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_90px_120px]">
        <span className="truncate">{run.sourceCollectionPlanSourceKey ?? run.providerKey}</span>
        <span>{run.status === "completed" ? "完成" : run.status === "failed" ? "失败" : "已停止"}</span>
        <span>{run.snapshotCount} 快照 / {run.assetCount} 附件</span>
      </li>)}
    </ul>
  </details>;
}

function HistoryStatus({ planStatus, batches }: { planStatus: "draft" | "confirmed" | "superseded";
  batches: SourceCollectionBatch[] }) {
  const latest = batches[0];
  const label = latest ? batchStatus(latest.status)
    : planStatus === "draft" ? "方案待确认"
      : planStatus === "confirmed" ? "已确认，尚未执行" : "历史方案，未执行";
  return <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${latest?.status === "completed"
    ? "bg-success/10 text-success" : latest?.status === "partial" || latest?.status === "failed"
      ? "bg-warning/10 text-warning" : "bg-panel text-muted"}`}>{label}</span>;
}

function SummaryMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="bg-surface px-4 py-3"><dt className="text-xs text-muted">{label}</dt>
    <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>;
}

function batchRuns(view: SourceDatasetTaskView, batch: SourceCollectionBatch) {
  return view.runs.filter((run) => run.executionBatchId === batch.id);
}
function shortId(value: string) { return value.slice(-8); }
function formatDate(value: string) { return new Date(value).toLocaleString(); }
function batchStatus(value: SourceCollectionBatch["status"]) {
  return ({ running: "执行中", completed: "执行完成", partial: "部分完成", failed: "执行失败", stopped: "已停止" } as const)[value];
}
