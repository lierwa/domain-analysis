import type { SourceRunEvent } from "@domain-analysis/shared";

export function countSourceTerminal(
  event: SourceRunEvent,
  counts: { completed: number; failed: number; stopped: number },
) {
  if (event.type === "run.completed") counts.completed += 1;
  else if (event.type === "run.failed") counts.failed += 1;
  else if (event.type === "run.stopped") counts.stopped += 1;
}

export function sourceBatchOutcome(
  counts: { completed: number; failed: number; stopped: number },
  total: number,
  aborted: boolean,
) {
  if (aborted || counts.stopped > 0) return { status: "stopped" as const,
    terminationReason: `${counts.completed}/${total} 个来源完成，批次已停止` };
  if (counts.completed === total) return { status: "completed" as const,
    terminationReason: `${total}/${total} 个来源完成` };
  if (counts.completed > 0) return { status: "partial" as const,
    terminationReason: `${counts.completed}/${total} 个来源完成，${counts.failed} 个来源失败` };
  return { status: "failed" as const,
    terminationReason: `0/${total} 个来源完成，${counts.failed} 个来源失败` };
}
