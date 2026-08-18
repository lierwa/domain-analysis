import { useQuery } from "@tanstack/react-query";
import { Download, FileText, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  fetchSourceCollectionRun,
  fetchSourceCollectionRuns,
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
    return <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center"><FileText className="mx-auto h-7 w-7 text-muted" /><p className="mt-3 text-sm font-medium">还没有原始数据</p><p className="mt-1 text-xs text-muted">当前验收只到抓取任务；后续确认抓取执行方案后，这里展示和导出源站原始内容。</p></div>;
  }
  return (
    <section className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="rounded-xl border border-line bg-panel p-3">
        <h3 className="px-2 py-2 text-sm font-semibold">抓取运行</h3>
        {runs.data?.map((run) => <button key={run.id} type="button" onClick={() => setSelectedRunId(run.id)} className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${selectedRunId === run.id ? "bg-ink text-surface" : "hover:bg-surface"}`}><span className="block font-medium">{run.providerKey}</span><span className="text-xs opacity-70">{run.snapshotCount} 条 · {run.status}</span></button>)}
      </aside>
      <article className="min-w-0 rounded-xl border border-line bg-surface p-5">
        {detail.isLoading && <div className="h-40 animate-pulse rounded bg-line/30" />}
        {detail.isError && <ErrorPanel onRetry={() => detail.refetch()} />}
        {detail.data && <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">原始来源数据</h3><p className="mt-1 text-xs text-muted">{detail.data.records.length} 个不可变快照</p></div><div className="flex gap-2"><a className="button-secondary" href={sourceRunExportUrl(taskId, detail.data.run.id, "jsonl")}><Download className="h-4 w-4" />JSONL</a><a className="button-secondary" href={sourceRunExportUrl(taskId, detail.data.run.id, "csv")}><Download className="h-4 w-4" />CSV</a></div></div>
          <div className="space-y-4">{detail.data.records.map((record) => <section key={record.snapshot.id} className="rounded-lg border border-line p-4"><div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{record.object.sourceIdentity} · {record.object.externalKey}</span><span className="text-muted">{record.snapshot.observation.state}</span></div><a className="mt-2 block break-all text-xs underline" href={record.snapshot.observation.finalUrl ?? record.snapshot.observation.requestedUrl} target="_blank" rel="noreferrer">{record.snapshot.observation.finalUrl ?? record.snapshot.observation.requestedUrl}</a><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-panel p-3 text-xs">{renderPayload(record.snapshot.payload)}</pre></section>)}</div>
        </>}
      </article>
    </section>
  );
}

function renderPayload(payload: unknown) {
  if (!payload) return "该访问没有返回内容。";
  if (typeof payload === "object" && payload && "kind" in payload && payload.kind === "inline_text" && "text" in payload) return String(payload.text);
  return JSON.stringify(payload, null, 2);
}
function ErrorPanel({ onRetry }: { onRetry: () => void }) { return <div className="rounded-lg border border-danger/30 p-4 text-sm text-danger">原始数据加载失败。<button type="button" className="button-secondary ml-3" onClick={onRetry}><RefreshCw className="h-4 w-4" />重试</button></div>; }
