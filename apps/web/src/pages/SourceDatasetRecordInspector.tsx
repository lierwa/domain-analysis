import type { SourceDatasetRecordSummary, SourceDatasetTaskView } from "@domain-analysis/shared";
import { Download, ExternalLink, X } from "lucide-react";

import { sourceAssetUrl } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { resourceKindLabel } from "./sourceDatasetMapModel";

export function SourceDatasetRecordInspector({ taskId, record, view, onClose }: {
  taskId: string;
  record: SourceDatasetRecordSummary;
  view: SourceDatasetTaskView;
  onClose: () => void;
}) {
  const location = findModel(view, record.captureSubjectId);
  const issue = view.issues.find((item) => item.latestSnapshotId === record.snapshotId)
    ?? view.issues.find((item) => item.subjectId === record.captureSubjectId
      && item.requestedUrl === record.observation.requestedUrl);
  const asset = record.assets[0];
  const url = record.observation.finalUrl ?? record.observation.requestedUrl;
  return <article className="min-h-full bg-surface">
    <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur">
      <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">原始记录</p>
        <h3 className="mt-1 break-words text-lg font-semibold">{location?.model.displayName ?? record.externalKey}</h3>
        <p className="mt-1 text-xs text-muted">{location?.brand.displayName ?? "未归类品牌"} · {resourceLabel(record)}</p>
      </div>
      <button type="button" className="icon-button shrink-0" onClick={onClose}
        aria-label="关闭原始记录详情" autoFocus><X className="h-5 w-5" aria-hidden="true" /></button>
    </header>
    <div className="space-y-6 p-5">
      {asset && safeInlineImageTypes.has(asset.mediaType) && <figure className="overflow-hidden rounded-lg border border-line bg-white">
        <img className="aspect-[4/3] w-full object-contain" loading="eager"
          src={sourceAssetUrl(taskId, record.runId, asset.id, "inline")}
          alt={`${location?.model.displayName ?? "型号"} ${record.resourceSection ?? "来源图片"}`} />
        <figcaption className="flex items-center justify-between gap-3 border-t border-line bg-panel px-3 py-2 text-xs">
          <span className="min-w-0 truncate">{asset.filename}</span>
          <a className="inline-flex shrink-0 items-center gap-1 font-medium underline"
            href={sourceAssetUrl(taskId, record.runId, asset.id)}><Download className="h-3.5 w-3.5" />下载原图</a>
        </figcaption>
      </figure>}
      <dl className="grid gap-4 text-xs sm:grid-cols-2">
        <Meta label="品牌" value={location?.brand.displayName ?? "未归类"} />
        <Meta label="型号" value={location?.model.displayName ?? record.captureSubjectId ?? "未归类"} />
        <Meta label="资源类型" value={resourceLabel(record)} />
        <Meta label="分区" value={record.resourceSection ?? "未记录"} />
        <Meta label="序号" value={record.resourceOrdinal === undefined ? "未记录" : `第 ${record.resourceOrdinal + 1} 项`} />
        <Meta label="采集结果" value={outcomeLabel(record.outcome)} />
        <Meta label="HTTP 状态" value={String(record.observation.httpStatus ?? "未记录")} />
        <Meta label="观察时间" value={formatDateTime(record.observation.observedAt)} />
      </dl>
      {issue && <section role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-xs leading-5">
        <h4 className="font-semibold">内容未通过验收</h4>
        <p className="mt-1">{issue.reason}</p>
        <p className="mt-2 text-muted">出现 {issue.occurrenceCount} 次 · 涉及 {issue.runIds.length} 个 Run</p>
      </section>}
      <section className="border-t border-line pt-5">
        <h4 className="text-sm font-semibold">来源与血缘</h4>
        <a className="mt-3 flex items-start gap-2 break-all text-xs underline decoration-line underline-offset-4"
          href={url} target="_blank" rel="noreferrer">{url}
          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /></a>
        <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
          <Meta label="Snapshot" value={record.snapshotId} />
          <Meta label="Run" value={record.runId} />
          <Meta label="发现方式" value={record.lineage
            ? `${record.lineage.discoveryKind} · 深度 ${record.lineage.depth}` : "历史记录未保存"} />
          <Meta label="父页面" value={record.lineage?.parentUrl ?? "计划入口"} />
        </dl>
      </section>
    </div>
  </article>;
}

function findModel(view: SourceDatasetTaskView, subjectId?: string) {
  if (!subjectId) return undefined;
  for (const brand of view.capturedBrands) {
    const model = brand.models.find((item) => item.subjectId === subjectId);
    if (model) return { brand, model };
  }
  return undefined;
}

function resourceLabel(record: SourceDatasetRecordSummary) {
  return record.resourceKind ? resourceKindLabel(record.resourceKind) : "未归类原始记录";
}

function outcomeLabel(outcome: SourceDatasetRecordSummary["outcome"]) {
  if (outcome === "accepted") return "内容通过";
  if (outcome === "rejected") return "内容未通过验收";
  if (outcome === "supporting") return "辅助材料";
  return "请求失败";
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="font-medium text-muted">{label}</dt>
    <dd className="mt-1 break-words leading-5">{value}</dd></div>;
}

const safeInlineImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
