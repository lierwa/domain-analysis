import type {
  CategoryInterviewView,
} from "@domain-analysis/shared";
import { Check } from "lucide-react";

import { CaptureTaskContentView } from "./CaptureTaskContentView";

type CaptureTaskDraft = CategoryInterviewView["taskDrafts"][number];

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
