import type { SourceCollectionRun } from "@domain-analysis/shared";
import { AlertTriangle, X } from "lucide-react";

import { formatDateTime } from "../lib/format";
import type { SourceDataMapEntity } from "./sourceDatasetMapModel";
import { resourceKindLabel } from "./sourceDatasetMapModel";
import { renderRunStatus } from "./SourceRunDetail";

export function SourceDatasetMapInspector({ entity, onClose, onSelectRun }: {
  entity: SourceDataMapEntity;
  onClose: () => void;
  onSelectRun: (run: SourceCollectionRun) => void;
}) {
  const heading = entityHeading(entity);
  return <article className="min-h-full bg-surface">
    <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur">
      <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{heading.eyebrow}</p>
        <h3 className="mt-1 break-words text-lg font-semibold">{heading.title}</h3>
        {heading.description && <p className="mt-1 text-xs leading-5 text-muted">{heading.description}</p>}
      </div>
      <button type="button" className="icon-button shrink-0" onClick={onClose}
        aria-label="关闭详情" autoFocus><X className="h-5 w-5" aria-hidden="true" /></button>
    </header>
    <div className="space-y-6 p-5">
      {entity.kind === "task" && <DefinitionList entries={[["任务 ID", entity.taskId],
        ["品类", entity.category ?? "未记录"]]} />}
      {entity.kind === "collection" && <DefinitionList entries={[["节点组", entity.title],
        ["包含项目", String(entity.itemCount)], ["分组依据", entity.description]]} />}
      {entity.kind === "brand" && <DefinitionList entries={[
        ["源站品牌 ID", entity.brand.sourceEntityId], ["型号总数", String(entity.brand.counts.total)],
        ["已完成", String(entity.brand.counts.completed)],
        ["需关注", String(entity.brand.counts.needsAttention)],
      ]} />}
      {entity.kind === "model" && <ModelInspector entity={entity} />}
      {entity.kind === "resource" && <>
        <DefinitionList entries={[["品牌", entity.brand.displayName], ["型号", entity.model.displayName],
          ["资源类型", resourceKindLabel(entity.resourceKind)], ["原始记录", String(entity.count)]]} />
        <FactNote>在地图节点上展开此资源，系统才会每页读取 30 条；点击具体记录只加载该条详情。</FactNote>
      </>}
      {entity.kind === "source" && <DefinitionList entries={[["发布方", entity.source.publisher ?? "未记录"],
        ["Source Key", entity.source.sourceKey], ["来源职责", entity.source.role ?? "未记录"],
        ["Run 数量", String(entity.runCount)]]} />}
      {entity.kind === "batch" && <DefinitionList entries={[["Batch ID", entity.batch.id],
        ["状态", entity.batch.status], ["恢复状态", entity.batch.recoveryState],
        ["Run 数量", String(entity.runs.length)], ["开始时间", formatDateTime(entity.batch.startedAt)]]} />}
      {entity.kind === "run" && <RunInspector run={entity.run} onSelect={onSelectRun} />}
      {entity.kind === "audit_group" && <>
        <DefinitionList entries={[["Run", entity.run.id], ["记录组", entity.title], ["数量", String(entity.count)]]} />
        <button type="button" className="button-secondary" onClick={() => onSelectRun(entity.run)}>打开 Run 审计</button>
      </>}
    </div>
  </article>;
}

function ModelInspector({ entity }: { entity: Extract<SourceDataMapEntity, { kind: "model" }> }) {
  const resources = entity.model.resources;
  return <>
    <DefinitionList entries={[["品牌", entity.brand.displayName], ["源站型号 ID", entity.model.sourceEntityId],
      ["完成状态", entity.model.status === "needs_attention" ? "需关注" : "已完成"],
      ["参数页", String(resources.parameterPages)], ["图集页", String(resources.galleryPages)],
      ["图片分组", String(resources.pictureSets)], ["图片附件", String(resources.images)]]} />
    {entity.issues.map((issue) => <section key={issue.id} role="alert"
      className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-xs leading-5">
      <h4 className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {issue.classification === "content_rejected" ? "内容未通过验收" : "请求失败"}</h4>
      <p className="mt-2">{issue.reason}</p>
      <p className="mt-2 break-all text-muted">{issue.requestedUrl}</p>
      <p className="mt-2 text-muted">出现 {issue.occurrenceCount} 次 · 涉及 {issue.runIds.length} 个 Run
        {issue.httpStatus ? ` · HTTP ${issue.httpStatus}` : ""}</p>
    </section>)}
  </>;
}

function RunInspector({ run, onSelect }: { run: SourceCollectionRun; onSelect: (run: SourceCollectionRun) => void }) {
  return <><DefinitionList entries={[["Run ID", run.id], ["状态", renderRunStatus(run)],
    ["原始快照", String(run.snapshotCount)], ["图片附件", String(run.assetCount)],
    ["开始时间", formatDateTime(run.startedAt)], ["结束时间", run.finishedAt ? formatDateTime(run.finishedAt) : "仍在运行"]]} />
  <button type="button" className="button-secondary" onClick={() => onSelect(run)}>打开 Run 审计</button></>;
}

function DefinitionList({ entries }: { entries: Array<[string, string]> }) {
  return <dl className="grid gap-4 text-xs sm:grid-cols-2">{entries.map(([label, value]) => <div key={label} className="min-w-0">
    <dt className="font-medium text-muted">{label}</dt><dd className="mt-1 break-words leading-5">{value}</dd>
  </div>)}</dl>;
}

function FactNote({ children }: { children: string }) {
  return <p className="rounded-md bg-panel px-3 py-2.5 text-xs leading-5 text-muted">{children}</p>;
}

function entityHeading(entity: SourceDataMapEntity) {
  if (entity.kind === "task") return { eyebrow: "采集任务", title: entity.taskName, description: "最新 Batch 的原始数据" };
  if (entity.kind === "collection") return { eyebrow: "节点组", title: entity.title, description: entity.description };
  if (entity.kind === "brand") return { eyebrow: "品牌", title: entity.brand.displayName, description: "源站品牌及型号完成度" };
  if (entity.kind === "model") return { eyebrow: "型号", title: entity.model.displayName, description: `源站型号 ${entity.model.sourceEntityId}` };
  if (entity.kind === "resource") return { eyebrow: "原始资源", title: resourceKindLabel(entity.resourceKind), description: entity.model.displayName };
  if (entity.kind === "source") return { eyebrow: "计划来源", title: entity.source.name, description: entity.source.role };
  if (entity.kind === "batch") return { eyebrow: "执行批次", title: entity.batch.id, description: `计划 v${entity.batch.sourceCollectionPlanVersion}` };
  if (entity.kind === "run") return { eyebrow: "来源运行", title: entity.run.id, description: renderRunStatus(entity.run) };
  return { eyebrow: "原始记录组", title: entity.title, description: `${entity.count} 条` };
}
