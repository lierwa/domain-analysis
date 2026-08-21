import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CaptureTask, SourceCollectionRun, SourceDatasetRunView, SourceDatasetTaskView } from "@domain-analysis/shared";
import { Download, FileText, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  fetchSourceCollectionRun,
  fetchSourceCollectionRuns,
  resumeSourceRun,
  sourceAssetUrl,
  sourceRunExportUrl,
} from "../lib/api";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { formatDateTime } from "../lib/format";

export function SourceDatasetPanel({ task }: { task: Pick<CaptureTask, "id" | "revision"> }) {
  const taskId = task.id;
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [resumingRunId, setResumingRunId] = useState<string>();
  const [resumeError, setResumeError] = useState<string>();
  const [resumeAccepted, setResumeAccepted] = useState<string>();
  const runs = useQuery({
    queryKey: ["source-runs", taskId],
    queryFn: () => fetchSourceCollectionRuns(taskId),
    refetchInterval: (query) => shouldPollSourceDataset(query.state.data) ? 2_000 : false,
  });
  const newestRunId = runs.data?.runs[0]?.id;
  useEffect(() => {
    if (newestRunId) setSelectedRunId(newestRunId);
  }, [newestRunId]);
  const detail = useQuery({
    queryKey: ["source-run", taskId, selectedRunId],
    queryFn: () => fetchSourceCollectionRun(taskId, selectedRunId!),
    enabled: Boolean(selectedRunId),
    refetchInterval: (query) => query.state.data?.run.status === "running" ? 2_000 : false,
  });

  async function resume(view: SourceDatasetRunView) {
    const version = view.run.sourceCollectionPlanVersion;
    if (!version) return;
    setResumeError(undefined);
    setResumingRunId(view.run.id);
    try {
      const accepted = await resumeSourceRun(taskId, view.run.id, {
        expectedTaskRevision: task.revision, expectedPlanVersion: version,
      });
      setResumeAccepted(`继续任务已交给后台（${accepted.commandId}），离开页面不会中止。`);
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["source-runs", taskId] }), 500);
    } catch (error) {
      setResumeError(error instanceof Error ? error.message : "来源继续失败");
    } finally {
      setResumingRunId(undefined);
      await queryClient.invalidateQueries({ queryKey: ["source-runs", taskId] });
    }
  }

  if (runs.isError) return <ErrorPanel onRetry={() => runs.refetch()} />;
  if (!runs.isLoading && runs.data && runs.data.batches.length === 0 && runs.data.runs.length === 0) {
    return <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center"><FileText className="mx-auto h-7 w-7 text-muted" /><p className="mt-3 text-sm font-medium">还没有原始数据</p><p className="mt-1 text-xs text-muted">确认完整 Crawl Plan 并点击“开始抓取”后，这里按来源和 target 展示源站原始内容。</p></div>;
  }
  const groups = runs.data ? groupSourceRunsByBatch(runs.data) : [];
  return (
    <section className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="rounded-xl border border-line bg-panel p-3">
        <h3 className="px-2 py-2 text-sm font-semibold">抓取批次</h3>
        {groups.map((group) => <section key={group.key} className="mb-3 border-t border-line pt-2 first:border-t-0 first:pt-0">
          <div className="px-2 py-2 text-xs">
            <p className="font-semibold">{group.label}</p>
            <p className="mt-1 text-muted">{group.planVersion ? `计划 v${group.planVersion} · ` : ""}{group.status}
              {group.startedAt ? ` · ${formatDateTime(group.startedAt)}` : ""}</p>
            <p className="mt-1 text-muted">{group.runs.length} 个来源运行 · {group.runs.reduce((sum, run) => sum + run.snapshotCount, 0)} 条</p>
          </div>
          {group.runs.map((run) => <button key={run.id} type="button" onClick={() => setSelectedRunId(run.id)} className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${selectedRunId === run.id ? "bg-ink text-surface" : "hover:bg-surface"}`}><span className="block font-medium">{run.providerKey}</span><span className="text-xs opacity-70">{run.snapshotCount} 条 · {renderRunStatus(run)}</span></button>)}
          {group.runs.length === 0 && <p className="px-2 pb-2 text-xs text-muted">这个批次没有创建任何来源运行。</p>}
        </section>)}
      </aside>
      <article className="min-w-0 rounded-xl border border-line bg-surface p-5">
        {detail.isLoading && <div className="h-40 animate-pulse rounded bg-line/30" />}
        {detail.isError && <ErrorPanel onRetry={() => detail.refetch()} />}
        {resumeError && <div className="mb-4 rounded-lg border border-danger/30 p-3 text-sm text-danger">{resumeError}</div>}
        {resumeAccepted && <div className="mb-4 rounded-lg border border-emerald-300 p-3 text-sm text-emerald-700" role="status">{resumeAccepted}</div>}
        {detail.data && <SourceRunDetail taskId={taskId} view={detail.data}
          onResume={() => resume(detail.data!)} isResuming={resumingRunId === detail.data.run.id} />}
      </article>
    </section>
  );
}

export function shouldPollSourceDataset(view?: SourceDatasetTaskView) {
  return Boolean(view?.batches.some((batch) => batch.status === "running")
    || view?.runs.some((run) => run.status === "running"));
}

export function groupSourceRunsByBatch(view: SourceDatasetTaskView) {
  const runsByBatch = new Map<string, SourceCollectionRun[]>();
  const legacyRuns: SourceCollectionRun[] = [];
  for (const run of view.runs) {
    if (!run.executionBatchId) legacyRuns.push(run);
    else runsByBatch.set(run.executionBatchId, [...(runsByBatch.get(run.executionBatchId) ?? []), run]);
  }
  const groups: Array<{ key: string; label: string; planVersion?: number; status: string;
    startedAt?: string; runs: SourceCollectionRun[] }> = view.batches.map((batch) => ({
    key: batch.id,
    label: `批次 ${batch.id}`,
    planVersion: batch.sourceCollectionPlanVersion,
    status: renderRunStatus(batch),
    startedAt: batch.startedAt,
    runs: runsByBatch.get(batch.id) ?? [],
  }));
  if (legacyRuns.length > 0) groups.push({ key: "legacy", label: "历史记录（无批次）",
    planVersion: undefined, status: "仅用于历史审计", startedAt: undefined, runs: legacyRuns });
  return groups;
}

export function SourceRunDetail({ taskId, view, onResume, isResuming = false }: {
  taskId: string; view: SourceDatasetRunView; onResume?: () => void; isResuming?: boolean;
}) {
  const canResume = (view.run.status === "failed" || view.run.status === "stopped")
    && view.run.providerKey === "jd.catalog-product" && view.run.providerVersion === "2.0.0"
    && Boolean(view.run.sourceCollectionPlanVersion);
  return <>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold">原始来源数据</h3><p className="mt-1 text-xs text-muted">
        {view.records.length} 个不可变快照 · {renderRunStatus(view.run)} · 计划 v{view.run.sourceCollectionPlanVersion ?? "旧版"}
      </p></div>
      <div className="flex gap-2">{canResume && onResume && <ConfirmationDialog
        trigger={<button type="button" className="button-secondary" disabled={isResuming}><RefreshCw className="h-4 w-4" />{isResuming ? "继续中…" : "显式继续"}</button>}
        title="继续这个来源？"
        description="请先确认限制或中断原因已经处理。继续后会创建新的 Source Run；已有冷却窗口和总请求预算不会重置。"
        confirmLabel="确认继续"
        onConfirm={onResume}
      />}<a className="button-secondary" href={sourceRunExportUrl(taskId, view.run.id, "jsonl")}><Download className="h-4 w-4" />JSONL</a><a className="button-secondary" href={sourceRunExportUrl(taskId, view.run.id, "csv")}><Download className="h-4 w-4" />CSV</a></div>
    </div>
    <section className="mb-5 grid gap-2 text-xs sm:grid-cols-3">
      <div className="rounded-lg border border-line bg-panel p-3"><span className="font-medium">请求账本 {view.requestAttempts.length} / {view.run.requestBudget ?? "旧版"}</span><p className="mt-1 text-muted">逐次实际 HTTP hop</p></div>
      <div className="rounded-lg border border-line bg-panel p-3"><span className="font-medium">捕获工作项 {view.workItems.length}</span><p className="mt-1 text-muted">{view.workItems.filter((item) => item.status === "completed").length} completed</p></div>
      <div className="rounded-lg border border-line bg-panel p-3"><span className="font-medium">{renderCircuits(view)}</span><p className="mt-1 text-muted">{view.accessGates.some((gate) => gate.manualResumeRequired) ? "需要负责人显式继续" : "无需人工恢复"}</p></div>
    </section>
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
      {record.resourceReferences.length > 0 && <div className="mt-3 rounded bg-panel p-3 text-xs"><p className="font-medium">图片 URL 引用 {record.resourceReferences.length}</p><ol className="mt-2 max-h-48 list-decimal space-y-1 overflow-auto pl-5">{record.resourceReferences.map((reference) => <li key={reference.id} className="break-all"><span>{reference.sourceUrl}</span><span className="ml-2 text-muted">{reference.role} · {reference.section} · #{reference.ordinal}</span></li>)}</ol></div>}
    </section>)}</div>
  </>;
}

function renderCircuits(view: SourceDatasetRunView) {
  if (view.accessGates.length === 0) return "circuit 未建立";
  const states = [...new Set(view.accessGates.map((gate) => gate.circuitState))];
  return `circuit ${states.join(" / ")}`;
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
