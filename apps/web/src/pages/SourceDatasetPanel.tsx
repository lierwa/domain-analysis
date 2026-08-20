import { useQuery } from "@tanstack/react-query";
import type { SourceDatasetRunView } from "@domain-analysis/shared";
import { Download, FileText, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  fetchSourceCollectionRun,
  fetchSourceCollectionRuns,
  sourceAssetUrl,
  sourceRunExportUrl,
} from "../lib/api";

export function SourceDatasetPanel({ taskId }: { taskId: string }) {
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const runs = useQuery({
    queryKey: ["source-runs", taskId],
    queryFn: () => fetchSourceCollectionRuns(taskId),
  });
  useEffect(() => {
    if (!selectedRunId && runs.data?.[0]) setSelectedRunId(runs.data[0].id);
  }, [runs.data, selectedRunId]);
  const detail = useQuery({
    queryKey: ["source-run", taskId, selectedRunId],
    queryFn: () => fetchSourceCollectionRun(taskId, selectedRunId!),
    enabled: Boolean(selectedRunId),
  });

  if (runs.isError) return <ErrorPanel onRetry={() => runs.refetch()} />;
  if (!runs.isLoading && runs.data?.length === 0) {
    return <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center"><FileText className="mx-auto h-7 w-7 text-muted" /><p className="mt-3 text-sm font-medium">还没有原始数据</p><p className="mt-1 text-xs text-muted">确认完整 Crawl Plan 并点击“开始抓取”后，这里按来源和 target 展示源站原始内容。</p></div>;
  }
  return (
    <section className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="rounded-xl border border-line bg-panel p-3">
        <h3 className="px-2 py-2 text-sm font-semibold">抓取运行</h3>
        {runs.data?.map((run) => <button key={run.id} type="button" onClick={() => setSelectedRunId(run.id)} className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${selectedRunId === run.id ? "bg-ink text-surface" : "hover:bg-surface"}`}><span className="block font-medium">{run.providerKey}</span><span className="text-xs opacity-70">{run.snapshotCount} 条 · {renderRunStatus(run)}</span></button>)}
      </aside>
      <article className="min-w-0 rounded-xl border border-line bg-surface p-5">
        {detail.isLoading && <div className="h-40 animate-pulse rounded bg-line/30" />}
        {detail.isError && <ErrorPanel onRetry={() => detail.refetch()} />}
        {detail.data && <SourceRunDetail taskId={taskId} view={detail.data} />}
      </article>
    </section>
  );
}

export function SourceRunDetail({ taskId, view }: { taskId: string; view: SourceDatasetRunView }) {
  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold">原始来源数据</h3><p className="mt-1 text-xs text-muted">
        {view.records.length} 个不可变快照 · {renderRunStatus(view.run)} · 计划 v{view.run.sourceCollectionPlanVersion ?? "旧版"}
      </p></div>
      <div className="flex gap-2"><a className="button-secondary" href={sourceRunExportUrl(taskId, view.run.id, "jsonl")}><Download className="h-4 w-4" />JSONL</a><a className="button-secondary" href={sourceRunExportUrl(taskId, view.run.id, "csv")}><Download className="h-4 w-4" />CSV</a></div>
    </div>
    <section className="mb-5 rounded-lg border border-line bg-panel p-4">
      <h4 className="text-sm font-semibold">清单逐项对账</h4>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{view.targets.map((target) => <div key={target.id} className="rounded-md border border-line bg-surface px-3 py-2 text-xs">
        <div className="flex items-center justify-between gap-2"><span className="font-medium">{target.targetKey}</span><span>{renderRunStatus(target)}</span></div>
        <p className="mt-1 text-muted">{target.snapshotCount} 快照 · {target.accessibleCount} 可访问 · {target.assetCount} 附件</p>
      </div>)}</div>
    </section>
    <div className="space-y-4">{view.records.map((record) => <section key={record.snapshot.id} className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{record.object.sourceIdentity} · {record.object.externalKey}</span><span className="text-muted">{record.snapshot.targetKey ?? "旧版未归属"} · {record.snapshot.observation.state}</span></div>
      <a className="mt-2 block break-all text-xs underline" href={record.snapshot.observation.finalUrl ?? record.snapshot.observation.requestedUrl} target="_blank" rel="noreferrer">{record.snapshot.observation.finalUrl ?? record.snapshot.observation.requestedUrl}</a>
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-panel p-3 text-xs">{renderPayload(record.snapshot.payload)}</pre>
      {record.assets.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{record.assets.map((asset) => <a key={asset.id} className="button-secondary" href={sourceAssetUrl(taskId, view.run.id, asset.id)}><Download className="h-4 w-4" />{asset.filename} · {asset.bytes} B</a>)}</div>}
    </section>)}</div>
  </>;
}

function renderRunStatus(run: { status: string; terminationReason?: string }) {
  const blocked = new Set(["login_required", "verification_required", "access_denied"]);
  return run.terminationReason && blocked.has(run.terminationReason)
    ? `blocked · ${run.terminationReason}`
    : run.terminationReason ? `${run.status} · ${run.terminationReason}` : run.status;
}

function renderPayload(payload: unknown) {
  if (!payload) return "该访问没有返回内容。";
  if (typeof payload === "object" && payload && "kind" in payload && payload.kind === "inline_text" && "text" in payload) {
    const text = String(payload.text);
    return text.length > 10_000 ? `${text.slice(0, 10_000)}\n\n[页面预览已截断；完整原文请使用 JSONL/CSV 导出]` : text;
  }
  return JSON.stringify(payload, null, 2);
}
function ErrorPanel({ onRetry }: { onRetry: () => void }) { return <div className="rounded-lg border border-danger/30 p-4 text-sm text-danger">原始数据加载失败。<button type="button" className="button-secondary ml-3" onClick={onRetry}><RefreshCw className="h-4 w-4" />重试</button></div>; }
