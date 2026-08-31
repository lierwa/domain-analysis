import type { CaptureTask, SourceDatasetTaskView } from "@domain-analysis/shared";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Play, RotateCw } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { prepareSourcePlan, startSourcePlan } from "../lib/api";

type DatasetTask = Pick<CaptureTask, "id" | "revision" | "name" | "content">;

export function SourceExecutionControls({ task, view }: { task: DatasetTask; view: SourceDatasetTaskView }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const currentPlan = [...view.sources].filter((source) => source.planStatus === "confirmed"
    && source.sourceKey.startsWith("zol.") && source.sourceKey.endsWith(".ranked-brands"))
    .sort((left, right) => right.planVersion - left.planVersion)[0];
  const execution = view.currentExecution;
  const active = execution?.status === "running"
    || execution?.recoveryState === "pending" || execution?.recoveryState === "running";

  async function startPlan() {
    if (!currentPlan) return;
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const prepared = await prepareSourcePlan(task.id, currentPlan.planId, task.revision, currentPlan.planVersion);
      if (prepared.status === "action_required") { setMessage(prepared.message); return; }
      const accepted = await startSourcePlan(task.id, currentPlan.planId, task.revision, currentPlan.planVersion);
      setMessage(accepted.status === "already_running"
        ? `已有活动 Batch：${accepted.batchId}` : `已创建新 Batch：${accepted.commandId}`);
      await queryClient.invalidateQueries({ queryKey: ["source-runs", task.id] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "来源执行启动失败");
    } finally { setBusy(false); }
  }

  return <section className="shrink-0 border-b border-line bg-surface px-4 py-4 sm:px-5" aria-labelledby="execution-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="execution-heading" className="text-sm font-semibold">{currentPlan?.name ?? "ZOL 品牌参数与完整图集"}</h2>
        <p className="mt-1 text-xs text-muted">{execution ? executionStatusText(execution) : currentPlan
          ? `已确认 Crawl Plan v${currentPlan.planVersion}，尚未创建 Batch。`
          : "请先在抓取范围中确认 Crawl Plan。"}</p></div>
      {active ? <div className="source-run-status" role="status"><span className="source-run-status-dot" aria-hidden="true" />
        {execution?.recoveryState === "pending" ? "等待后台恢复" : "后台执行中"}</div>
        : !execution && currentPlan ? <button type="button" className="button-primary" disabled={busy}
          onClick={() => void startPlan()}><Play className="h-4 w-4" aria-hidden="true" />
          {busy ? "正在检查…" : `启动计划 v${currentPlan.planVersion}`}</button>
          : execution && currentPlan ? <RerunDialog busy={busy} onConfirm={startPlan} />
            : <span className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-medium text-muted">等待计划确认</span>}
    </div>
    {execution && <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4 lg:grid-cols-8"
      aria-label="当前 Batch 完成度">
      <Metric label="Batch" value={statusLabel(execution.status)} />
      <Metric label="品牌" value={execution.brandCount} />
      <Metric label="型号完成" value={`${execution.completedModelCount}/${execution.modelCount}`} />
      <Metric label="原始快照" value={execution.snapshotCount} />
      <Metric label="图片附件" value={execution.assetCount} />
      <Metric label="唯一问题" value={execution.issueCount} attention={execution.issueCount > 0} />
      <Metric label="Run" value={execution.runCount} />
      <Metric label="累计运行" value={formatDuration(execution.cumulativeRunDurationMs)} />
    </div>}
    {message && <p className="mt-2 text-xs text-muted" role="status">{message}</p>}
    {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}
  </section>;
}

function RerunDialog({ busy, onConfirm }: { busy: boolean; onConfirm: () => Promise<void> }) {
  return <AlertDialog.Root><AlertDialog.Trigger asChild><button type="button" className="button-secondary" disabled={busy}>
    <RotateCw className="h-4 w-4" aria-hidden="true" />重新执行计划
  </button></AlertDialog.Trigger>
  <AlertDialog.Portal><AlertDialog.Overlay className="fixed inset-0 z-[80] bg-ink/45" />
    <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[90] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 shadow-2xl">
      <AlertDialog.Title className="text-base font-semibold">创建新的 Source Batch？</AlertDialog.Title>
      <AlertDialog.Description className="mt-2 text-sm leading-6 text-muted">重新执行会创建新 Batch，不会覆盖当前原始数据。历史 Batch 与 Run 仍保留在运行审计中。</AlertDialog.Description>
      <div className="mt-5 flex justify-end gap-2"><AlertDialog.Cancel asChild><button type="button" className="button-secondary">取消</button></AlertDialog.Cancel>
        <AlertDialog.Action asChild><button type="button" className="button-primary" onClick={() => void onConfirm()}>确认创建</button></AlertDialog.Action></div>
    </AlertDialog.Content></AlertDialog.Portal>
  </AlertDialog.Root>;
}

function Metric({ label, value, attention = false }: { label: string; value: string | number; attention?: boolean }) {
  return <dl className="min-w-0 bg-surface px-3 py-3"><dt className="text-[10px] font-medium text-muted">{label}</dt>
    <dd className={`mt-1 truncate text-sm font-semibold tabular-nums ${attention ? "text-danger" : "text-ink"}`}>{value}</dd></dl>;
}

function executionStatusText(execution: NonNullable<SourceDatasetTaskView["currentExecution"]>) {
  if (execution.status === "completed") return `Batch 已完成 · ${execution.brandCount} 个品牌 · ${execution.completedModelCount}/${execution.modelCount} 个型号完成`;
  if (execution.recoveryState === "pending") return "Batch 等待后台恢复，已保存原始数据不会丢失。";
  if (execution.status === "running") return "Batch 正在后台执行；关闭页面不影响采集。";
  return `Batch ${statusLabel(execution.status)}，请在唯一问题和运行审计中查看原因。`;
}

function statusLabel(status: NonNullable<SourceDatasetTaskView["currentExecution"]>["status"]) {
  return ({ running: "运行中", completed: "已完成", partial: "部分完成", failed: "失败", stopped: "已停止" } as const)[status];
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}时${minutes}分` : `${minutes}分${String(seconds).padStart(2, "0")}秒`;
}
