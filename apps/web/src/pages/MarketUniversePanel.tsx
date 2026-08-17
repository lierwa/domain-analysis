import type { MarketUniverseVersion, RegulatoryReconciliationRun } from "@domain-analysis/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertTriangle, Check, DatabaseZap, ExternalLink, RefreshCw, ShieldCheck, Square } from "lucide-react";

import {
  cancelRegulatoryReconciliation,
  confirmMarketUniverse,
  fetchLatestRegulatoryReconciliation,
  fetchMarketUniverse,
  fetchRegulatoryReconciliation,
  refreshMarketUniverse,
  startRegulatoryReconciliation,
} from "../lib/api";

export function MarketUniversePanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [regulatoryRunId, setRegulatoryRunId] = useState<string>();
  const universe = useQuery({
    queryKey: ["market-universe", projectId],
    queryFn: () => fetchMarketUniverse(projectId),
  });
  const latestRegulatoryRun = useQuery({
    queryKey: ["market-universe-regulatory-latest", projectId],
    queryFn: () => fetchLatestRegulatoryReconciliation(projectId),
  });
  const refresh = useMutation({
    mutationFn: () => refreshMarketUniverse(projectId),
    onSuccess: (item) => queryClient.setQueryData(["market-universe", projectId], item),
  });
  const confirm = useMutation({
    mutationFn: (item: MarketUniverseVersion) => confirmMarketUniverse(
      projectId,
      item.version,
      item.contentHash,
    ),
    onSuccess: (item) => queryClient.setQueryData(["market-universe", projectId], item),
  });
  const startRegulatory = useMutation({
    mutationFn: () => startRegulatoryReconciliation(projectId),
    onSuccess: (run) => {
      queryClient.setQueryData(["market-universe-regulatory-latest", projectId], run);
      setRegulatoryRunId(run.id);
    },
  });
  const regulatoryRun = useQuery({
    queryKey: ["market-universe-regulatory", projectId, regulatoryRunId],
    queryFn: () => fetchRegulatoryReconciliation(projectId, regulatoryRunId!),
    enabled: Boolean(regulatoryRunId),
    refetchInterval: (query) => isTerminalRun(query.state.data) ? false : 1_000,
  });
  const cancelRegulatory = useMutation({
    mutationFn: () => cancelRegulatoryReconciliation(projectId, regulatoryRunId!),
    onSuccess: (run) => {
      queryClient.setQueryData(["market-universe-regulatory-latest", projectId], run);
      queryClient.setQueryData(["market-universe-regulatory", projectId, regulatoryRunId], run);
    },
  });
  const currentRegulatoryRun = regulatoryRun.data ?? latestRegulatoryRun.data ?? undefined;

  useEffect(() => {
    if (latestRegulatoryRun.data) setRegulatoryRunId(latestRegulatoryRun.data.id);
  }, [latestRegulatoryRun.data]);

  useEffect(() => {
    if (currentRegulatoryRun?.lifecycleStatus === "succeeded") {
      void queryClient.invalidateQueries({ queryKey: ["market-universe", projectId] });
    }
  }, [projectId, queryClient, currentRegulatoryRun?.lifecycleStatus]);

  return (
    <section className="rounded-xl border border-line bg-surface px-7 pb-8 pt-6" aria-labelledby="market-universe-title">
      <header className="flex items-start justify-between gap-8 border-b border-line pb-5">
        <div>
          <p className="text-xs font-medium tracking-[0.12em] text-muted">研究阶段 1 · 市场总体</p>
          <h3 id="market-universe-title" className="mt-2 flex items-center gap-2 text-lg font-semibold tracking-tight">
            <DatabaseZap className="h-4 w-4" aria-hidden="true" />型号覆盖基线
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            先审核品牌、厂商型号、产品类别和来源覆盖，再冻结批量采集的唯一分母。销售链接只作为来源观察，不等于新增型号。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {universe.data?.status === "candidate" && (
            <button
              type="button"
              className="button-secondary"
              onClick={() => startRegulatory.mutate()}
              disabled={startRegulatory.isPending || isActiveRun(currentRegulatoryRun)}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              {startRegulatory.isPending || isActiveRun(currentRegulatoryRun) ? "监管对账中" : "运行监管对账"}
            </button>
          )}
          <button
            type="button"
            className="button-primary transition-transform active:translate-y-px"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending || isActiveRun(currentRegulatoryRun)}
            aria-label="重新枚举官方目录"
          >
            <RefreshCw className={`h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            {refresh.isPending ? "正在读取来源…" : universe.data ? "生成新候选" : "建立候选总体"}
          </button>
        </div>
      </header>

      {currentRegulatoryRun && (
        <RegulatoryProgress
          run={currentRegulatoryRun}
          cancelling={cancelRegulatory.isPending}
          onCancel={() => cancelRegulatory.mutate()}
        />
      )}
      {(universe.isLoading || refresh.isPending) && !universe.data && <UniverseSkeleton />}
      {(universe.isError || latestRegulatoryRun.isError || refresh.isError || confirm.isError || startRegulatory.isError || regulatoryRun.isError || cancelRegulatory.isError) && (
        <p className="mt-5 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          {mutationError(cancelRegulatory.error ?? regulatoryRun.error ?? startRegulatory.error ?? confirm.error ?? refresh.error ?? latestRegulatoryRun.error ?? universe.error)}
        </p>
      )}
      {!universe.isLoading && !universe.data && !refresh.isPending && !refresh.isError && (
        <div className="mt-6 border-l-2 border-line py-2 pl-5">
          <p className="text-sm font-medium">还没有可审核的市场总体</p>
          <p className="mt-1 text-sm leading-6 text-muted">建立候选后，这里会显示来源完整性、型号身份和分类缺口；系统不会把抓到的 URL 数量当覆盖率。</p>
        </div>
      )}
      {universe.data && <UniverseResult universe={universe.data} onConfirm={() => confirm.mutate(universe.data!)} confirming={confirm.isPending} />}
    </section>
  );
}

function RegulatoryProgress({
  run,
  cancelling,
  onCancel,
}: {
  run: RegulatoryReconciliationRun;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const percent = run.totalModels === 0 ? 0 : Math.round(run.completedModels / run.totalModels * 100);
  return (
    <div className="mt-5 rounded-lg border border-line bg-panel px-5 py-4" aria-live="polite">
      <div className="flex items-center justify-between gap-5">
        <div>
          <p className="text-sm font-semibold">监管型号对账 · {runStatusLabel(run.lifecycleStatus)}</p>
          <p className="mt-1 text-xs text-muted">
            {run.completedModels} / {run.totalModels} · 命中 {run.matchedModels} · 未查到 {run.notFoundModels} · 冲突 {run.producerConflictModels} · 失败 {run.failedModels}
          </p>
        </div>
        {isActiveRun(run) && (
          <button type="button" className="button-secondary" onClick={onCancel} disabled={cancelling}>
            <Square className="h-3.5 w-3.5" aria-hidden="true" />{cancelling ? "正在停止…" : "停止"}
          </button>
        )}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line/60">
        <div className="h-full bg-ink transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function isActiveRun(run?: RegulatoryReconciliationRun) {
  return run?.lifecycleStatus === "queued" || run?.lifecycleStatus === "running";
}

function isTerminalRun(run?: RegulatoryReconciliationRun) {
  return Boolean(run && !isActiveRun(run));
}

function runStatusLabel(status: RegulatoryReconciliationRun["lifecycleStatus"]) {
  if (status === "queued") return "排队中";
  if (status === "running") return "逐型号核验中";
  if (status === "succeeded") return "已生成新候选";
  if (status === "cancelled") return "已停止";
  return "失败";
}

function UniverseResult({
  universe,
  onConfirm,
  confirming,
}: {
  universe: MarketUniverseVersion;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const brands = new Map(universe.models.map((model) => [model.brand.key, model.brand.label]));
  const independentlyCoveredBrands = new Set(universe.sources
    .filter((source) => source.coverageKind === "independent_brand_catalog" && source.coverageStatus === "complete")
    .flatMap((source) => source.observedBrandKeys));
  const verifiedModels = universe.models.filter((model) => model.identityStatus === "confirmed").length;
  const observations = universe.sources.reduce((sum, source) => sum + source.acceptedItemCount, 0);
  const blockers = confirmationBlockers(universe);
  const confirmed = universe.status === "confirmed";

  return (
    <div className="mt-6 space-y-7">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-8 rounded-lg bg-panel px-5 py-4">
        <div>
          <p className="text-sm font-semibold">
            {confirmed ? `已确认版本 v${universe.version}` : `候选版本 v${universe.version}`}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">
            观察窗口 {formatTime(universe.observationStartedAt)} — {formatTime(universe.observationEndedAt)}
          </p>
        </div>
        {confirmed ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success"><Check className="h-4 w-4" />已冻结为采集分母</span>
        ) : (
          <button type="button" className="button-primary" onClick={onConfirm} disabled={blockers.length > 0 || confirming}>
            {confirming ? "正在确认…" : blockers.length > 0 ? `${blockers.length} 类阻塞未解决` : "确认并冻结版本"}
          </button>
        )}
      </div>

      <dl className="flex divide-x divide-line border-y border-line py-4">
        <Metric label="唯一产品型号" value={universe.models.length} />
        <Metric label="品牌身份 / 独立官网" value={brands.size} suffix={`/ ${independentlyCoveredBrands.size}`} />
        <Metric label="已核验型号" value={verifiedModels} suffix={`/ ${universe.models.length}`} />
        <Metric label="来源观察行" value={observations} />
      </dl>

      <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.75fr)] gap-7">
        <div className="min-w-0 space-y-7">
          <CoverageDimensions universe={universe} />
          <SourceReconciliation universe={universe} />
          <ModelSample universe={universe} />
        </div>
        <AuditColumn universe={universe} blockers={blockers} />
      </div>
    </div>
  );
}

function CoverageDimensions({ universe }: { universe: MarketUniverseVersion }) {
  return (
    <section aria-labelledby="universe-dimension-title">
      <SectionTitle id="universe-dimension-title" title="覆盖维度" note="每个维度分别计算已分类、未知和不适用，不能混成一个型号数量。" />
      <div className="mt-3 divide-y divide-line border-y border-line">
        {universe.coverageDimensions.map((dimension) => {
          const values = universe.models.map((model) => model.classifications.find((item) => item.dimensionCode === dimension.code));
          const classified = values.filter((item) => item?.status === "classified").length;
          const unknown = values.filter((item) => item?.status === "unknown").length;
          const notApplicable = values.filter((item) => item?.status === "not_applicable").length;
          return (
            <div key={dimension.code} className="grid grid-cols-[minmax(12rem,1fr)_repeat(3,6.5rem)] items-center gap-3 py-3 text-sm">
              <div><p className="font-medium">{dimension.label}</p><p className="mt-0.5 text-xs text-muted">{dimension.taxonomyVersion}{dimension.requiredForConfirmation ? " · 确认必填" : ""}</p></div>
              <Count label="已分类" value={classified} />
              <Count label="未知" value={unknown} warning={unknown > 0} />
              <Count label="不适用" value={notApplicable} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SourceReconciliation({ universe }: { universe: MarketUniverseVersion }) {
  return (
    <section aria-labelledby="universe-source-title">
      <SectionTitle id="universe-source-title" title="来源对账" note="声明行、读取行、接收观察和唯一型号分别记录。" />
      <div className="mt-3 overflow-hidden rounded-md border border-line">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="bg-panel text-xs text-muted"><tr><th className="px-4 py-3 font-medium">来源</th><th className="px-3 py-3 font-medium">职责</th><th className="px-3 py-3 font-medium">覆盖</th><th className="px-3 py-3 font-medium">声明</th><th className="px-3 py-3 font-medium">读取</th><th className="px-3 py-3 font-medium">接收</th><th className="px-3 py-3 font-medium">唯一型号</th></tr></thead>
          <tbody>{universe.sources.map((source) => <tr key={source.sourceId} className="border-t border-line"><td className="px-4 py-3"><a className="inline-flex items-center gap-1 font-medium underline decoration-line underline-offset-4" href={source.catalogUrl} target="_blank" rel="noreferrer">{sourceLabel(source.sourceId)}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a></td><td className="px-3 py-3">{sourceKindLabel(source.coverageKind)}</td><td className="px-3 py-3">{source.coverageStatus === "complete" ? "完整读取" : "部分读取"}</td><td className="px-3 py-3 tabular-nums">{source.declaredItemCount}</td><td className="px-3 py-3 tabular-nums">{source.fetchedItemCount}</td><td className="px-3 py-3 tabular-nums">{source.acceptedItemCount}</td><td className="px-3 py-3 font-semibold tabular-nums">{source.uniqueModelCount}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function ModelSample({ universe }: { universe: MarketUniverseVersion }) {
  const models = universe.models.slice(0, 8);
  return (
    <section aria-labelledby="universe-model-title">
      <SectionTitle id="universe-model-title" title="型号审阅样本" note={`显示前 ${models.length} 个，共 ${universe.models.length} 个；品牌与生产者分开保存。`} />
      <div className="mt-3 divide-y divide-line border-y border-line">
        {models.map((model) => <div key={model.key} className="grid grid-cols-[9rem_minmax(12rem,1fr)_8rem_6rem] items-center gap-3 py-3 text-sm"><span>{model.brand.label}</span><span className="font-mono font-medium">{model.manufacturerModel}</span><span className="text-muted">{model.regulatoryProducers[0]?.label ?? "生产者待核"}</span><span className={model.identityStatus === "confirmed" ? "text-success" : "text-warning"}>{model.identityStatus === "confirmed" ? "已核验" : "待核验"}</span></div>)}
      </div>
    </section>
  );
}

function AuditColumn({ universe, blockers }: { universe: MarketUniverseVersion; blockers: string[] }) {
  return (
    <aside className="border-l border-line pl-6" aria-labelledby="universe-audit-title">
      <h4 id="universe-audit-title" className="text-sm font-semibold">冻结门检查</h4>
      <p className="mt-1 text-xs leading-5 text-muted">只有身份、必填分类和来源缺口都处理完，候选才能成为批量采集分母。</p>
      {blockers.length === 0 ? <p className="mt-4 flex items-center gap-2 text-sm text-success"><Check className="h-4 w-4" />当前候选满足确认门</p> : <ul className="mt-4 space-y-3">{blockers.map((item) => <li key={item} className="flex gap-2 text-sm leading-6"><AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-warning" aria-hidden="true" /><span>{item}</span></li>)}</ul>}
      {universe.unknowns.length > 0 && <div className="mt-6 border-t border-line pt-5"><p className="text-xs font-medium text-muted">结构化未知项</p><ul className="mt-3 space-y-3">{universe.unknowns.map((item) => <li key={item.key} className="text-sm leading-6"><span className="font-medium">{scopeLabel(item.scope)}</span><span className="text-muted"> · {item.description}</span></li>)}</ul></div>}
    </aside>
  );
}

function confirmationBlockers(universe: MarketUniverseVersion) {
  const blockers: string[] = [];
  if (universe.unknowns.some((item) => item.blocking)) blockers.push("仍有阻塞未知项");
  if (universe.models.some((model) => model.identityStatus === "unconfirmed")) blockers.push("仍有型号身份未核验");
  const required = new Set(universe.coverageDimensions.filter((item) => item.requiredForConfirmation).map((item) => item.code));
  if (universe.models.some((model) => model.classifications.some((item) => required.has(item.dimensionCode) && item.status === "unknown"))) blockers.push("确认必填分类仍有未知值");
  return blockers;
}

function Metric({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return <div className="min-w-[9rem] flex-1 px-5 first:pl-0"><dd className="text-2xl font-semibold tracking-tight tabular-nums">{value}<span className="ml-1 text-sm font-normal text-muted">{suffix}</span></dd><dt className="mt-1 text-xs text-muted">{label}</dt></div>;
}

function Count({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div><p className={`font-semibold tabular-nums ${warning ? "text-warning" : ""}`}>{value}</p><p className="text-xs text-muted">{label}</p></div>;
}

function SectionTitle({ id, title, note }: { id: string; title: string; note: string }) {
  return <div><h4 id={id} className="text-sm font-semibold">{title}</h4><p className="mt-1 text-xs leading-5 text-muted">{note}</p></div>;
}

function UniverseSkeleton() {
  return <div className="mt-6 space-y-5" aria-label="正在读取市场总体"><div className="h-16 animate-pulse rounded-lg bg-line/40" /><div className="h-20 animate-pulse border-y border-line bg-line/20" /><div className="grid grid-cols-[1.5fr_0.75fr] gap-7"><div className="h-72 animate-pulse rounded-md bg-line/30" /><div className="h-48 animate-pulse rounded-md bg-line/20" /></div></div>;
}

function sourceLabel(sourceId: string) {
  if (sourceId.startsWith("haier")) return "海尔中国官方目录";
  if (sourceId.startsWith("leader")) return "统帅中国官方目录";
  if (sourceId.startsWith("midea")) return "美的官方商城目录";
  if (sourceId.startsWith("tcl")) return "TCL 中国官方目录";
  if (sourceId.startsWith("hisense-group")) return "海信集团官方目录";
  if (sourceId.startsWith("meiling")) return "美菱官方商城目录";
  if (sourceId.startsWith("konka-group")) return "康佳集团官方冰箱目录";
  if (sourceId.startsWith("siemens")) return "西门子中国在售目录";
  if (sourceId.startsWith("royalstar")) return "荣事达集团官网当前产品";
  if (sourceId.startsWith("jd-cn")) return "京东自营冰箱频道";
  return sourceId;
}

function sourceKindLabel(kind: MarketUniverseVersion["sources"][number]["coverageKind"]) {
  if (kind === "independent_brand_catalog") return "独立品牌官网";
  if (kind === "multi_brand_official_catalog") return "多品牌官方商城";
  if (kind === "regulatory_registry_lookup") return "监管交叉";
  return "官方渠道发现";
}

function scopeLabel(scope: MarketUniverseVersion["unknowns"][number]["scope"]) {
  if (scope.type === "market") return "市场范围";
  if (scope.type === "source") return `来源 ${scope.sourceId}`;
  if (scope.type === "brand") return `品牌 ${scope.brandKey}`;
  if (scope.type === "model") return `型号 ${scope.modelKey}`;
  return `型号维度 ${scope.dimensionCode}`;
}

function mutationError(error: unknown) {
  return error instanceof Error ? error.message : "市场总体操作失败，请检查本地 API 与来源访问状态。";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
