import type {
  KnowledgeConflict,
  KnowledgeReviewDecisionDraft,
  KnowledgeUnknown,
  KnowledgeValue,
} from "@domain-analysis/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Factory, HelpCircle, PackageCheck, RefreshCw, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  fetchKnowledgeBatch,
  fetchKnowledgeBatches,
  fetchKnowledgePackages,
  fetchProjectEvidence,
  fetchReviewedKnowledge,
  runKnowledgeFactory,
  buildKnowledgePackage,
  activateKnowledgePackage,
  rollbackKnowledgePackage,
  submitKnowledgeReview,
} from "../lib/api";

const recipeVersion = "knowledge-factory-evidence-candidates-v2";

export function KnowledgeFactoryPanel({
  projectId,
  categoryDefinitionVersionId,
}: {
  projectId: string;
  categoryDefinitionVersionId: string;
}) {
  const queryClient = useQueryClient();
  const [selectedBatchId, setSelectedBatchId] = useState<string>();
  const evidence = useQuery({
    queryKey: ["project-evidence", projectId],
    queryFn: () => fetchProjectEvidence(projectId),
  });
  const batches = useQuery({
    queryKey: ["knowledge-batches", projectId],
    queryFn: () => fetchKnowledgeBatches(projectId),
  });
  const detail = useQuery({
    queryKey: ["knowledge-batch", projectId, selectedBatchId],
    queryFn: () => fetchKnowledgeBatch(projectId, selectedBatchId!),
    enabled: Boolean(selectedBatchId),
  });
  const reviewed = useQuery({
    queryKey: ["reviewed-knowledge", projectId],
    queryFn: () => fetchReviewedKnowledge(projectId),
  });
  const eligibleRequestIds = evidence.data
    ?.filter(({ assessment }) => assessment.status === "sufficient")
    .map(({ request }) => request.id) ?? [];

  useEffect(() => {
    if (!selectedBatchId && batches.data?.[0]) setSelectedBatchId(batches.data[0].batch.id);
  }, [batches.data, selectedBatchId]);

  const run = useMutation({
    mutationFn: () => runKnowledgeFactory({
      projectId,
      categoryDefinitionVersionId,
      recipeVersion,
      evidenceRequestIds: eligibleRequestIds,
    }),
    onSuccess: async ({ batch }) => {
      setSelectedBatchId(batch.id);
      await queryClient.invalidateQueries({ queryKey: ["knowledge-batches", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["knowledge-batch", projectId, batch.id] });
    },
  });

  async function refresh() {
    await Promise.all([evidence.refetch(), batches.refetch(), reviewed.refetch(), detail.refetch()]);
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5 sm:p-7" aria-label="知识加工与审核">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Factory className="h-4 w-4" aria-hidden="true" />知识加工与审核</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">只处理证据充分的请求；结构化参数做确定性转换，原理与品类知识由固定模型生成带证据引用的候选，不一致形成冲突，不足则保留未知。任何结果都要人工审核后才能进入知识包。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="button-secondary" onClick={refresh}><RefreshCw className="h-4 w-4" aria-hidden="true" />刷新</button>
          <button type="button" className="button-primary" disabled={eligibleRequestIds.length === 0 || run.isPending} onClick={() => run.mutate()}>
            <Factory className="h-4 w-4" aria-hidden="true" />{run.isPending ? "加工中…" : `加工 ${eligibleRequestIds.length} 项证据`}
          </button>
        </div>
      </header>

      {eligibleRequestIds.length === 0 && !evidence.isLoading && (
        <p className="mt-4 rounded-lg border border-dashed border-line p-4 text-sm text-muted">还没有达到最低数量和独立来源要求的证据，知识工厂不会猜测答案。</p>
      )}
      {(run.error || batches.error || detail.error || reviewed.error) && (
        <p className="mt-4 text-sm text-danger" role="alert">{errorText(run.error ?? batches.error ?? detail.error ?? reviewed.error)}</p>
      )}

      {(batches.data?.length ?? 0) > 0 && (
        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-2" aria-label="知识加工批次">
            {batches.data?.map(({ batch }) => (
              <button key={batch.id} type="button" onClick={() => setSelectedBatchId(batch.id)} className={`w-full rounded-lg border p-3 text-left ${selectedBatchId === batch.id ? "border-ink bg-panel" : "border-line hover:bg-panel"}`}>
                <p className="break-all text-xs font-medium">{batch.id}</p>
                <p className="mt-2 text-xs text-muted">{batch.candidateCount} 候选 · {batch.conflictCount} 冲突 · {batch.unknownCount} 未知</p>
                <p className="mt-1 text-[11px] text-muted">{new Date(batch.finishedAt).toLocaleString("zh-CN")}</p>
              </button>
            ))}
          </div>
          <div className="min-w-0">
            {detail.isLoading && <div className="h-40 animate-pulse rounded-lg bg-panel" />}
            {detail.data && <BatchReview
              projectId={projectId}
              categoryDefinitionVersionId={categoryDefinitionVersionId}
              view={detail.data}
            />}
          </div>
        </div>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <h4 className="text-sm font-semibold">已审核知识</h4>
        <p className="mt-1 text-xs text-muted">{reviewed.data?.length ?? 0} 条；只有这里的内容有资格进入离线知识包。</p>
        <div className="mt-3 space-y-2">
          {reviewed.data?.map((entry) => (
            <div key={entry.sourceTargetId} className="rounded-md bg-panel p-3 text-xs">
              <p className="font-medium">{entry.subject.label} · {entry.predicate}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-muted">{valueText(entry.value)}</p>
            </div>
          ))}
        </div>
      </div>
      <PackageSection projectId={projectId} />
    </section>
  );
}

function PackageSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const packages = useQuery({
    queryKey: ["knowledge-packages", projectId],
    queryFn: () => fetchKnowledgePackages(projectId),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["knowledge-packages", projectId] });
  const build = useMutation({ mutationFn: () => buildKnowledgePackage(projectId), onSuccess: refresh });
  const activate = useMutation({ mutationFn: (versionHash: string) => activateKnowledgePackage(projectId, versionHash), onSuccess: refresh });
  const rollback = useMutation({ mutationFn: () => rollbackKnowledgePackage(projectId), onSuccess: refresh });
  const error = build.error ?? activate.error ?? rollback.error ?? packages.error;
  return <div className="mt-6 border-t border-line pt-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h4 className="flex items-center gap-2 text-sm font-semibold"><PackageCheck className="h-4 w-4" />离线知识包</h4><p className="mt-1 text-xs text-muted">只装入已审核状态；Runtime 只读 SQLite 单文件，不连接生产库、浏览器或模型。</p></div>
      <div className="flex gap-2"><button type="button" className="button-secondary" disabled={!packages.data?.active || rollback.isPending} onClick={() => rollback.mutate()}><RotateCcw className="h-4 w-4" />回滚</button><button type="button" className="button-primary" disabled={build.isPending} onClick={() => build.mutate()}><PackageCheck className="h-4 w-4" />{build.isPending ? "构建中…" : "构建新包"}</button></div>
    </div>
    {error && <p className="mt-3 text-sm text-danger" role="alert">{errorText(error)}</p>}
    <div className="mt-3 space-y-2">{packages.data?.items.map((item) => {
      const isActive = packages.data?.active?.versionHash === item.versionHash;
      return <div key={item.versionHash} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-panel p-3 text-xs"><div><p className="font-medium">{item.stateCount} 条状态 · {item.evidenceCount} 条证据 · {(item.bytes / 1024).toFixed(1)} KB</p><p className="mt-1 break-all text-[11px] text-muted">{item.versionHash}</p></div>{isActive ? <span className="status-badge">当前激活</span> : <button type="button" className="button-secondary" disabled={activate.isPending} onClick={() => activate.mutate(item.versionHash)}>激活</button>}</div>;
    })}</div>
  </div>;
}

function BatchReview({
  projectId,
  categoryDefinitionVersionId,
  view,
}: {
  projectId: string;
  categoryDefinitionVersionId: string;
  view: Awaited<ReturnType<typeof fetchKnowledgeBatch>>;
}) {
  const queryClient = useQueryClient();
  const decided = useMemo(
    () => new Set(view.decisions.flatMap(({ selection }) => selection.targetIds)),
    [view.decisions],
  );
  const review = useMutation({
    mutationFn: (selection: KnowledgeReviewDecisionDraft["selection"]) => submitKnowledgeReview(
      view.item.batch.id,
      {
        reviewer: "Workbench 本地审核",
        rationale: rationale(selection.action),
        grouping: { categoryDefinitionVersionId },
        selection,
      },
    ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["knowledge-batch", projectId, view.item.batch.id] }),
        queryClient.invalidateQueries({ queryKey: ["reviewed-knowledge", projectId] }),
      ]);
    },
  });
  return (
    <div className="space-y-5">
      <ReviewGroup title="待确认候选" count={view.item.candidates.length}>
        {view.item.candidates.map((candidate) => (
          <article key={candidate.id} className="rounded-lg border border-line p-4">
            <p className="text-sm font-medium">{candidate.subject.label} · {candidate.predicate}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{valueText(candidate.value)}</p>
            <p className="mt-2 text-[11px] text-muted">{candidate.evidenceIds.length} 条证据 · {candidate.knowledgeLayer}</p>
            <div className="mt-3 flex gap-2">
              <button className="button-primary" type="button" disabled={decided.has(candidate.id) || review.isPending} onClick={() => review.mutate({ action: "accept_candidates", targetIds: [candidate.id] })}><Check className="h-4 w-4" />接受</button>
              <button className="button-secondary" type="button" disabled={decided.has(candidate.id) || review.isPending} onClick={() => review.mutate({ action: "reject_candidates", targetIds: [candidate.id] })}><X className="h-4 w-4" />拒绝</button>
              {decided.has(candidate.id) && <span className="self-center text-xs text-muted">已有决定</span>}
            </div>
          </article>
        ))}
      </ReviewGroup>
      <ReviewGroup title="冲突" count={view.item.conflicts.length}>
        {view.item.conflicts.map((conflict) => <ConflictCard key={conflict.id} conflict={conflict} decided={decided.has(conflict.id)} pending={review.isPending} onSelect={(selectedAlternativeIndex) => review.mutate({ action: "resolve_conflict", targetIds: [conflict.id], selectedAlternativeIndex })} onKeep={() => review.mutate({ action: "acknowledge_conflicts", targetIds: [conflict.id] })} />)}
      </ReviewGroup>
      <ReviewGroup title="未知" count={view.item.unknowns.length}>
        {view.item.unknowns.map((unknown) => <UnknownCard key={unknown.id} unknown={unknown} decided={decided.has(unknown.id)} pending={review.isPending} onAcknowledge={() => review.mutate({ action: "acknowledge_unknowns", targetIds: [unknown.id] })} />)}
      </ReviewGroup>
      {review.error && <p className="text-sm text-danger" role="alert">{errorText(review.error)}</p>}
    </div>
  );
}

function ConflictCard({ conflict, decided, pending, onSelect, onKeep }: { conflict: KnowledgeConflict; decided: boolean; pending: boolean; onSelect: (index: number) => void; onKeep: () => void }) {
  return <article className="rounded-lg border border-warning/40 p-4"><p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4" />{conflict.subject.label} · {conflict.predicate}</p><p className="mt-1 text-xs text-muted">来源给出了不同值，系统不会自动挑一个。</p><div className="mt-3 space-y-2">{conflict.alternatives.map((alternative, index) => <button key={index} type="button" disabled={decided || pending} onClick={() => onSelect(index)} className="block w-full rounded-md border border-line bg-panel p-3 text-left text-xs hover:border-ink"><span className="font-medium">采用值 {index + 1}</span><span className="mt-1 block whitespace-pre-wrap text-muted">{valueText(alternative.value)} · {alternative.evidenceIds.length} 条证据</span></button>)}</div><button type="button" className="button-secondary mt-3" disabled={decided || pending} onClick={onKeep}>保留并发布冲突状态</button>{decided && <p className="mt-2 text-xs text-muted">已有决定</p>}</article>;
}

function UnknownCard({ unknown, decided, pending, onAcknowledge }: { unknown: KnowledgeUnknown; decided: boolean; pending: boolean; onAcknowledge: () => void }) {
  return <article className="rounded-lg border border-line p-4"><p className="flex items-center gap-2 text-sm font-medium"><HelpCircle className="h-4 w-4" />{unknown.subject.label}</p><p className="mt-2 text-xs leading-5">{unknown.question}</p><p className="mt-1 text-[11px] text-muted">原因：{unknown.reasonCode} · 检查了 {unknown.examinedEvidenceIds.length} 条证据</p><button type="button" className="button-secondary mt-3" disabled={decided || pending} onClick={onAcknowledge}>确认保留未知</button></article>;
}

function ReviewGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <section><h4 className="mb-2 text-xs font-semibold text-muted">{title} · {count}</h4>{count === 0 ? <p className="rounded-md bg-panel p-3 text-xs text-muted">无</p> : <div className="space-y-3">{children}</div>}</section>;
}

function valueText(value: KnowledgeValue) {
  if (value.kind === "subject_ref") return `${value.subject.label} (${value.subject.key})`;
  if (value.kind === "decimal") return `${value.raw} → ${value.value} ${value.unitCode}`;
  if (value.kind === "boolean" || value.kind === "enum") return `${value.raw} → ${String(value.value)}`;
  return value.normalized ? `${value.raw}\n标准化：${value.normalized}` : value.raw;
}

function rationale(action: KnowledgeReviewDecisionDraft["selection"]["action"]) {
  return ({ accept_candidates: "人工确认候选与证据一致", reject_candidates: "人工确认候选不应发布", resolve_conflict: "人工选择冲突值", acknowledge_conflicts: "人工确认冲突应作为冲突状态发布", acknowledge_unknowns: "人工确认当前证据仍不足" } as const)[action];
}

function errorText(error: unknown) { return error instanceof Error ? error.message : "知识加工失败，请检查本地服务。"; }
