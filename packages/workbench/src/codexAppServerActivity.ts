import type { InterviewTurnActivity } from "@domain-analysis/shared";

import type { CodexAppServerStreamItem } from "./codexAppServerClient";

type CodexEvent = Extract<CodexAppServerStreamItem, { type: "event" }>;

export function projectCodexAppServerActivity(
  event: CodexEvent,
  eventSequence: number,
  labels: { lifecycle: string; analysis: string; finalizing: string },
): InterviewTurnActivity | undefined {
  if (event.eventType === "thread.started") {
    return { id: "turn-lifecycle", kind: "agent", label: labels.lifecycle, status: "running" };
  }
  if (event.eventType === "turn.started") {
    return { id: "turn-lifecycle", kind: "analysis", label: labels.analysis, status: "running" };
  }
  if (event.eventType === "turn.completed") return finalizingActivity(labels.finalizing, "running");
  if (!event.eventType.startsWith("item.") || !event.itemType) return undefined;
  if (event.itemType === "agent_message" && event.phase === "final_answer"
    && event.eventType === "item.started") {
    return finalizingActivity(labels.finalizing, "running");
  }
  const common = {
    id: event.itemId || `${event.itemType}-${eventSequence}`,
    ...(event.detail ? { detail: event.detail } : {}),
    ...(event.urls?.length ? { urls: event.urls } : {}),
    status: event.itemStatus ?? "running",
  } as const;
  if (event.itemType === "web_search") return { ...common, kind: "web_search", label: "搜索网页" };
  // WHY：本地命令不是产品规划活动；即使外部 seam 意外交付，也不投影成用户可见事实。
  if (event.itemType === "command_execution") return undefined;
  if (event.itemType === "mcp_tool_call") return { ...common, kind: "tool", label: "调用工具" };
  return undefined;
}

export function finalizingActivity(label: string, status: InterviewTurnActivity["status"]): InterviewTurnActivity {
  return { id: "turn-finalizing", kind: "finalizing", label, status };
}
