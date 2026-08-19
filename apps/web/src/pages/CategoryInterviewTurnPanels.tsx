import type {
  CategoryInterviewView,
} from "@domain-analysis/shared";
import { Check } from "lucide-react";

type CaptureTaskDraft = CategoryInterviewView["taskDrafts"][number];

export function CaptureTaskDraftCard({
  draft,
  onContinue,
  onConfirm,
  isConfirming,
}: {
  draft: CaptureTaskDraft;
  onContinue: () => void;
  onConfirm: () => void;
  isConfirming: boolean;
}) {
  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium text-muted">采访范围草案 v{draft.version}</p>
      <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground">{draft.markdown}</div>
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button type="button" className="button-secondary" onClick={onContinue} disabled={isConfirming}>继续补充或修改</button>
        <button type="button" className="button-primary" onClick={onConfirm} disabled={isConfirming}>
          <Check className="h-4 w-4" aria-hidden="true" />
          {isConfirming ? "正在生成正式任务…" : "确认范围并生成正式任务"}
        </button>
        <p className="w-full text-xs leading-5 text-muted">范围需要调整时直接继续对话；系统会保留旧版本并生成新草案。</p>
      </div>
    </section>
  );
}
