import type {
  InterviewTurnActivity,
  NormalizedInterviewMessage,
} from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import {
  appendAssistantActivity,
  appendAssistantText,
  appendPendingTurn,
  completeAssistantMessage,
  reconcilePersistedMessages,
} from "../src/pages/interviewTimelineModel";

describe("采访单回合时间线", () => {
  it("按到达顺序交错追加文字与活动，并原位更新同一个工具项", () => {
    let messages = appendPendingTurn([], {
      sessionId: "session-1",
      assistantId: "pending-assistant-1",
      userId: "pending-user-1",
      userText: "抓冰箱",
      createdAt: NOW,
      activity: activity("turn-lifecycle", "agent", "连接本机 Codex"),
    });
    messages = appendAssistantActivity(
      messages,
      "pending-assistant-1",
      activity("turn-lifecycle", "analysis", "分析需求与当前抓取范围"),
    );
    messages = appendAssistantText(messages, "pending-assistant-1", "先说明调查范围。\n\n");
    messages = appendAssistantActivity(
      messages,
      "pending-assistant-1",
      activity("search-1", "web_search", "搜索网页", "冰箱 主流品牌"),
    );
    messages = appendAssistantActivity(messages, "pending-assistant-1", {
      ...activity("search-1", "web_search", "搜索网页", "冰箱 主流品牌"),
      status: "completed",
    });
    messages = appendAssistantText(messages, "pending-assistant-1", "\n\n搜索后继续说明。");

    expect(messages[1]?.timelineParts).toEqual([
      { type: "activity", activity: {
        ...activity("turn-lifecycle", "analysis", "分析需求与当前抓取范围"),
        status: "completed",
      } },
      { type: "text", text: "先说明调查范围。" },
      { type: "activity", activity: {
        ...activity("search-1", "web_search", "搜索网页", "冰箱 主流品牌"),
        status: "completed",
      } },
      { type: "text", text: "搜索后继续说明。" },
    ]);
  });

  it("最终消息追加在既有活动之后，刷新时保留本轮 parts", () => {
    let messages = appendPendingTurn([], {
      sessionId: "session-1",
      assistantId: "pending-assistant-1",
      createdAt: NOW,
      activity: activity("turn-analysis", "analysis", "分析需求"),
    });
    messages = appendAssistantText(messages, "pending-assistant-1", "正在分析。");
    messages = appendAssistantActivity(
      messages,
      "pending-assistant-1",
      activity("tool-1", "tool", "执行本地只读命令"),
    );
    const persisted = assistantMessage("assistant-1", 1, "请决定京东范围。\n1. 完整范围（推荐）");
    messages = completeAssistantMessage(messages, "pending-assistant-1", persisted);

    expect(messages[0]?.timelineParts?.map((part) => part.type)).toEqual([
      "activity",
      "text",
      "activity",
      "text",
    ]);
    expect(messages[0]?.timelineParts?.[2]).toMatchObject({
      type: "activity",
      activity: { id: "tool-1", status: "completed" },
    });

    const reconciled = reconcilePersistedMessages(messages, [persisted]);
    expect(reconciled[0]?.id).toBe("assistant-1");
    expect(reconciled[0]?.timelineParts).toEqual(messages[0]?.timelineParts);
  });
});

const NOW = "2026-08-19T00:00:00+08:00";

function activity(
  id: string,
  kind: InterviewTurnActivity["kind"],
  label: string,
  detail?: string,
): InterviewTurnActivity {
  return {
    id,
    kind,
    label,
    ...(detail ? { detail } : {}),
    status: "running",
  };
}

function assistantMessage(id: string, sequence: number, text: string): NormalizedInterviewMessage {
  return {
    id,
    sessionId: "session-1",
    sequence,
    role: "assistant",
    text,
    deliveryStatus: "completed",
    createdAt: NOW,
  };
}
