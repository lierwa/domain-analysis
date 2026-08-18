import type {
  CategoryInterviewView,
  InterviewTurnActivity,
} from "@domain-analysis/shared";
import { Check, CheckCircle2, Circle, LoaderCircle, XCircle } from "lucide-react";

import { CaptureTaskContentView } from "./CaptureTaskContentView";

type InterviewDecision = CategoryInterviewView["decisions"][number];
type CaptureTaskDraft = CategoryInterviewView["taskDrafts"][number];

export function InterviewActivityPanel({
  activities,
  elapsedSeconds,
  isRunning,
}: {
  activities: InterviewTurnActivity[];
  elapsedSeconds: number;
  isRunning: boolean;
}) {
  if (activities.length === 0) return null;
  return (
    <section className="mt-3 rounded-xl border border-line bg-panel px-4 py-3" aria-label="本轮 Agent 执行记录" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold text-muted">本轮执行记录</p>
        <p className="text-xs tabular-nums text-muted">{isRunning ? `已运行 ${elapsedSeconds}s` : "本轮已结束"}</p>
      </div>
      <ol className="mt-3 space-y-3">
        {activities.map((activity) => (
          <li key={activity.id} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2 text-sm">
            <ActivityStatusIcon status={activity.status} />
            <span className="min-w-0">
              <span className="block font-medium">{activity.label}</span>
              {activity.detail && <span className="mt-0.5 block break-words text-xs leading-5 text-muted">{activity.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function InterviewDecisionCard({
  decision,
  disabled,
  onConfirm,
}: {
  decision: InterviewDecision;
  disabled: boolean;
  onConfirm: (selection: string) => void;
}) {
  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-4" aria-labelledby={`${decision.id}-question`}>
      <p className="text-xs font-medium text-muted">需要你决定</p>
      <h3 id={`${decision.id}-question`} className="mt-1 text-sm font-semibold">{decision.question}</h3>
      <p className="mt-2 text-xs leading-5 text-muted">{decision.rationale}</p>
      <div className="mt-3 grid gap-2">
        {decision.options.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={disabled}
            className="min-h-14 rounded-lg border border-line px-3 py-2 text-left transition hover:border-ink disabled:cursor-wait disabled:opacity-60"
            onClick={() => onConfirm(option.label)}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              {option.label}
              {option.recommended && <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] text-surface">推荐</span>}
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted">{option.description}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">点击某个选项即确认该项并继续，不需要再次确认。</p>
    </section>
  );
}

export function CaptureTaskDraftCard({
  draft,
  onContinue,
  onConfirm,
}: {
  draft: CaptureTaskDraft;
  onContinue: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium text-muted">抓取任务草稿 v{draft.version}</p>
      <p className="mb-5 mt-1 text-sm leading-6 text-muted">{draft.content.originalRequest}</p>
      <CaptureTaskContentView content={draft.content} />
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button type="button" className="button-secondary" onClick={onContinue}>继续补充或修改</button>
        <button type="button" className="button-primary" onClick={onConfirm}>
          <Check className="h-4 w-4" aria-hidden="true" />确认此版本并生成抓取任务
        </button>
        <p className="w-full text-xs leading-5 text-muted">候选来源不够时，直接继续对话；系统会生成新的草稿版本，不会覆盖这一版。</p>
      </div>
    </section>
  );
}

function ActivityStatusIcon({ status }: { status: InterviewTurnActivity["status"] }) {
  if (status === "running") return <LoaderCircle className="mt-0.5 h-4 w-4 animate-spin" aria-label="进行中" />;
  if (status === "failed") return <XCircle className="mt-0.5 h-4 w-4 text-danger" aria-label="失败" />;
  if (status === "completed") return <CheckCircle2 className="mt-0.5 h-4 w-4" aria-label="已完成" />;
  return <Circle className="mt-0.5 h-4 w-4" aria-hidden="true" />;
}
