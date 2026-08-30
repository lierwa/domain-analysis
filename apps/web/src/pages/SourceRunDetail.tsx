import type { SourceDatasetRunView, SourceSnapshotRecord } from "@domain-analysis/shared";
import { Download, ExternalLink, X } from "lucide-react";

import { formatDateTime } from "../lib/format";
import { sourceAssetUrl, sourceRunExportUrl } from "../lib/api";

export function SourceRunDetail({ taskId, view, selectedSnapshotId, onClose }: {
  taskId: string;
  view: SourceDatasetRunView;
  selectedSnapshotId?: string;
  onClose?: () => void;
}) {
  const record = view.records.find((item) => item.snapshot.id === selectedSnapshotId) ?? view.records[0];
  return <article className="min-w-0 border-l border-line bg-surface">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">记录详情</p>
        <h3 className="mt-1 text-base font-semibold">{record ? recordTitle(record) : "这个运行没有快照"}</h3>
        <p className="mt-1 text-xs text-muted">计划 v{view.run.sourceCollectionPlanVersion ?? "历史"} · {renderRunStatus(view.run)}</p>
      </div>
      <div className="flex flex-wrap gap-2"><a className="button-secondary" href={sourceRunExportUrl(taskId, view.run.id, "jsonl")}>
          <Download className="h-4 w-4" aria-hidden="true" />JSONL
        </a>
        <a className="button-secondary" href={sourceRunExportUrl(taskId, view.run.id, "csv")}>
          <Download className="h-4 w-4" aria-hidden="true" />CSV
        </a>
        {onClose && <button type="button" className="icon-button" onClick={onClose} aria-label="关闭详情" autoFocus>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>}
      </div>
    </header>
    <RunImageGallery taskId={taskId} view={view} />
    {record ? <RecordInspector taskId={taskId} view={view} record={record} />
      : <p className="p-6 text-sm text-muted">该来源运行已经记账，但尚未保存原始快照。运行状态与失败原因仍可在下方审计信息中查看。</p>}
    <RunAudit view={view} />
  </article>;
}

function RunImageGallery({ taskId, view }: { taskId: string; view: SourceDatasetRunView }) {
  const references = new Map(view.records.flatMap((record) => record.resourceReferences)
    .map((reference) => [reference.sourceUrl, reference]));
  const images = view.records.flatMap((record) => record.assets.map((asset) => ({
    asset,
    reference: references.get(asset.sourceUrl),
    parentUrl: record.snapshot.lineage?.parentUrl,
  }))).filter(({ asset }) => safeInlineImageTypes.has(asset.mediaType));
  if (images.length === 0) return null;
  return <section className="border-b border-line bg-panel px-5 py-4" aria-labelledby="run-gallery-title">
    <div className="flex items-baseline justify-between gap-3">
      <h4 id="run-gallery-title" className="text-sm font-semibold">型号图片画廊</h4>
      <span className="text-xs text-muted">{images.length} 张来源原图</span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {images.map(({ asset, reference, parentUrl }) => <figure key={asset.id}
        className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface">
        <a href={sourceAssetUrl(taskId, view.run.id, asset.id)} title="下载原始图片">
          <img className="aspect-[4/3] w-full bg-white object-contain" loading="lazy"
            src={sourceAssetUrl(taskId, view.run.id, asset.id, "inline")}
            alt={reference?.observedValue ?? asset.filename} />
        </a>
        <figcaption className="space-y-1 p-2 text-[11px] leading-4">
          <p className="truncate font-medium">{reference?.observedValue ?? asset.filename}</p>
          <p className="truncate text-muted">{reference ? `${reference.role} · #${reference.ordinal + 1}` : parentUrl ?? "来源图片"}</p>
        </figcaption>
      </figure>)}
    </div>
  </section>;
}

const safeInlineImageTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
]);

function RecordInspector({ taskId, view, record }: {
  taskId: string;
  view: SourceDatasetRunView;
  record: SourceSnapshotRecord;
}) {
  const lineage = record.snapshot.lineage;
  const work = lineage ? view.workItems.find((item) => item.workKey === lineage.workKey) : undefined;
  const attempts = lineage ? view.requestAttempts.filter((item) => item.workKey === lineage.workKey) : [];
  const url = record.snapshot.observation.finalUrl ?? record.snapshot.observation.requestedUrl;
  const assessment = record.snapshot.observation.contentAssessment;
  return <div className="space-y-6 p-5">
    <section aria-labelledby="lineage-title">
      <div className="flex items-center justify-between gap-3">
        <h4 id="lineage-title" className="text-sm font-semibold">采集血缘</h4>
        <span className="status-badge">{assessment ? renderAssessmentStatus(assessment.status)
          : record.snapshot.observation.state}</span>
      </div>
      <ol className="mt-4 border-l border-line pl-5 text-sm">
        <LineageStep label="计划来源" value={`${view.run.sourceCollectionPlanSourceKey ?? "历史来源"} · v${view.run.sourceCollectionPlanVersion ?? "历史"}`} />
        <LineageStep label="计划目标" value={record.snapshot.targetKey ?? "历史记录未保存 target"} />
        <LineageStep label="发现方式" value={lineage ? lineageText(lineage.discoveryKind, lineage.depth)
          : "发现路径未记录"} />
        {lineage?.parentUrl && <LineageStep label="父页面" value={lineage.parentUrl} link />}
        <LineageStep label="捕获工作" value={work
          ? `${work.captureUnit} · ${work.status} · ${work.workKey}`
          : lineage ? `${lineage.workKey} · 工作记录未找到` : "未保存关联 work"} />
        <LineageStep label="HTTP 请求" value={attempts.length > 0
          ? `${attempts.length} 次 · ${attempts.at(-1)?.httpStatus ?? attempts.at(-1)?.state}`
          : "没有关联请求记录"} />
        <LineageStep label="不可变快照" value={`${formatDateTime(record.snapshot.observation.observedAt)} · ${record.snapshot.contentHash.slice(0, 12)}`} last />
      </ol>
    </section>
    <section className="border-t border-line pt-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">原始来源</p>
      <a className="mt-2 flex items-start gap-2 break-all text-sm font-medium underline decoration-line underline-offset-4 hover:decoration-ink"
        href={url} target="_blank" rel="noreferrer">{url}<ExternalLink className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /></a>
      <dl className="mt-4 grid gap-x-5 gap-y-3 text-xs sm:grid-cols-2">
        <Meta label="来源对象" value={`${record.object.sourceIdentity} · ${record.object.kind}`} />
        <Meta label="响应" value={`${record.snapshot.observation.httpStatus ?? "无 HTTP 状态"} · ${record.snapshot.payload?.kind ?? "无载荷"}`} />
        <Meta label="原始标识" value={record.object.externalKey} />
        <Meta label="Snapshot ID" value={record.snapshot.id} />
      </dl>
      {assessment && <div className="mt-4 border-l-2 border-ink pl-3 text-xs leading-5">
        <p className="font-medium">{renderAssessmentStatus(assessment.status)}：{assessment.reason}</p>
        {assessment.matchedSignals.length > 0 && <p className="mt-1 text-muted">命中：{assessment.matchedSignals.join("、")}</p>}
      </div>}
      {record.snapshot.observation.error && <p className="mt-4 text-sm text-danger">{record.snapshot.observation.error}</p>}
    </section>
    {record.assets.length > 0 && <section className="border-t border-line pt-5">
      <h4 className="text-sm font-semibold">原始附件</h4>
      <div className="mt-3 flex flex-wrap gap-2">{record.assets.map((asset) => <a key={asset.id}
        className="button-secondary" href={sourceAssetUrl(taskId, view.run.id, asset.id)}>
        <Download className="h-4 w-4" aria-hidden="true" />{asset.filename} · {formatBytes(asset.bytes)}
      </a>)}</div>
    </section>}
    {record.resourceReferences.length > 0 && <details className="border-t border-line pt-5">
      <summary className="cursor-pointer text-sm font-semibold">图片 URL 引用 {record.resourceReferences.length}</summary>
      <ol className="mt-3 max-h-56 list-decimal space-y-2 overflow-auto pl-5 text-xs">{record.resourceReferences.map((reference) => <li key={reference.id} className="break-all">
        <span>{reference.sourceUrl}</span><span className="ml-2 text-muted">{reference.role} · {reference.section} · #{reference.ordinal}</span>
      </li>)}</ol>
    </details>}
    <details className="border-t border-line pt-5">
      <summary className="cursor-pointer text-sm font-semibold">查看原始内容</summary>
      <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-panel p-4 text-xs leading-5">{renderPayload(record.snapshot.payload)}</pre>
    </details>
  </div>;
}

function RunAudit({ view }: { view: SourceDatasetRunView }) {
  return <details className="border-t border-line px-5 py-4">
    <summary className="cursor-pointer text-sm font-semibold">运行审计 · 请求账本 {view.requestAttempts.length} / {view.run.requestBudget ?? "历史"}</summary>
    <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
      <Meta label="捕获工作项" value={`${view.workItems.length} · ${view.workItems.filter((item) => item.status === "completed").length} completed`} />
      <Meta label="访问门" value={renderCircuits(view)} />
      <Meta label="恢复状态" value={view.accessGates.some((gate) => gate.manualResumeRequired) ? "需要负责人显式继续" : "无需人工恢复"} />
    </dl>
    <h4 className="mt-5 text-sm font-semibold">清单逐项对账</h4>
    <div className="mt-2 divide-y divide-line border-y border-line">{view.targets.map((target) => <div key={target.id}
      className="flex items-center justify-between gap-3 py-3 text-xs">
      <span><span className="font-medium">{target.targetKey}</span><span className="ml-2 text-muted">{target.snapshotCount} 快照 · {target.accessibleCount} 内容通过 · {target.assetCount} 附件</span></span>
      <span>{renderRunStatus(target)}</span>
    </div>)}</div>
  </details>;
}

function LineageStep({ label, value, link = false, last = false }: {
  label: string; value: string; link?: boolean; last?: boolean;
}) {
  return <li className={`relative pb-4 ${last ? "pb-0" : ""}`}>
    <span className="absolute -left-[1.55rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-ink" />
    <span className="block text-xs font-medium text-muted">{label}</span>
    {link ? <a className="mt-0.5 block break-all text-xs underline" href={value} target="_blank" rel="noreferrer">{value}</a>
      : <span className="mt-0.5 block break-all text-xs leading-5">{value}</span>}
  </li>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="font-medium text-muted">{label}</dt><dd className="mt-1 break-all leading-5">{value}</dd></div>;
}

function recordTitle(record: SourceSnapshotRecord) {
  try {
    const url = new URL(record.snapshot.observation.finalUrl ?? record.snapshot.observation.requestedUrl);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname);
  } catch { return record.object.externalKey; }
}

function lineageText(kind: NonNullable<SourceSnapshotRecord["snapshot"]["lineage"]>["discoveryKind"], depth: number) {
  if (kind === "planned_entry") return "计划入口";
  if (kind === "sitemap_document") return `Sitemap 原件 · 第 ${depth} 层`;
  if (kind === "sitemap_entry") return `Sitemap 发现 · 第 ${depth} 层`;
  return `HTML 链接发现 · 第 ${depth} 层`;
}

function renderCircuits(view: SourceDatasetRunView) {
  if (view.accessGates.length === 0) return "circuit 未建立";
  return `circuit ${[...new Set(view.accessGates.map((gate) => gate.circuitState))].join(" / ")}`;
}

function renderAssessmentStatus(status: "accepted" | "rejected" | "supporting") {
  if (status === "accepted") return "内容通过";
  if (status === "rejected") return "内容不合格";
  return "发现支撑材料";
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
  const labels: Record<string, string> = {
    system_configuration: "系统配置",
    transient_transport: "瞬时网络重试耗尽",
    source_restricted: "来源受限",
    plan_revision_required: "计划需修订",
    content_not_accepted: "内容未达标",
    contract_fault: "代码或契约故障",
    execution_process_lost: "执行进程失联",
  };
  return labels[category] ?? category;
}

function renderPayload(payload: SourceSnapshotRecord["snapshot"]["payload"]) {
  if (!payload) return "该访问没有返回内容。";
  if (payload.kind === "inline_text") return payload.text;
  return JSON.stringify(payload, null, 2);
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
