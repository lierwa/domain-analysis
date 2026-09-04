import {
  multiSourcePlanningAuditSchema,
  type CaptureTask,
  type CrawlPlanningEvent,
  type InterviewMessageTimelinePart,
  type SourceCollectionBatch,
} from "@domain-analysis/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { confirmCrawlPlan, fetchCrawlPlanning, fetchSourceCollectionRuns,
  streamCrawlPlanningRun } from "../lib/api";

export function CrawlPlanningPanel({ task }: { task: CaptureTask }) {
  const queryClient = useQueryClient();
  const planning = useQuery({
    queryKey: ["crawl-planning", task.id],
    queryFn: () => fetchCrawlPlanning(task.id),
  });
  const dataset = useQuery({ queryKey: ["source-runs", task.id],
    queryFn: () => fetchSourceCollectionRuns(task.id) });
  const [isRunning, setIsRunning] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [liveParts, setLiveParts] = useState<InterviewMessageTimelinePart[]>([]);
  const [error, setError] = useState<string>();

  async function start() {
    if (isRunning) return;
    setError(undefined);
    setLiveParts([]);
    setIsRunning(true);
    try {
      await streamCrawlPlanningRun(task.id, task.revision, (event) => {
        setLiveParts((parts) => projectLiveEvent(parts, event));
        if (event.type === "run.failed" || event.type === "stream.failed") setError(event.error);
      });
      await planning.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "资料缺口检查启动失败");
    } finally {
      setIsRunning(false);
    }
  }

  async function confirm(planId: string) {
    if (isConfirming) return;
    setError(undefined);
    setIsConfirming(true);
    try {
      const view = await confirmCrawlPlan(task.id, planId, task.revision);
      queryClient.setQueryData(["crawl-planning", task.id], view);
      await queryClient.invalidateQueries({ queryKey: ["source-runs", task.id] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "采集方案确认失败");
    } finally {
      setIsConfirming(false);
    }
  }

  if (planning.isLoading) return <PlanningShell><p className="text-sm text-muted">正在读取抓取计划…</p></PlanningShell>;
  if (planning.isError || !planning.data) return <PlanningShell>
    <button type="button" className="button-secondary" onClick={() => void planning.refetch()}>
      <RefreshCw className="h-4 w-4" />重新读取抓取计划
    </button>
  </PlanningShell>;

  const latestRun = planning.data.runs[0];
  const currentPlan = planning.data.plans.find((plan) => plan.status === "draft")
    ?? planning.data.plans.find((plan) => plan.status === "confirmed");
  const visibleParts = isRunning ? liveParts : latestRun?.timelineParts ?? [];
  return <PlanningShell>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-sm font-semibold">第二步：制定采集方案</p>
        <p className="mt-1 text-xs leading-5 text-muted">系统按当前资料缺口决定本次要抓哪些入口；确认后仍需单独创建执行批次。</p>
      </div>
      <button type="button" className="button-primary" disabled={isRunning}
        onClick={() => void start()}>
        {isRunning ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        {isRunning ? "正在检查…" : currentPlan ? "重新检查资料缺口" : "检查资料缺口"}
      </button>
    </div>
    {visibleParts.length > 0 && <PlanningTimeline parts={visibleParts} />}
    {currentPlan && <PlanDraftCard plan={currentPlan}
      batch={dataset.data?.batches.find((batch) => batch.sourceCollectionPlanId === currentPlan.id
        && batch.sourceCollectionPlanVersion === currentPlan.version)} confirming={isConfirming}
      onConfirm={() => void confirm(currentPlan.id)} />}
    {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
  </PlanningShell>;
}

function PlanningShell({ children }: { children: React.ReactNode }) {
  return <section className="mt-5 rounded-xl border border-line bg-surface p-5 sm:p-7">{children}</section>;
}

function PlanningTimeline({ parts }: { parts: InterviewMessageTimelinePart[] }) {
  return <div className="mt-5 space-y-2 border-l-2 border-line pl-4">
    {parts.filter((part) => part.type !== "text" || !part.text.trimStart().startsWith("{")).map((part, index) => part.type === "text"
      ? <p key={`text-${index}`} className="text-sm leading-6 text-ink">{part.text}</p>
      : <div key={`${part.activity.id}-${index}`} className="flex items-center gap-2 text-xs text-muted">
        {part.activity.status === "running"
          ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          : <Check className="h-3.5 w-3.5" />}
        <span>{part.activity.label}</span>
        {part.activity.urls?.length ? <span>· {part.activity.urls.length} 个入口</span> : null}
      </div>)}
  </div>;
}

function PlanDraftCard({ plan, batch, confirming, onConfirm }: {
  plan: Awaited<ReturnType<typeof fetchCrawlPlanning>>["plans"][number];
  batch?: SourceCollectionBatch;
  confirming: boolean;
  onConfirm: () => void;
}) {
  const audit = useMemo(() => multiSourcePlanningAuditSchema.safeParse(plan.content.researchAudit), [plan]);
  const completedCatalog = audit.success && audit.data.productCatalog.kind === "completed_source_reference"
    ? audit.data.productCatalog : undefined;
  const facts = audit.success && audit.data.productCatalog.kind !== "completed_source_reference"
    ? audit.data.productCatalog : undefined;
  const publicResearch = audit.success ? audit.data.publicSourceResearch : undefined;
  const confirmationBlockers = [
    ...(plan.content.executionChecklistVersion === 7 ? [] : ["当前草稿需要按现行多来源规划协议重新规划"]),
    ...(audit.success && audit.data.priorCoverage ? [] : ["当前草稿缺少资料覆盖快照"]),
    ...(audit.success ? [] : ["当前草稿缺少可验证的多来源规划审计"]),
    ...plan.content.planningBlockers,
  ];
  return <article className="mt-5 rounded-lg border border-line bg-panel p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-medium text-muted">采集方案 v{plan.version} · 抓取范围修订 v{plan.taskRevision}</p>
        <h3 className="mt-1 text-base font-semibold">{plan.content.summary}</h3>
      </div>
      <span className="status-badge">{plan.status === "draft" ? "方案待确认" : batch
        ? batchStatus(batch.status) : "已确认，尚未执行"}</span>
    </div>
    {audit.success && <>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {completedCatalog && <Metric label="ZOL 商品数据" value="已完成，本次跳过" />}
        {facts?.rankingStatus === "verified" ? <>
          <Metric label="榜单行" value={facts.rankingRows.length} />
          <Metric label="执行品牌" value={facts.executionBrands.length} />
          <Metric label="品牌批次" value={facts.brandBatchSize} />
          <Metric label="每轮型号" value={facts.modelsPerBrandPerRound} />
          <Metric label="每品牌上限" value={facts.maxModelsPerBrand} />
        </> : facts ? <Metric label="排行榜状态" value="待核实" attention /> : null}
        {publicResearch && <>
          <Metric label="专业主题" value={publicResearch.topics.length} />
          <Metric label="公开来源" value={publicResearch.sources.length} />
          <Metric label="受阻线索" value={publicResearch.blocked.length}
            attention={publicResearch.blocked.length > 0} />
        </>}
        {audit.data.priorCoverage && <>
          <Metric label="已接受资料" value={audit.data.priorCoverage.acceptedSources.length} />
          <Metric label="待补缺口" value={audit.data.priorCoverage.gaps.length}
            attention={audit.data.priorCoverage.gaps.length > 0} />
        </>}
      </dl>
      {audit.data.priorCoverage && <details className="mt-4 rounded-lg border border-line bg-surface p-3">
        <summary className="cursor-pointer text-sm font-medium">查看规划前的全部资料覆盖</summary>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
          {audit.data.priorCoverage.families.map((item) => <li key={item.key}>
            {coverageLabels[item.key] ?? item.key}：{item.acceptedSourceCount}/{item.minimumAcceptedSources} 条，
            {item.distinctOriginCount}/{item.minimumDistinctOrigins} 个网站
          </li>)}
          {audit.data.priorCoverage.facets.map((item) => <li key={item.key}>
            {coverageLabels[item.key] ?? item.key}：{item.acceptedSourceCount}/{item.minimumAcceptedSources} 条，
            {item.distinctOriginCount}/{item.minimumDistinctOrigins} 个网站
          </li>)}
        </ul>
      </details>}
      {facts?.rankingStatus === "verified" ? <>
        <p className="mt-4 text-xs text-muted">榜单证据：<a href={facts.rankingUrl} target="_blank" rel="noreferrer"
          className="text-ink underline decoration-line underline-offset-4">{facts.rankingUrl}</a> · {new Date(facts.observedAt).toLocaleString()}</p>
        <p className="mt-4 text-sm leading-6 text-muted">综合评分大于 {facts.selectionPolicy.minimumScoreExclusive}，按榜单顺序最多 {facts.selectionPolicy.maxBrands} 个品牌；每批 {facts.brandBatchSize} 个，每品牌每轮 {facts.modelsPerBrandPerRound} 个，最多 {facts.maxModelsPerBrand} 个型号。最大执行容量 {facts.estimatedModelCapacity.toLocaleString()} 个型号。</p>
        <details className="mt-4 rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer text-sm font-medium">查看 {facts.executionBrands.length} 个执行品牌</summary>
          <div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {facts.executionBrands.map((brand) => <a key={brand.key} href={brand.catalogUrl}
              target="_blank" rel="noreferrer" className="truncate text-sm text-ink underline decoration-line underline-offset-4">
              {brand.name} <span className="text-muted">({brand.key})</span>
            </a>)}
          </div>
        </details>
        {facts.blockedSelectedBrands.length > 0 && <details className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
          <summary className="cursor-pointer text-sm font-medium">查看 {facts.blockedSelectedBrands.length} 个入选但待映射品牌</summary>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
            {facts.blockedSelectedBrands.map((brand) => <li key={`${brand.rank}-${brand.name}`}>第 {brand.rank} 名 {brand.name}：{brand.reason}</li>)}
          </ul>
        </details>}
      </> : facts ? <p className="mt-4 text-sm leading-6 text-muted">{facts.rankingReason}</p> : null}
      {completedCatalog && <p className="mt-4 text-sm leading-6 text-muted">
        商品目录沿用已验收批次 {completedCatalog.sourceBatchId}；本方案只补抓资料缺口。
      </p>}
      {batch && <p className="mt-3 text-sm font-medium text-ink">
        执行批次 {batch.id.slice(-8)} · {batchStatus(batch.status)} · {batch.plannedSourceCount} 个计划来源
      </p>}
      {publicResearch && publicResearch.sources.length > 0 && <details className="mt-4 rounded-lg border border-line bg-surface p-3">
        <summary className="cursor-pointer text-sm font-medium">查看 {publicResearch.sources.length} 个标准、专业技术与品牌公开入口</summary>
        <div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2">
          {publicResearch.sources.map((source) => <a key={source.key} href={source.url}
            target="_blank" rel="noreferrer" className="truncate text-sm text-ink underline decoration-line underline-offset-4">
            {source.name}
          </a>)}
        </div>
      </details>}
      {publicResearch && publicResearch.blocked.length > 0 && <details className="mt-4 rounded-lg border border-warning/40 bg-warning/5 p-3">
        <summary className="cursor-pointer text-sm font-medium">查看 {publicResearch.blocked.length} 条未取得入口记录</summary>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
          {publicResearch.blocked.map((item, index) => <li key={`${item.sourceKind}-${index}`}>
            <span className="font-medium text-ink">{publicSourceKindLabels[item.sourceKind] ?? item.sourceKind}：</span>
            {item.query}；{item.reason}
          </li>)}
        </ul>
      </details>}
    </>}
    {confirmationBlockers.length > 0 && <div className="mt-4 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <p className="text-sm font-medium">计划保持待确认</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
        {confirmationBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
      </ul>
    </div>}
    {plan.status === "draft" && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
      <p className="text-xs text-muted">{confirmationBlockers.length > 0
        ? "多来源执行范围核实后才能确认。"
        : "确认后会保留这份方案，执行批次仍由下一步单独创建。"}</p>
      <button type="button" className="button-primary" disabled={confirming || confirmationBlockers.length > 0} onClick={onConfirm}>
        {confirming ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
        {confirming ? "正在确认…" : confirmationBlockers.length > 0 ? "等待核实" : "确认采集方案"}
      </button>
    </div>}
  </article>;
}

const publicSourceKindLabels: Record<string, string> = {
  regulator: "监管机构",
  standards_body: "标准机构",
  technical_publisher: "专业技术机构",
  industry_organization: "行业组织",
  brand_official: "品牌公开资料",
};

const coverageLabels: Record<string, string> = {
  standards_and_regulation: "标准与监管来源",
  professional_technical: "专业技术来源",
  brand_official: "品牌官方来源",
  operating_principle: "运行原理主题入口",
  core_components: "核心部件主题入口",
  safety_and_regulation: "安全与法规主题入口",
  performance_and_testing: "性能与测试主题入口",
  use_and_maintenance: "使用与维护主题入口",
};

function Metric({ label, value, attention = false }: { label: string; value: number | string; attention?: boolean }) {
  return <div className="rounded-lg border border-line bg-surface px-3 py-2">
    <dt className="text-xs text-muted">{label}</dt>
    <dd className={`mt-1 text-lg font-semibold ${attention ? "text-danger" : "text-ink"}`}>{value}</dd>
  </div>;
}

function batchStatus(status: SourceCollectionBatch["status"]) {
  return ({ running: "执行中", completed: "执行完成", partial: "部分完成", failed: "执行失败", stopped: "已停止" } as const)[status];
}

function projectLiveEvent(parts: InterviewMessageTimelinePart[], event: CrawlPlanningEvent) {
  if (event.type === "assistant.delta") {
    const last = parts.at(-1);
    return last?.type === "text"
      ? parts.map((part, index) => index === parts.length - 1 && part.type === "text"
        ? { type: "text" as const, text: part.text + event.delta } : part)
      : [...parts, { type: "text" as const, text: event.delta }];
  }
  if (event.type === "run.activity") {
    const existing = parts.findIndex((part) => part.type === "activity"
      && part.activity.id === event.activity.id);
    return existing < 0 ? [...parts, { type: "activity" as const, activity: event.activity }]
      : parts.map((part, index) => index === existing
        ? { type: "activity" as const, activity: event.activity } : part);
  }
  if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.interrupted") {
    return event.run.timelineParts;
  }
  return parts;
}
