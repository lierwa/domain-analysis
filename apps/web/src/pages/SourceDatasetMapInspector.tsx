import type { SourceCollectionRun } from "@domain-analysis/shared";
import { X } from "lucide-react";

import { formatDateTime } from "../lib/format";
import type { SourceDataMapEntity } from "./sourceDatasetMapModel";
import { recordGroupLabel } from "./sourceDatasetMapLabels";
import { SourceDatasetResourceTag } from "./SourceDatasetResourceTag";
import { renderRunStatus } from "./SourceRunDetail";

export function SourceDatasetMapInspector({ entity, onClose, onSelectRun }: {
  entity: SourceDataMapEntity;
  onClose: () => void;
  onSelectRun: (run: SourceCollectionRun) => void;
}) {
  const heading = entityHeading(entity);
  return <article className="min-h-full bg-surface">
    <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{heading.eyebrow}</p>
        <h3 className="mt-1 break-words text-lg font-semibold">{heading.title}</h3>
        {heading.description && <p className="mt-1 text-xs leading-5 text-muted">{heading.description}</p>}
      </div>
      <button type="button" className="icon-button shrink-0 focus-visible:bg-panel focus-visible:ring-0" onClick={onClose} aria-label="关闭详情" autoFocus><X className="h-5 w-5" aria-hidden="true" /></button>
    </header>
    <div className="space-y-6 p-5">
      {entity.kind === "task" && <DefinitionList entries={[
        ["任务 ID", entity.taskId], ["品类", entity.category ?? "未记录"],
      ]} />}
      {entity.kind === "collection" && <DefinitionList entries={[
        ["节点组", entity.title], ["包含项目", String(entity.itemCount)],
        ["分组依据", entity.description],
      ]} />}
      {entity.kind === "brand" && <>
        <DefinitionList entries={[
          ["来源状态", entity.brand.status === "planned" ? "官网来源已规划" : "来源待解决"],
          ["别名", entity.brand.aliases.join("、") || "无"],
          ["关联官网来源", entity.brand.officialSourceKeys.join("、") || "尚未关联"],
        ]} />
        {entity.brand.status === "unresolved" && <FactNote>这里只记录计划中尚未解决的品牌；是否需要重试应由具体失败原因和占比分母决定。</FactNote>}
      </>}
      {entity.kind === "shared" && <FactNote>这一组只汇总计划中未归属于单个品牌官网的跨品牌市场目录、标准、监管和技术资料，不把公共来源虚构成某个品牌的官网。</FactNote>}
      {entity.kind === "topic" && <DefinitionList entries={[["内容主题", entity.topic], ["覆盖来源", String(entity.sourceCount)]]} />}
      {entity.kind === "source" && <SourceInspector entity={entity} onSelectRun={onSelectRun} />}
      {entity.kind === "target" && <>
        <DefinitionList entries={[
          ["来源", entity.source.name], ["Target Key", entity.target.targetKey],
          ["捕获单元", entity.target.captureUnit], ["任务主题", entity.target.taskTopics.join("、") || "未标注"],
          ["当前快照", String(entity.target.recordGroups.reduce((sum, group) => sum + group.totalCount, 0))],
          ["记录组", String(entity.target.recordGroups.length)],
        ]} />
      </>}
      {entity.kind === "group" && <>
        <DefinitionList entries={[["来源", entity.source.name], ["捕获目标", entity.target.name],
          ["记录组", recordGroupLabel(entity.group.groupKey)], ["记录数量", String(entity.group.totalCount)],
          ["内容通过", String(entity.group.outcomes.accepted)],
          ["辅助材料", String(entity.group.outcomes.supporting)],
          ["需关注", String(entity.group.outcomes.rejected + entity.group.outcomes.failed)]]} />
        <div className="flex flex-wrap gap-2">{entity.group.formats.map((item) =>
          <SourceDatasetResourceTag key={item.format} format={item.format} count={item.count} />)}</div>
        <FactNote>{entity.group.groupKey === "unrecorded"
          ? "这些历史快照没有保存发现父子关系，系统不会根据 URL 或页面文字补猜血缘。"
          : "在画布或大纲中展开这个记录组，系统才会分页读取单条快照。"}</FactNote>
      </>}
    </div>
  </article>;
}

function SourceInspector({ entity, onSelectRun }: {
  entity: Extract<SourceDataMapEntity, { kind: "source" }>;
  onSelectRun: (run: SourceCollectionRun) => void;
}) {
  return <>
    <DefinitionList entries={[
      ["发布方", entity.source.publisher ?? "未记录"], ["Source Key", entity.source.sourceKey],
      ["来源类型", entity.source.sourceKind ?? "未记录"], ["职责", entity.source.role ?? "未记录"],
      ["捕获目标", String(entity.source.targets.length)], ["当前快照", String(entity.recordCount)],
    ]} />
    <section>
      <h4 className="text-sm font-semibold">来源运行</h4>
      <div className="mt-3 space-y-2">{entity.runs.map((run) => <button key={run.id} type="button"
        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border border-line px-3 text-left text-xs hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        onClick={() => onSelectRun(run)}>
        <span><span className="block font-medium">{formatDateTime(run.startedAt)}</span><span className="mt-1 block text-muted">{run.snapshotCount} 条快照</span></span>
        <span className="text-right text-muted">{renderRunStatus(run)}</span>
      </button>)}</div>
      {entity.runs.length === 0 && <p className="mt-3 rounded-lg border border-dashed border-line p-4 text-xs leading-5 text-muted">计划已包含这个来源，但尚未创建来源运行。</p>}
    </section>
  </>;
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
  if (entity.kind === "task") return { eyebrow: "采集任务", title: entity.taskName, description: "当前确认计划的原始数据地图" };
  if (entity.kind === "collection") return { eyebrow: "节点组", title: entity.title, description: entity.description };
  if (entity.kind === "brand") return { eyebrow: "品牌", title: entity.brand.name, description: "计划登记的品牌与官网来源关系" };
  if (entity.kind === "shared") return { eyebrow: "公共来源组", title: "跨品牌与专业资料", description: `${entity.sourceCount} 个来源` };
  if (entity.kind === "topic") return { eyebrow: "内容主题", title: entity.topic, description: `${entity.sourceCount} 个来源覆盖` };
  if (entity.kind === "source") return { eyebrow: "计划来源", title: entity.source.name, description: entity.source.role };
  if (entity.kind === "target") return { eyebrow: "捕获目标", title: entity.target.name, description: entity.target.captureUnit };
  return { eyebrow: "原始记录组", title: recordGroupLabel(entity.group.groupKey),
    description: `${entity.group.totalCount} 条快照` };
}
