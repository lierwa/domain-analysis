import {
  appendInterviewTimelineActivity,
  appendInterviewTimelineText,
  failInterviewTimeline,
  type CaptureTask,
  type CrawlPlan,
  type CrawlPlanningEvent,
  type InterviewMessageTimelinePart,
  type SourcePreparation,
} from "@domain-analysis/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  confirmCrawlPlan,
  fetchCrawlPlanning,
  prepareCrawlPlan,
  startSourceBatch,
  streamCrawlPlanningRun,
} from "../lib/api";
import { formatDateTime } from "../lib/format";
import { InterviewActivity } from "./InterviewThread";
import { collapseWebSearchActivities } from "./interviewTimelineModel";
import { CrawlPlanningResearchAuditCard } from "./CrawlPlanningResearchAuditCard";

export function CrawlPlanningPanel({ task }: { task: CaptureTask }) {
  const queryClient = useQueryClient();
  const queryKey = ["crawl-planning", task.id] as const;
  const planning = useQuery({
    queryKey,
    queryFn: () => fetchCrawlPlanning(task.id),
    refetchInterval: (query) => query.state.data?.runs[0]?.status === "running" ? 1_000 : false,
  });
  const [instruction, setInstruction] = useState("");
  const [liveParts, setLiveParts] = useState<InterviewMessageTimelinePart[]>();
  const [runError, setRunError] = useState<string>();
  const [isRunning, setIsRunning] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [preparation, setPreparation] = useState<SourcePreparation>();
  const [isPreparing, setIsPreparing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionAccepted, setExecutionAccepted] = useState<string>();
  const abortRef = useRef<AbortController>();

  useEffect(() => () => abortRef.current?.abort(), []);
  const activePlanId = planning.data?.plans[0]?.id;
  useEffect(() => setPreparation(undefined), [task.id, activePlanId]);

  async function runPlanning() {
    setRunError(undefined);
    setLiveParts(undefined);
    setIsRunning(true);
    const abortController = new AbortController();
    abortRef.current = abortController;
    try {
      await streamCrawlPlanningRun(task.id, {
        expectedTaskRevision: task.revision,
        ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
      }, handleEvent, abortController.signal);
      await planning.refetch();
      setInstruction("");
    } catch (error) {
      if (!abortController.signal.aborted) {
        setRunError(error instanceof Error ? error.message : "抓取计划生成失败");
      }
      await planning.refetch();
    } finally {
      if (abortRef.current === abortController) abortRef.current = undefined;
      setIsRunning(false);
      setLiveParts(undefined);
    }
  }

  function handleEvent(event: CrawlPlanningEvent) {
    if (event.type === "run.started") {
      void planning.refetch();
    } else if (event.type === "run.activity") {
      setLiveParts((current = []) => appendInterviewTimelineActivity(current, event.activity));
    } else if (event.type === "assistant.delta") {
      setLiveParts((current = []) => appendInterviewTimelineText(current, event.delta));
    } else if (event.type === "run.failed" || event.type === "stream.failed") {
      setRunError(event.error);
      setLiveParts((current = []) => failInterviewTimeline(current));
    } else if (event.type === "run.interrupted") {
      setLiveParts((current = []) => failInterviewTimeline(current));
    }
  }

  async function confirm(plan: CrawlPlan) {
    setRunError(undefined);
    setIsConfirming(true);
    let confirmed: CrawlPlan | undefined;
    try {
      const view = await confirmCrawlPlan(task.id, plan.id, task.revision);
      queryClient.setQueryData(queryKey, view);
      confirmed = view.plans.find((item) => item.id === plan.id && item.status === "confirmed");
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "抓取计划确认失败");
    } finally {
      setIsConfirming(false);
    }
    if (confirmed) await prepareEnvironment(confirmed);
  }

  async function prepareEnvironment(plan: CrawlPlan) {
    setRunError(undefined);
    setPreparation(undefined);
    setIsPreparing(true);
    try {
      setPreparation(await prepareCrawlPlan(task.id, plan.id, {
        expectedTaskRevision: task.revision,
        expectedPlanVersion: plan.version,
      }));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "抓取环境准备失败");
    } finally {
      setIsPreparing(false);
    }
  }

  async function execute(plan: CrawlPlan) {
    if (!canStartAvailableSources(plan, preparation)) {
      setRunError("请先完成抓取条件检查");
      return;
    }
    setRunError(undefined); setIsExecuting(true);
    try {
      const accepted = await startSourceBatch(task.id, plan.id, {
        expectedTaskRevision: task.revision, expectedPlanVersion: plan.version,
      });
      setExecutionAccepted(`后台抓取已提交（${accepted.commandId}）。现在可以关闭或离开页面，批次不会中止。`);
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["source-runs", task.id] }), 500);
    } catch (error) { setRunError(error instanceof Error ? error.message : "后台抓取提交失败"); }
    finally {
      setPreparation(undefined);
      setIsExecuting(false);
      await queryClient.invalidateQueries({ queryKey: ["source-runs", task.id] });
    }
  }

  if (planning.isLoading) return <LoadingPanel />;
  if (planning.isError || !planning.data) {
    return <ErrorPanel label="抓取计划加载失败" onRetry={() => planning.refetch()} />;
  }
  const latestPlan = planning.data.plans[0];
  const latestRun = planning.data.runs[0];
  const planningRunning = isRunning || latestRun?.status === "running";
  const visibleParts = liveParts ?? latestRun?.timelineParts ?? [];

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-surface p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">制定抓取计划</p>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              Codex 会搜索并核实具体来源，再逐项确定每个来源抓什么、抓多少。这里只生成计划，不开始抓取。
            </p>
          </div>
          <span className="status-badge">任务 v{task.revision}</span>
        </div>
        <label className="mt-5 block text-xs font-medium text-muted" htmlFor="crawl-plan-instruction">
          补充或修订要求（可选）
        </label>
        <textarea
          id="crawl-plan-instruction"
          className="mt-2 min-h-24 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm leading-6 outline-none focus:border-ink"
          value={instruction}
          disabled={planningRunning}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={latestPlan ? "例如：减少评价样本量，增加国家标准和能效备案来源" : "首次制定可留空；如有额外边界，可在这里说明"}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {planningRunning ? (
            <button type="button" className="button-secondary" disabled>
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />后台规划中
            </button>
          ) : (
            <button type="button" className="button-primary" onClick={() => void runPlanning()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {latestPlan ? "重新规划并生成新版本" : "制定抓取计划"}
            </button>
          )}
          <p className="text-xs leading-5 text-muted">可以离开或刷新页面；后台会按已完成阶段继续，最终只生成一个新草稿。</p>
        </div>
        {runError && <p className="mt-3 text-sm text-danger" role="alert">{runError}</p>}
      </section>

      {(visibleParts.length > 0 || planningRunning) && (
        <PlanningTimeline parts={visibleParts} isRunning={planningRunning} />
      )}
      {!planningRunning && latestRun && (latestRun.status === "interrupted" || latestRun.status === "failed") && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="alert">
          本次重新规划{latestRun.status === "interrupted" ? "已中断" : "失败"}，没有生成可用的新计划。
          下方仍是此前保留的计划版本，必须通过当前执行完整性检查后才能开始抓取。
        </p>
      )}
      {latestPlan ? (
        <CrawlPlanCard
          plan={latestPlan}
          currentTaskRevision={task.revision}
          isConfirming={isConfirming}
          onConfirm={() => void confirm(latestPlan)}
          preparation={preparation}
          isPreparing={isPreparing}
          onPrepare={() => void prepareEnvironment(latestPlan)}
          isExecuting={isExecuting}
          onExecute={() => void execute(latestPlan)}
          executionAccepted={executionAccepted}
        />
      ) : (
        <section className="rounded-xl border border-dashed border-line bg-surface p-8 text-center">
          <p className="text-sm font-medium">还没有抓取计划</p>
          <p className="mt-2 text-sm text-muted">点击“制定抓取计划”后，搜索过程和计划草稿会显示在这里。</p>
        </section>
      )}
      {planning.data.plans.length > 1 && <PlanHistory plans={planning.data.plans.slice(1)} />}
    </div>
  );
}

function PlanningTimeline({ parts, isRunning }: { parts: InterviewMessageTimelinePart[]; isRunning: boolean }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 sm:p-7" aria-live="polite">
      <div className="mb-4 flex items-center gap-2">
        {isRunning && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
        <p className="text-sm font-semibold">规划过程</p>
      </div>
      <div className="space-y-3 text-sm leading-6">
        {collapseWebSearchActivities(parts).map((part, index) => part.type === "text"
          ? <p key={`text-${index}`} className="whitespace-pre-wrap">{planningTimelineText(part.text)}</p>
          : <InterviewActivity key={`${part.activity.id}-${index}`} activity={part.activity} />)}
      </div>
    </section>
  );
}

export function planningTimelineText(text: string) {
  try {
    const parsed = JSON.parse(text) as { assistantText?: unknown };
    // WHY：保留历史运行事实不做迁移；显示层只收窄已知结构化外壳，普通文字仍原样投影。
    return typeof parsed.assistantText === "string" && parsed.assistantText.trim()
      ? parsed.assistantText.trim() : text;
  } catch {
    return text;
  }
}

export function CrawlPlanCard({
  plan,
  currentTaskRevision,
  isConfirming,
  onConfirm,
  preparation,
  isPreparing,
  onPrepare,
  isExecuting,
  onExecute,
  executionBlockReason,
  executionAccepted,
}: {
  plan: CrawlPlan;
  currentTaskRevision: number;
  isConfirming: boolean;
  onConfirm: () => void;
  preparation?: SourcePreparation;
  isPreparing: boolean;
  onPrepare: () => void;
  isExecuting: boolean;
  onExecute: () => void;
  executionBlockReason?: string;
  executionAccepted?: string;
}) {
  const current = plan.taskRevision === currentTaskRevision;
  // WHY：服务端会拒绝任何带 blocker 的计划；页面必须在点击前表达同一事实，避免把纸面候选伪装成可确认计划。
  const hasExecutionBlockers = plan.content.sources.some((source) => source.executionBlockers.length > 0);
  const isExecutionChecklist = plan.content.executionChecklistVersion === 4
    && plan.content.researchAudit?.strategyVersion === 3
    && plan.content.sources.every((source) => source.targets.every((target) => target.providerConfiguration.length > 0));
  const canStart = canStartAvailableSources(plan, preparation);
  const targetCount = plan.content.sources.reduce((count, source) => count + source.targets.length, 0);
  return (
    <section className="rounded-xl border border-line bg-surface p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="text-xs font-medium text-muted">Crawl Plan v{plan.version} · 执行清单 {plan.content.executionChecklistVersion ?? "旧版"} · 基于任务 v{plan.taskRevision}</p>
          <h3 className="mt-1 text-lg font-semibold">{plan.content.summary}</h3>
          <p className="mt-1 text-xs text-muted">{plan.content.sources.length} 个来源 · {targetCount} 个可对账抓取项</p>
        </div>
        <span className="status-badge">{planStatus(plan, current, hasExecutionBlockers, isExecutionChecklist)}</span>
      </div>
      {plan.content.researchAudit && <CrawlPlanningResearchAuditCard audit={plan.content.researchAudit} />}
      <div className="mt-5 space-y-5">
        {plan.content.sources.map((source) => <CrawlPlanSourceCard key={source.key} source={source} />)}
      </div>
      {plan.content.excludedContent.length > 0 && (
        <div className="mt-5 border-t border-line pt-4 text-sm">
          <p className="font-semibold">明确不抓</p>
          <p className="mt-1 leading-6 text-muted">{plan.content.excludedContent.join("；")}</p>
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        {plan.status === "draft" && current && !hasExecutionBlockers && isExecutionChecklist && (
          <button type="button" className="button-primary" disabled={isConfirming} onClick={onConfirm}>
            {isConfirming
              ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <Check className="h-4 w-4" aria-hidden="true" />}
            {isConfirming ? "正在确认…" : "确认此计划"}
          </button>
        )}
        {plan.status === "draft" && current && (hasExecutionBlockers || !isExecutionChecklist) && (
          <p className="text-xs leading-5 text-amber-800">
            该计划不是无阻塞的完整执行清单，不能确认；请按阻塞项重新规划。
          </p>
        )}
        {plan.status === "confirmed" && current && !hasExecutionBlockers && isExecutionChecklist
          && !executionBlockReason
          && preparation?.status !== "ready" && (
          <button type="button" className="button-primary" disabled={isPreparing} onClick={onPrepare}>
            {isPreparing
              ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {isPreparing ? "正在检查…" : preparation?.status === "action_required" ? "已完成，重新检查" : "检查抓取条件"}
          </button>
        )}
        {plan.status === "confirmed" && current && !hasExecutionBlockers && isExecutionChecklist
          && !executionBlockReason && canStart && (
          <button type="button" className="button-primary" disabled={isExecuting} onClick={onExecute}>
            {isExecuting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {isExecuting ? "正在提交…" : preparation?.status === "ready" ? "开始新批次抓取" : "开始其余来源的新批次"}
          </button>
        )}
        {plan.status === "confirmed" && current && (hasExecutionBlockers || !isExecutionChecklist) && (
          <p className="text-xs leading-5 text-amber-800">这是历史技术纵切片，不能继续启动；请生成当前完整执行清单。</p>
        )}
        {plan.status === "confirmed" && current && executionBlockReason && (
          <p className="text-xs leading-5 text-amber-800" role="alert">{executionBlockReason}</p>
        )}
        <p className="text-xs leading-5 text-muted">
          确认只冻结来源、内容和数量，不创建 Source Run，也不开始抓取。
        </p>
        {plan.status === "confirmed" && preparation && (
          <p className={`w-full text-sm leading-6 ${preparation.status === "ready" ? "text-emerald-700" : "text-amber-800"}`}
            role={preparation.status === "action_required" ? "alert" : "status"}>
            {preparation.status === "ready"
              ? "只完成抓取条件检查，尚未创建抓取批次，也没有访问任何来源。"
              : preparation.message}
          </p>
        )}
        {plan.status === "confirmed" && executionAccepted && (
          <p className="w-full text-sm leading-6 text-emerald-700" role="status">{executionAccepted}</p>
        )}
      </div>
    </section>
  );
}

function canStartAvailableSources(plan: CrawlPlan, preparation?: SourcePreparation) {
  if (preparation?.status === "ready") return true;
  if (preparation?.status !== "action_required") return false;
  const blockedSource = plan.content.sources.find((source) => source.key === preparation.sourceKey);
  if (!blockedSource) return false;
  // WHY：人工动作只约束同一 Provider 会话；其他 Provider 的公开来源仍应允许形成独立运行事实。
  return plan.content.sources.some((source) => source.provider.key !== blockedSource.provider.key
    || source.provider.version !== blockedSource.provider.version);
}

type CrawlPlanSource = CrawlPlan["content"]["sources"][number];
type CrawlPlanTarget = CrawlPlanSource["targets"][number];

function CrawlPlanSourceCard({ source }: { source: CrawlPlanSource }) {
  return (
    <details data-crawl-plan-source="true" className="group/source rounded-lg border border-line bg-panel">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-start gap-2">
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform group-open/source:rotate-90" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block font-semibold">{source.name}</span>
            <span className="mt-1 block text-xs text-muted">{source.publisher} · {source.sourceKind} · 搜索发现</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-muted">{source.targets.length} 个抓取项</span>
          <span className="rounded-full border border-line bg-surface px-2 py-1 text-xs">{source.accessState}</span>
        </span>
      </summary>
      <div className="border-t border-line p-4">
        <p className="text-sm leading-6">{source.role}</p>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <PlanField label="Provider" value={`${source.provider.key}@${source.provider.version}`} />
          <PlanField label="采访来源" value={source.sourceCandidateIds.length > 0 ? source.sourceCandidateIds.join("、") : "本轮规划新增来源"} />
          <PlanField label="访问限制" value={`每分钟 ${source.accessPolicy.maxRequestsPerMinute} 次 · 间隔 ${source.accessPolicy.minimumIntervalMs}ms · 最长 ${source.accessPolicy.maximumRunMs}ms`} />
          <PlanField label="Provider 配置" value={source.provider.configuration.map((item) => `${item.key}=${item.value}`).join("；")} />
          <PlanField label="原始输出" value={`${source.rawOutputPolicy.formats.join("、")} · ${source.rawOutputPolicy.retainAssets ? "保存附件" : "不单独下载附件"}`} />
          <PlanField label="请求预算" value={`${source.stopPolicy.requestBudget} 次`} />
          <PlanField label="强制停止" value={source.stopPolicy.stopOnAccessRestriction ? "登录/验证码/拒绝/风控立即停止" : "按 Provider 策略"} />
        </dl>
        <div className="mt-3 space-y-1">
          {source.entryUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"
            className="block break-all text-xs text-muted underline underline-offset-2 hover:text-ink">{url}</a>)}
        </div>
        <div className="mt-4 space-y-3">
          {source.targets.map((target) => <CrawlPlanTargetCard key={target.key} target={target} />)}
        </div>
        {source.executionBlockers.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
            <p className="font-semibold">执行前仍需通过</p>
            <ul className="mt-1 list-disc pl-5">{source.executionBlockers.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">观察时间：{formatDateTime(source.observedAt)}</p>
      </div>
    </details>
  );
}

function CrawlPlanTargetCard({ target }: { target: CrawlPlanTarget }) {
  return (
    <details data-crawl-plan-target="true" className="group/target rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-open/target:rotate-90" aria-hidden="true" />
          <span className="text-sm font-semibold">{target.name}</span>
        </span>
        <span className="shrink-0 text-xs text-muted">{quantityLabel(target.quantity)}</span>
      </summary>
      <dl className="grid gap-3 border-t border-line p-4 text-xs leading-5 sm:grid-cols-2">
        <PlanField label="任务内容" value={target.taskTopics.join("、")} />
        <PlanField label="执行参数" value={target.providerConfiguration.map((item) => `${item.key}=${item.value}`).join("；")} />
        <PlanField label="捕获单元 / 格式" value={`${target.captureUnit} / ${target.rawFormats.join("、")}`} />
        <PlanField label="覆盖分母" value={target.quantity.denominator} />
        <PlanField label="唯一键" value={target.uniqueKey} />
        <PlanField label="遍历方式" value={target.traversal} />
        <PlanField label="停止条件" value={target.stopCondition} />
        <PlanField label="数量依据" value={target.quantity.rationale} />
      </dl>
    </details>
  );
}

function PlanField({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-medium text-muted">{label}</dt><dd className="mt-0.5 text-ink">{value}</dd></div>;
}

function PlanHistory({ plans }: { plans: CrawlPlan[] }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <p className="text-sm font-semibold">历史计划版本</p>
      <div className="mt-3 space-y-2">{plans.map((plan) => (
        <div key={plan.id} className="flex items-center justify-between gap-3 text-sm">
          <span>v{plan.version} · 任务 v{plan.taskRevision}</span>
          <span className="text-xs text-muted">{plan.status} · {formatDateTime(plan.createdAt)}</span>
        </div>
      ))}</div>
    </section>
  );
}

function quantityLabel(quantity: CrawlPlan["content"]["sources"][number]["targets"][number]["quantity"]) {
  if (quantity.mode === "all_available") return `全部 · ${quantity.unit}`;
  return `${quantity.mode === "sample" ? "样本" : "目标"} ${quantity.targetCount} ${quantity.unit}`;
}

function planStatus(plan: CrawlPlan, current: boolean, hasExecutionBlockers: boolean, isExecutionChecklist: boolean) {
  if (!current) return "任务范围已更新";
  if (!isExecutionChecklist) return "历史技术纵切片";
  if (plan.status === "confirmed") return "已确认";
  if (plan.status === "superseded") return "历史版本";
  if (hasExecutionBlockers) return "有执行阻塞";
  return "待确认";
}

function LoadingPanel() {
  return <div className="h-48 animate-pulse rounded-xl bg-line/30" aria-label="正在加载抓取计划" />;
}

function ErrorPanel({ label, onRetry }: { label: string; onRetry: () => void }) {
  return <div className="rounded-lg border border-danger/30 p-4 text-sm text-danger"><p>{label}</p>
    <button type="button" className="button-secondary mt-3" onClick={onRetry}><RefreshCw className="h-4 w-4" />重试</button></div>;
}
