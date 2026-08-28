import type { SourceDatasetRecordSummary } from "@domain-analysis/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { fetchSourceDatasetRecords } from "../lib/api";
import type { SourceDataMapEntity } from "./sourceDatasetMapModel";
import { formatMapBytes, mapUrlLabel, outcomeLabel } from "./sourceDatasetMapLabels";
import { SourceDatasetResourceTag } from "./SourceDatasetResourceTag";

export function SourceDatasetRecordList({ taskId, entity, onSelect }: {
  taskId: string;
  entity: Extract<SourceDataMapEntity, { kind: "group" }>;
  onSelect: (record: SourceDatasetRecordSummary) => void;
}) {
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursorStack.at(-1);
  const page = useQuery({
    queryKey: ["source-map-records", taskId, entity.source.sourceKey, entity.target.targetKey,
      entity.group.groupKey, cursor],
    queryFn: () => fetchSourceDatasetRecords(taskId, { sourceKey: entity.source.sourceKey,
      targetKey: entity.target.targetKey, groupKey: entity.group.groupKey, cursor, limit: 30 }),
    staleTime: 30_000,
  });
  if (page.isLoading) return <div className="source-map-record-loading"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取这一组数据</div>;
  if (page.isError) return <div className="source-map-record-error">记录读取失败，请收起后重试。</div>;
  const records = page.data?.items ?? [];
  return <div className="source-map-records nodrag nopan nowheel">
    <ol className="source-map-record-list">{records.map((record) => {
      const name = mapUrlLabel(record.observation.finalUrl ?? record.observation.requestedUrl);
      const meta = `${outcomeLabel(record.outcome)}${record.payload?.bytes === undefined
        ? "" : ` · ${formatMapBytes(record.payload.bytes)}`}`;
      return <li key={record.snapshotId}>
        <button type="button" className="source-map-record-row" onClick={(event) => {
          event.stopPropagation(); onSelect(record);
        }}>
          <SourceDatasetResourceTag format={record.resourceFormat} compact />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium" title={name}>{name}</span>
          <span className="max-w-36 shrink-0 truncate text-[9px] text-muted" title={meta}>{meta}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
        </button>
      </li>;
    })}</ol>
    {records.length === 0 && <p className="px-3 py-5 text-center text-[11px] text-muted">这一组没有可读取的记录。</p>}
    <footer className="source-map-record-pager">
      <span>第 {cursorStack.length} 页 · 共 {page.data?.totalCount ?? entity.group.totalCount} 条</span>
      <span className="flex items-center gap-1">
        <button type="button" disabled={cursorStack.length === 1} aria-label="上一页"
          onClick={(event) => { event.stopPropagation(); setCursorStack((current) => current.slice(0, -1)); }}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" disabled={!page.data?.nextCursor} aria-label="下一页"
          onClick={(event) => { event.stopPropagation(); if (page.data?.nextCursor) {
            setCursorStack((current) => [...current, page.data!.nextCursor]);
          } }}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
      </span>
    </footer>
  </div>;
}
