import {
  appendInterviewTimelineActivity,
  appendInterviewTimelineText,
  failInterviewTimeline,
  type CaptureTask,
  type CrawlPlan,
  type CrawlPlanningEvent,
  type InterviewMessageTimelinePart,
} from "@domain-analysis/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, RefreshCw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  confirmCrawlPlan,
  fetchCrawlPlanning,
  streamCrawlPlanningRun,
} from "../lib/api";
import { formatDateTime } from "../lib/format";
import { InterviewActivity } from "./InterviewThread";
import { collapseWebSearchActivities } from "./interviewTimelineModel";

export function CrawlPlanningPanel({ task }: { task: CaptureTask }) {
  const queryClient = useQueryClient();
  const queryKey = ["crawl-planning", task.id] as const;
  const planning = useQuery({ queryKey, queryFn: () => fetchCrawlPlanning(task.id) });
  const [instruction, setInstruction] = useState("");
  const [liveParts, setLiveParts] = useState<InterviewMessageTimelinePart[]>();
  const [runError, setRunError] = useState<string>();
  const [isRunning, setIsRunning] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const abortRef = useRef<AbortController>();

  useEffect(() => () => abortRef.current?.abort(), []);

  async function runPlanning() {
    setRunError(undefined);
    setLiveParts([]);
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
    if (event.type === "run.activity") {
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
    try {
      const view = await confirmCrawlPlan(task.id, plan.id, task.revision);
      queryClient.setQueryData(queryKey, view);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "抓取计划确认失败");
    } finally {
      setIsConfirming(false);
    }
  }

  if (planning.isLoading) return <LoadingPanel />;
  if (planning.isError || !planning.data) {
    return <ErrorPanel label="抓取计划加载失败" onRetry={() => planning.refetch()} />;
  }
  const latestPlan = planning.data.plans[0];
  const latestRun = planning.data.runs[0];
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
          disabled={isRunning}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={latestPlan ? "例如：减少评价样本量，增加国家标准和能效备案来源" : "首次制定可留空；如有额外边界，可在这里说明"}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {isRunning ? (
            <button type="button" className="button-secondary" onClick={() => abortRef.current?.abort()}>
              <Square className="h-4 w-4 fill-current" aria-hidden="true" />停止本轮
            </button>
          ) : (
            <button type="button" className="button-primary" onClick={() => void runPlanning()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {latestPlan ? "重新规划并生成新版本" : "制定抓取计划"}
            </button>
          )}
          <p className="text-xs leading-5 text-muted">运行留在当前页面可见；离开页面会中止，已完成版本会保留。</p>
        </div>
        {runError && <p className="mt-3 text-sm text-danger" role="alert">{runError}</p>}
      </section>

      {(visibleParts.length > 0 || isRunning) && (
        <PlanningTimeline parts={visibleParts} isRunning={isRunning} />
      )}
      {latestPlan ? (
        <CrawlPlanCard
          plan={latestPlan}
          currentTaskRevision={task.revision}
          isConfirming={isConfirming}
          onConfirm={() => void confirm(latestPlan)}
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
          ? <p key={`text-${index}`} className="whitespace-pre-wrap">{part.text}</p>
          : <InterviewActivity key={`${part.activity.id}-${index}`} activity={part.activity} />)}
      </div>
    </section>
  );
}

export function CrawlPlanCard({
  plan,
  currentTaskRevision,
  isConfirming,
  onConfirm,
}: {
  plan: CrawlPlan;
  currentTaskRevision: number;
  isConfirming: boolean;
  onConfirm: () => void;
}) {
  const current = plan.taskRevision === currentTaskRevision;
  return (
    <section className="rounded-xl border border-line bg-surface p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="text-xs font-medium text-muted">抓取计划 v{plan.version} · 基于任务 v{plan.taskRevision}</p>
          <h3 className="mt-1 text-lg font-semibold">{plan.content.summary}</h3>
        </div>
        <span className="status-badge">{planStatus(plan, current)}</span>
      </div>
      <div className="mt-5 space-y-5">
        {plan.content.sources.map((source) => (
          <article key={source.key} className="rounded-lg border border-line bg-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold">{source.name}</h4>
                <p className="mt-1 text-xs text-muted">{source.publisher} · {source.sourceKind} · 搜索发现</p>
              </div>
              <span className="rounded-full border border-line bg-surface px-2 py-1 text-xs">{source.accessState}</span>
            </div>
            <p className="mt-3 text-sm leading-6">{source.role}</p>
            <div className="mt-3 space-y-1">
              {source.entryUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"
                className="block break-all text-xs text-muted underline underline-offset-2 hover:text-ink">{url}</a>)}
            </div>
            <div className="mt-4 space-y-3">
              {source.targets.map((target) => (
                <div key={target.key} className="rounded-lg border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{target.name}</p>
                    <span className="text-xs text-muted">{quantityLabel(target.quantity)}</span>
                  </div>
                  <dl className="mt-3 grid gap-3 text-xs leading-5 sm:grid-cols-2">
                    <PlanField label="任务内容" value={target.taskTopics.join("、")} />
                    <PlanField label="捕获单元 / 格式" value={`${target.captureUnit} / ${target.rawFormats.join("、")}`} />
                    <PlanField label="覆盖分母" value={target.quantity.denominator} />
                    <PlanField label="唯一键" value={target.uniqueKey} />
                    <PlanField label="遍历方式" value={target.traversal} />
                    <PlanField label="停止条件" value={target.stopCondition} />
                    <PlanField label="数量依据" value={target.quantity.rationale} />
                  </dl>
                </div>
              ))}
            </div>
            {source.executionBlockers.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                <p className="font-semibold">执行前仍需通过</p>
                <ul className="mt-1 list-disc pl-5">{source.executionBlockers.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">观察时间：{formatDateTime(source.observedAt)}</p>
          </article>
        ))}
      </div>
      {plan.content.excludedContent.length > 0 && (
        <div className="mt-5 border-t border-line pt-4 text-sm">
          <p className="font-semibold">明确不抓</p>
          <p className="mt-1 leading-6 text-muted">{plan.content.excludedContent.join("；")}</p>
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        {plan.status === "draft" && current && (
          <button type="button" className="button-primary" disabled={isConfirming} onClick={onConfirm}>
            {isConfirming
              ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <Check className="h-4 w-4" aria-hidden="true" />}
            {isConfirming ? "正在确认…" : "确认此计划"}
          </button>
        )}
        <p className="text-xs leading-5 text-muted">
          确认只冻结来源、内容和数量，不创建 Source Run，也不开始抓取。
        </p>
      </div>
    </section>
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

function planStatus(plan: CrawlPlan, current: boolean) {
  if (!current) return "任务范围已更新";
  if (plan.status === "confirmed") return "已确认";
  if (plan.status === "superseded") return "历史版本";
  return "待确认";
}

function LoadingPanel() {
  return <div className="h-48 animate-pulse rounded-xl bg-line/30" aria-label="正在加载抓取计划" />;
}

function ErrorPanel({ label, onRetry }: { label: string; onRetry: () => void }) {
  return <div className="rounded-lg border border-danger/30 p-4 text-sm text-danger"><p>{label}</p>
    <button type="button" className="button-secondary mt-3" onClick={onRetry}><RefreshCw className="h-4 w-4" />重试</button></div>;
}
