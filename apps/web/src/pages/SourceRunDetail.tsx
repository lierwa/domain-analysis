import type { SourceDatasetRunAuditView } from "@domain-analysis/shared";
import { Download, X } from "lucide-react";

import { formatDateTime } from "../lib/format";
import { sourceRunExportUrl } from "../lib/api";

export function SourceRunDetail({ taskId, view, onClose }: {
  taskId: string;
  view: SourceDatasetRunAuditView;
  onClose?: () => void;
}) {
  return <article className="min-h-full min-w-0 bg-surface">
    <header className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">运行审计</p>
        <h3 className="mt-1 text-base font-semibold">{formatDateTime(view.run.startedAt)}</h3>
        <p className="mt-1 text-xs text-muted">计划 v{view.run.sourceCollectionPlanVersion ?? "历史"} · {renderRunStatus(view.run)}</p>
      </div>
      <div className="flex flex-wrap gap-2"><a className="button-secondary" href={sourceRunExportUrl(taskId, view.run.id, "jsonl")}>
        <Download className="h-4 w-4" aria-hidden="true" />JSONL
      </a>
      <a className="button-secondary" href={sourceRunExportUrl(taskId, view.run.id, "csv")}>
        <Download className="h-4 w-4" aria-hidden="true" />CSV
      </a>
      {onClose && <button type="button" className="icon-button" onClick={onClose} aria-label="关闭运行审计" autoFocus>
        <X className="h-5 w-5" aria-hidden="true" />
      </button>}</div>
    </header>
    <div className="space-y-6 p-5">
      <section aria-labelledby="run-summary-title">
        <h4 id="run-summary-title" className="text-sm font-semibold">本次 Run</h4>
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
          <Meta label="原始快照" value={String(view.run.snapshotCount)} />
          <Meta label="图片附件" value={String(view.run.assetCount)} />
          <Meta label="捕获工作项" value={String(view.workItems.length)} />
          <Meta label="请求尝试" value={`${view.requestAttempts.length} / ${view.run.requestBudget ?? "历史"}`} />
          <Meta label="开始时间" value={formatDateTime(view.run.startedAt)} />
          <Meta label="结束时间" value={view.run.finishedAt ? formatDateTime(view.run.finishedAt) : "仍在运行"} />
        </dl>
      </section>
      <section className="border-t border-line pt-5" aria-labelledby="run-groups-title">
        <h4 id="run-groups-title" className="text-sm font-semibold">原始记录组</h4>
        <div className="mt-3 divide-y divide-line border-y border-line">{view.recordGroups.map((group) => <div
          key={`${group.targetKey ?? "unassigned"}:${group.resourceKind ?? "unclassified"}`}
          className="flex min-h-12 items-center justify-between gap-3 py-2 text-xs">
          <span><span className="font-medium">{resourceKindLabel(group.resourceKind)}</span>
            <span className="ml-2 text-muted">{group.targetKey ?? "未关联目标"}</span></span>
          <span className="tabular-nums text-muted">{group.totalCount} 条</span>
        </div>)}</div>
        {view.recordGroups.length === 0 && <p className="mt-3 text-xs text-muted">这个 Run 没有已关联的原始记录组。</p>}
      </section>
      <section className="border-t border-line pt-5" aria-labelledby="run-targets-title">
        <h4 id="run-targets-title" className="text-sm font-semibold">清单逐项对账</h4>
        <div className="mt-3 divide-y divide-line border-y border-line">{view.targets.map((target) => <div
          key={target.id} className="flex items-center justify-between gap-3 py-3 text-xs">
          <span><span className="font-medium">{target.targetKey}</span>
            <span className="ml-2 text-muted">{target.snapshotCount} 快照 · {target.assetCount} 附件</span></span>
          <span>{renderRunStatus(target)}</span>
        </div>)}</div>
      </section>
      <details className="border-t border-line pt-5">
        <summary className="cursor-pointer text-sm font-semibold">访问与恢复审计</summary>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <Meta label="访问门" value={renderCircuits(view)} />
          <Meta label="恢复状态" value={view.accessGates.some((gate) => gate.manualResumeRequired)
            ? "需要负责人显式继续" : "无需人工恢复"} />
          <Meta label="已完成工作项" value={String(view.workItems.filter((item) => item.status === "completed").length)} />
          <Meta label="未完成工作项" value={String(view.workItems.filter((item) => item.status !== "completed").length)} />
        </dl>
      </details>
    </div>
  </article>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="font-medium text-muted">{label}</dt>
    <dd className="mt-1 break-all leading-5">{value}</dd></div>;
}

function renderCircuits(view: SourceDatasetRunAuditView) {
  if (view.accessGates.length === 0) return "访问门未建立";
  return [...new Set(view.accessGates.map((gate) => gate.circuitState))].join(" / ");
}

function resourceKindLabel(kind: SourceDatasetRunAuditView["recordGroups"][number]["resourceKind"]) {
  const labels = { brand_catalog: "品牌目录", model_bundle: "型号入口", parameters: "参数页",
    gallery: "图集页", picture_set: "图片分组", image: "图片" } as const;
  return kind ? labels[kind] : "未归类原始记录";
}

export function renderRunStatus(run: { status: string; terminationReason?: string; failureCategory?: string }) {
  const blocked = new Set(["login_required", "verification_required", "access_denied"]);
  const category = run.failureCategory ? failureCategoryLabel(run.failureCategory) : undefined;
  return run.terminationReason && blocked.has(run.terminationReason)
    ? `blocked · ${run.terminationReason}`
    : run.terminationReason ? `${run.status} · ${category ? `${category} · ` : ""}${run.terminationReason}`
      : category ? `${run.status} · ${category}` : run.status;
}

function failureCategoryLabel(category: string) {
  const labels: Record<string, string> = { system_configuration: "系统配置",
    transient_transport: "瞬时网络重试耗尽", source_restricted: "来源受限",
    plan_revision_required: "计划需修订", content_not_accepted: "内容未达标",
    contract_fault: "代码或契约故障", execution_process_lost: "执行进程失联" };
  return labels[category] ?? category;
}
