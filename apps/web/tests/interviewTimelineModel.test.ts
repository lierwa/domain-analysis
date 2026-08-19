import {
  interviewTurnActivitySchema,
  type InterviewTurnActivity,
  type NormalizedInterviewMessage,
} from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import {
  appendAssistantActivity,
  appendAssistantText,
  appendPendingTurn,
  collapseWebSearchActivities,
  completeAssistantMessage,
  isActionErrorAlreadyVisible,
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
      activity: activity("turn-lifecycle", "agent", "准备本轮分析"),
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
      activity("search-1", "web_search", "搜索网页", "冰箱 主流品牌", ["https://www.jd.com/"]),
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
        ...activity("search-1", "web_search", "搜索网页", "冰箱 主流品牌", ["https://www.jd.com/"]),
        status: "completed",
      } },
      { type: "text", text: "搜索后继续说明。" },
    ]);
  });

  it("最终消息使用服务端持久化时间线，完全刷新后仍恢复网页搜索", () => {
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
      activity("search-1", "web_search", "搜索网页", undefined, ["https://www.jd.com/"]),
    );
    const persisted: NormalizedInterviewMessage = {
      ...assistantMessage("assistant-1", 1, "请决定京东范围。\n1. 完整范围（推荐）"),
      timelineParts: [
        { type: "activity", activity: {
          ...activity("turn-analysis", "analysis", "分析需求"), status: "completed",
        } },
        { type: "text", text: "正在分析。" },
        { type: "activity", activity: {
          ...activity("search-1", "web_search", "搜索网页", undefined, ["https://www.jd.com/"]),
          status: "completed",
        } },
        { type: "text", text: "请决定京东范围。\n1. 完整范围（推荐）" },
      ],
    };
    messages = completeAssistantMessage(messages, "pending-assistant-1", persisted);

    expect(messages[0]?.timelineParts).toEqual(persisted.timelineParts);
    expect(messages[0]?.timelineParts?.[2]).toMatchObject({
      type: "activity",
      activity: { id: "search-1", status: "completed", urls: ["https://www.jd.com/"] },
    });

    const reconciled = reconcilePersistedMessages([], [persisted]);
    expect(reconciled[0]?.id).toBe("assistant-1");
    expect(reconciled[0]?.timelineParts).toEqual(persisted.timelineParts);
  });

  it("把同一轮多次网页搜索折叠成一条，并按唯一网址计数", () => {
    const parts = collapseWebSearchActivities([
      { type: "activity", activity: activity(
        "search-1",
        "web_search",
        "搜索网页",
        "冰箱 主流品牌",
        ["https://www.jd.com/", "https://www.jd.com/"],
      ) },
      { type: "text", text: "继续核查参数。" },
      { type: "activity", activity: {
        ...activity(
          "search-2",
          "web_search",
          "搜索网页",
          "冰箱 参数",
          ["https://example.com/spec"],
        ),
        status: "completed",
      } },
    ]);

    expect(parts).toEqual([
      { type: "activity", activity: {
        ...activity(
          "search-1",
          "web_search",
          "搜索网页",
          "冰箱 主流品牌",
          ["https://www.jd.com/", "https://example.com/spec"],
        ),
        status: "running",
      } },
      { type: "text", text: "继续核查参数。" },
    ]);
  });

  it("合并超过 50 个网址后仍生成可渲染的单条搜索记录", () => {
    const urls = Array.from({ length: 52 }, (_, index) => `https://example.com/page-${index + 1}`);
    const parts = collapseWebSearchActivities([
      { type: "activity", activity: activity("search-1", "web_search", "搜索网页", undefined, urls.slice(0, 30)) },
      { type: "activity", activity: activity("search-2", "web_search", "搜索网页", undefined, urls.slice(20, 50)) },
      { type: "activity", activity: activity("search-3", "web_search", "搜索网页", undefined, urls.slice(50)) },
    ]);
    const search = parts.find((part) => part.type === "activity" && part.activity.kind === "web_search");

    expect(search?.type === "activity" ? search.activity.urls : undefined).toHaveLength(52);
    expect(search?.type === "activity" && interviewTurnActivitySchema.safeParse(search.activity).success).toBe(true);
  });

  it("持久化助手消息已显示同一错误时不再渲染第二份全局错误", () => {
    const error = "Codex 返回结果不符合协议：draftMarkdown";
    const failed = {
      ...assistantMessage("assistant-failed", 1, "正在整理结果。"),
      deliveryStatus: "failed" as const,
      error,
    };

    expect(isActionErrorAlreadyVisible([failed], error)).toBe(true);
    expect(isActionErrorAlreadyVisible([failed], "另一个错误")).toBe(false);
  });
});

const NOW = "2026-08-19T00:00:00+08:00";

function activity(
  id: string,
  kind: InterviewTurnActivity["kind"],
  label: string,
  detail?: string,
  urls?: string[],
): InterviewTurnActivity {
  return {
    id,
    kind,
    label,
    ...(detail ? { detail } : {}),
    ...(urls ? { urls } : {}),
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
