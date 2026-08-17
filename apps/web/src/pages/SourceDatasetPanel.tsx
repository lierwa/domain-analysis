import type {
  ProjectEvidenceRequestView,
  SourceEvidenceSelection,
  SourceSnapshotRecord,
} from "@domain-analysis/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  fetchSourceCollectionRun,
  fetchSourceCollectionRuns,
  fetchProjectEvidence,
  materializeSourceEvidence,
  sourceRunExportUrl,
} from "../lib/api";
import {
  sourceAuthorityLabels,
  sourceClaimScopeLabels,
} from "./productKnowledgeLabels";

export function SourceDatasetPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const runs = useQuery({
    queryKey: ["source-runs", projectId],
    queryFn: () => fetchSourceCollectionRuns(projectId),
  });
  const detail = useQuery({
    queryKey: ["source-run", projectId, selectedRunId],
    queryFn: () => fetchSourceCollectionRun(projectId, selectedRunId!),
    enabled: Boolean(selectedRunId),
  });
  const requests = useQuery({
    queryKey: ["project-evidence", projectId],
    queryFn: () => fetchProjectEvidence(projectId),
  });
  const materialize = useMutation({
    mutationFn: (input: { snapshotId: string; requestId: string; selection: SourceEvidenceSelection }) =>
      materializeSourceEvidence(projectId, input.snapshotId, input.requestId, input.selection),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-evidence", projectId] }),
  });

  useEffect(() => {
    if (!selectedRunId && runs.data?.[0]) setSelectedRunId(runs.data[0].id);
  }, [runs.data, selectedRunId]);

  return (
    <section className="rounded-xl border border-line bg-surface p-5 sm:p-7" aria-label="来源数据">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">来源数据</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">逐条保存来源观察、原始结构、许可和附件；这里只展示来源事实，不把页面字段直接当成已发布知识。</p>
        </div>
        <button type="button" className="button-secondary" onClick={() => runs.refetch()} disabled={runs.isFetching}>
          <RefreshCw className={`h-4 w-4 ${runs.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />刷新
        </button>
      </header>

      {runs.isError && <p className="mt-4 text-sm text-danger" role="alert">来源运行加载失败，请检查本地服务。</p>}
      {!runs.isLoading && runs.data?.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-line p-5 text-sm text-muted">尚未产生来源运行。</div>
      )}
      {(runs.data?.length ?? 0) > 0 && (
        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-2" aria-label="来源运行列表">
            {runs.data?.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelectedRunId(run.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${selectedRunId === run.id ? "border-ink bg-panel" : "border-line hover:bg-panel"}`}
              >
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{run.providerKey}</span><span className="status-badge">{runStatusLabel(run.status)}</span></div>
                <p className="mt-2 text-xs text-muted">{run.categoryCode} · {sourceAuthorityLabels[run.sourceAuthorityType]}</p>
                <p className="mt-1 text-xs tabular-nums text-muted">{run.accessibleCount} 成功 / {run.failedCount} 失败 / {run.assetCount} 附件</p>
              </button>
            ))}
          </div>
          <div className="min-w-0">
            {detail.isLoading && <div className="h-40 animate-pulse rounded-lg bg-panel" aria-label="正在加载来源数据" />}
            {detail.isError && <p className="text-sm text-danger" role="alert">来源详情加载失败。</p>}
            {detail.data && <RunDetail
              projectId={projectId}
              view={detail.data}
              requests={requests.data ?? []}
              onMaterialize={(input) => materialize.mutateAsync(input)}
              pending={materialize.isPending}
            />}
            {materialize.error && <p className="mt-3 text-sm text-danger" role="alert">{materialize.error instanceof Error ? materialize.error.message : "证据提交失败"}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function RunDetail({
  projectId,
  view,
  requests,
  onMaterialize,
  pending,
}: {
  projectId: string;
  view: SourceRunView;
  requests: ProjectEvidenceRequestView[];
  onMaterialize: (input: { snapshotId: string; requestId: string; selection: SourceEvidenceSelection }) => Promise<unknown>;
  pending: boolean;
}) {
  const run = view.run;
  const csvSupported = view.records.every((record) =>
    record.snapshot.content?.kind !== "document");
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-panel p-4">
        <div className="min-w-0">
          <p className="break-all text-sm font-medium">{run.id}</p>
          <p className="mt-1 text-xs text-muted">{run.categoryCode} · {run.snapshotCount} 条快照 · {run.status === "running" ? "运行中" : `结束于 ${formatTime(run.finishedAt)}`}</p>
          {run.terminationReason && <p className="mt-2 text-xs text-danger">{run.terminationReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="button-secondary" href={sourceRunExportUrl(projectId, run.id, "jsonl")} download><Download className="h-4 w-4" aria-hidden="true" />JSONL</a>
          {csvSupported
            ? <a className="button-secondary" href={sourceRunExportUrl(projectId, run.id, "csv")} download><Download className="h-4 w-4" aria-hidden="true" />CSV</a>
            : <span className="self-center text-xs text-muted">文档运行请使用 JSONL</span>}
        </div>
      </div>
      {view.records.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-line p-5 text-sm text-muted">运行尚未提交快照。</div>
      ) : (
        <div className="mt-4 space-y-4">
          {view.records.map((record) => <SourceRecord
            key={record.snapshot.id}
            record={record}
            collectionLaneId={run.collectionLaneId}
            requests={requests}
            onMaterialize={onMaterialize}
            pending={pending}
          />)}
        </div>
      )}
    </div>
  );
}

type SourceRunView = Awaited<ReturnType<typeof fetchSourceCollectionRun>>;

function SourceRecord({
  record,
  collectionLaneId,
  requests,
  onMaterialize,
  pending,
}: {
  record: SourceSnapshotRecord;
  collectionLaneId: string;
  requests: ProjectEvidenceRequestView[];
  onMaterialize: (input: { snapshotId: string; requestId: string; selection: SourceEvidenceSelection }) => Promise<unknown>;
  pending: boolean;
}) {
  const observation = record.snapshot.observation;
  const matchingRequests = requests.filter(({ request }) =>
    request.collectionLaneIds.includes(collectionLaneId)
    && record.snapshot.knowledgeNeedIds?.includes(request.knowledgeNeed.id)
    && request.targetKeys.some((key) => record.snapshot.targetKeys?.includes(key)));
  const [requestId, setRequestId] = useState("");
  useEffect(() => {
    if (!requestId && matchingRequests[0]) setRequestId(matchingRequests[0].request.id);
  }, [matchingRequests, requestId]);
  const submit = (selection: SourceEvidenceSelection) => onMaterialize({
    snapshotId: record.snapshot.id,
    requestId,
    selection,
  });
  return (
    <article className="min-w-0 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{record.object.kind} · {record.object.externalKey}</p>
          <a className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-xs text-muted underline underline-offset-2" href={observation.finalUrl ?? observation.requestedUrl} target="_blank" rel="noreferrer">{observation.finalUrl ?? observation.requestedUrl}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" /></a>
        </div>
        <span className="status-badge">{observationLabel(observation.state)}</span>
      </div>
      {matchingRequests.length > 0 && record.snapshot.content && (
        <label className="mt-4 block text-xs font-medium">证据问题
          <select className="mt-1 min-h-10 w-full rounded-md border border-line bg-surface px-3 text-xs" value={requestId} onChange={(event) => setRequestId(event.target.value)}>
            {matchingRequests.map(({ request }) => <option key={request.id} value={request.id}>{request.question}</option>)}
          </select>
        </label>
      )}
      {record.snapshot.content
        ? <ContentView content={record.snapshot.content} onSelect={submit} disabled={!requestId || pending} />
        : <p className="mt-4 rounded-md bg-panel p-3 text-sm text-danger">{observation.failureCode ?? observation.state}{observation.httpValidation?.status ? ` · HTTP ${observation.httpValidation.status}` : ""}</p>}
      <div className="mt-4 flex flex-wrap gap-2" aria-label="知识用途范围">
        {record.snapshot.claimScopes.map((scope) => (
          <span key={scope} className="status-badge">{sourceClaimScopeLabels[scope]}</span>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        模型输入：{permissionLabel(record.snapshot.usagePermission.modelInput)} · 证据保存：{permissionLabel(record.snapshot.usagePermission.evidenceStorage)} · 派生知识发布：{permissionLabel(record.snapshot.usagePermission.derivedKnowledgePublication)}
      </p>
      {record.assets.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-xs font-medium">附件</p>
          {record.assets.map((asset) => <p key={asset.id} className="mt-2 break-all text-xs text-muted">{asset.purpose} · {asset.mediaType} · {asset.bytes} bytes · {asset.casIntegrity}</p>)}
        </div>
      )}
      <p className="mt-3 break-all text-[11px] text-muted">内容哈希：{record.snapshot.contentHash}</p>
    </article>
  );
}

function ContentView({
  content,
  onSelect,
  disabled,
}: {
  content: NonNullable<SourceSnapshotRecord["snapshot"]["content"]>;
  onSelect: (selection: SourceEvidenceSelection) => Promise<unknown>;
  disabled: boolean;
}) {
  if (content.kind === "ordered_record") {
    return <div className="mt-4 space-y-4"><h4 className="text-sm font-medium">{content.title}</h4>{content.fieldGroups.map((group, groupIndex) => <div key={`${group.label}-${groupIndex}`}><p className="text-xs font-medium text-muted">{group.label}</p><dl className="mt-2 divide-y divide-line rounded-md bg-panel px-3">{group.fields.map((field, fieldIndex) => <div key={`${field.name}-${fieldIndex}`} className="grid gap-2 py-2 text-xs sm:grid-cols-[180px_minmax(0,1fr)_auto]"><dt className="text-muted">{field.name}</dt><dd className="break-words">{field.value}{field.unit ? ` ${field.unit}` : ""}</dd><EvidenceButton disabled={disabled} onClick={() => onSelect({ kind: "ordered_field", groupIndex, fieldIndex })} /></div>)}</dl></div>)}<Blocks blocks={content.blocks} onSelect={(blockIndex, quote) => onSelect({ kind: "ordered_text_block", blockIndex, ...(quote ? { quote } : {}) })} disabled={disabled} /></div>;
  }
  if (content.kind === "document") {
    return <div className="mt-4 space-y-3"><h4 className="text-sm font-medium">{content.title}</h4><p className="text-xs text-muted">{content.publisher} · {content.version ?? "未标版本"} · {content.publicationStatus}</p>{content.sections.map((section, sectionIndex) => <section key={`${section.heading ?? "section"}-${sectionIndex}`} className="rounded-md bg-panel p-3"><h5 className="text-xs font-medium">{section.heading ?? `章节 ${sectionIndex + 1}`}</h5><Blocks blocks={section.blocks} onSelect={(blockIndex, quote) => onSelect({ kind: "document_text_block", sectionIndex, blockIndex, ...(quote ? { quote } : {}) })} disabled={disabled} /></section>)}</div>;
  }
  if (content.kind === "catalog") {
    return <div className="mt-4"><h4 className="text-sm font-medium">{content.title}</h4><p className="mt-1 text-xs text-muted">{content.taxonomyPath.join(" › ")}</p><ul className="mt-3 space-y-2">{content.entries.map((entry) => <li key={`${entry.target.externalKey}-${entry.position}`} className="rounded-md bg-panel p-3 text-xs"><span className="font-medium">{entry.position}. {entry.label}</span><span className="ml-2 text-muted">{entry.target.objectKind} · {entry.target.externalKey}</span></li>)}</ul></div>;
  }
  return <div className="mt-4"><h4 className="text-sm font-medium">{content.title}</h4><p className="mt-1 text-xs text-muted">抽样：{content.samplingPlan.method} · {content.samplingPlan.sampleSize} 条</p><div className="mt-3 space-y-2">{content.samples.map((sample) => <blockquote key={sample.externalKey} className="rounded-md bg-panel p-3 text-xs leading-5"><p>{sample.text}</p><footer className="mt-1 text-muted">样本 {sample.position}{sample.rating === undefined ? "" : ` · 评分 ${sample.rating}`}</footer></blockquote>)}</div></div>;
}

type TextQuote = { exact: string; prefix?: string; suffix?: string };

function Blocks({ blocks, onSelect, disabled }: { blocks: Extract<NonNullable<SourceSnapshotRecord["snapshot"]["content"]>, { kind: "document" }>["sections"][number]["blocks"]; onSelect: (blockIndex: number, quote?: TextQuote) => Promise<unknown>; disabled: boolean }) {
  return <div className="mt-2 space-y-2 text-xs leading-5">{blocks.map((block, index) => block.kind === "text" ? <EvidenceTextBlock key={index} text={block.text} hasLocator={Boolean(block.locator)} disabled={disabled} onSelect={(quote) => onSelect(index, quote)} /> : block.kind === "table" ? <div key={index} className="overflow-x-auto"><table className="min-w-full"><thead><tr>{block.columns.map((column) => <th key={column} className="px-2 py-1 text-left">{column}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="border-t border-line px-2 py-1">{cell}</td>)}</tr>)}</tbody></table></div> : <a key={index} className="underline underline-offset-2" href={block.sourceUrl} target="_blank" rel="noreferrer">附件：{block.role}</a>)}</div>;
}

function EvidenceTextBlock({ text, hasLocator, disabled, onSelect }: { text: string; hasLocator: boolean; disabled: boolean; onSelect: (quote?: TextQuote) => Promise<unknown> }) {
  const [exact, setExact] = useState("");
  const quote = hasLocator ? undefined : quoteFromTextSelection(text, exact);
  const invalid = !hasLocator && exact.trim().length > 0 && !quote;
  return <div className="rounded-md bg-surface p-2">
    <p className="whitespace-pre-wrap">{text}</p>
    {hasLocator ? <EvidenceButton disabled={disabled} onClick={() => onSelect()} /> : <div className="mt-3 border-t border-line pt-3">
      <label className="block text-[11px] font-medium">最小原文片段
        <textarea className="mt-1 min-h-20 w-full rounded-md border border-line bg-panel p-2 text-xs" value={exact} onChange={(event) => setExact(event.target.value)} placeholder="从上方原文复制一段能直接支撑该问题的原文；前后至少保留一侧上下文。" />
      </label>
      {invalid && <p className="mt-1 text-[11px] text-danger">片段必须原样存在于上方正文中，且不能等于整个文本块。</p>}
      <EvidenceButton disabled={disabled || !quote} onClick={() => onSelect(quote!)} />
    </div>}
  </div>;
}

export function quoteFromTextSelection(blockText: string, rawExact: string): TextQuote | undefined {
  const exact = rawExact.trim();
  if (!exact) return undefined;
  const start = blockText.indexOf(exact);
  if (start < 0) return undefined;
  const end = start + exact.length;
  const prefix = blockText.slice(Math.max(0, start - 160), start);
  const suffix = blockText.slice(end, Math.min(blockText.length, end + 160));
  // WHY：TextQuote 必须至少保留一侧上下文才能复核和消歧；整块正文不是“最小证据”。
  if (!prefix && !suffix) return undefined;
  return { exact, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) };
}

function EvidenceButton({ disabled, onClick }: { disabled: boolean; onClick: () => Promise<unknown> }) {
  return <button type="button" className="button-secondary mt-2 min-h-8 px-2 py-1 text-[11px]" disabled={disabled} onClick={() => void onClick()}><Plus className="h-3 w-3" />保存为最小证据</button>;
}

function runStatusLabel(status: string) { return ({ running: "运行中", completed: "完成", failed: "失败", stopped: "已停止" } as Record<string, string>)[status] ?? status; }
function observationLabel(state: string) { return ({ accessible: "可访问", not_found: "未找到", access_denied: "拒绝访问", login_required: "需要登录", verification_required: "需要验证", rate_limited: "已限流", source_abnormal: "来源异常" } as Record<string, string>)[state] ?? state; }
function permissionLabel(status: string) { return ({ allowed: "允许", denied: "禁止", unknown: "待核权" } as Record<string, string>)[status] ?? status; }
function formatTime(value?: string) { return value ? new Date(value).toLocaleString("zh-CN") : "未知时间"; }
