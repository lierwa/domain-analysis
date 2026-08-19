import { categoryInterviewViewSchema } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import {
  makeQuestionVisible,
  requiresCategoryResearch,
  requiresInitialCategoryResearch,
} from "../src/codexCategoryInterviewRuntime";

describe("采访首轮调查门", () => {
  it("首次失败后用户直接补充消息，仍然要求新品类调查", () => {
    const view = categoryInterviewViewSchema.parse({
      session: {
        id: "session-1",
        initialRequest: "抓显示器",
        phase: "active",
        turnState: "running",
        revision: 4,
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:03:00.000Z",
      },
      messages: [
        message(1, "user", "抓显示器", "completed"),
        message(2, "assistant", "首轮没有完成。", "failed"),
        message(3, "user", "再试一次", "completed"),
      ],
      decisions: [],
      unresolvedItems: [],
      taskDrafts: [],
    });

    expect(requiresInitialCategoryResearch({
      session: view,
      trigger: { type: "user_message", text: "再试一次" },
    })).toBe(true);
  });

  it("只有完成文案但没有持久搜索证据时仍要求首轮搜索", () => {
    const view = categoryInterviewViewSchema.parse({
      session: {
        id: "session-1",
        initialRequest: "抓显示器",
        phase: "active",
        turnState: "running",
        revision: 4,
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:03:00.000Z",
      },
      messages: [
        message(1, "user", "抓显示器", "completed"),
        message(2, "assistant", "已经完成过一轮调查。", "completed"),
        message(3, "user", "解释一下来源", "completed"),
      ],
      decisions: [],
      unresolvedItems: [],
      taskDrafts: [],
    });

    expect(requiresInitialCategoryResearch({
      session: view,
      trigger: { type: "user_message", text: "解释一下来源" },
    })).toBe(true);
  });
});

describe("采访后续调查门", () => {
  it("结构化选项始终按数组顺序完整编号", () => {
    const output = makeQuestionVisible({
      assistantText: "背景说明。\n\n首期覆盖哪些型号？\n1. 仅在售\n3. 全部覆盖",
      proposedDecision: {
        key: "catalog.lifecycle",
        question: "首期覆盖哪些型号？",
        options: [
          { label: "仅在售", description: "边界清晰。", recommended: true },
          { label: "近三年", description: "兼顾历史。", recommended: false },
          { label: "全部覆盖", description: "工作量最大。", recommended: false },
        ],
        selection: "仅在售",
        rationale: "首期优先当前市场。",
      },
      unresolvedItems: [], resolvedUnresolvedKeys: [],
    });

    expect(output.assistantText).toContain("1. 仅在售（推荐）：边界清晰。");
    expect(output.assistantText).toContain("2. 近三年：兼顾历史。");
    expect(output.assistantText).toContain("3. 全部覆盖：工作量最大。");
    expect(output.assistantText.match(/首期覆盖哪些型号？/g)).toHaveLength(1);
  });

  it("已有持久化 web_search 活动证据时不重复强制首轮搜索", () => {
    const view = categoryInterviewViewSchema.parse({
      session: {
        id: "session-1", initialRequest: "抓显示器", phase: "active", turnState: "running",
        revision: 4, createdAt: "2026-08-19T00:00:00.000Z", updatedAt: "2026-08-19T00:03:00.000Z",
      },
      messages: [
        message(1, "user", "抓显示器", "completed"),
        { ...message(2, "assistant", "已调查来源。", "completed"), timelineParts: [{
          type: "activity",
          activity: { id: "search-1", kind: "web_search", label: "搜索网页", status: "completed" },
        }, { type: "text", text: "已调查来源。" }] },
        message(3, "user", "继续", "completed"),
      ],
      decisions: [], unresolvedItems: [], taskDrafts: [],
    });

    expect(requiresInitialCategoryResearch({
      session: view,
      trigger: { type: "user_message", text: "继续" },
    })).toBe(false);
  });

  it("已有草稿切换到新品类时重新要求本轮搜索", () => {
    const view = categoryInterviewViewSchema.parse({
      session: {
        id: "session-1", initialRequest: "抓冰箱", phase: "task_ready", turnState: "running",
        revision: 4, createdAt: "2026-08-19T00:00:00.000Z", updatedAt: "2026-08-19T00:03:00.000Z",
      },
      messages: [message(1, "user", "抓冰箱", "completed")],
      decisions: [], unresolvedItems: [],
      taskDrafts: [{
        id: "draft-1", sessionId: "session-1", version: 1, status: "draft",
        contentHash: "a".repeat(64), createdAt: "2026-08-19T00:02:00.000Z",
        content: taskCandidate("refrigerator", "冰箱"),
      }],
    });
    const input = { session: view, trigger: { type: "user_message" as const, text: "改成电视机" } };

    expect(requiresCategoryResearch(input, {
      assistantText: "已切换品类。", taskCandidate: taskCandidate("television", "电视机"),
      unresolvedItems: [], resolvedUnresolvedKeys: [],
    })).toBe(true);
    expect(requiresCategoryResearch(input, {
      assistantText: "只补充来源。", taskCandidate: taskCandidate("refrigerator", "冰箱"),
      unresolvedItems: [], resolvedUnresolvedKeys: [],
    })).toBe(false);

    expect(requiresCategoryResearch(input, {
      assistantText: "品类标签已经切换。",
      taskCandidate: taskCandidate("refrigerator", "电视机"),
      unresolvedItems: [], resolvedUnresolvedKeys: [],
    })).toBe(true);
  });

});

function taskCandidate(code: string, label: string) {
  return {
    originalRequest: `抓${label}`,
    category: { code, label },
    marketScope: "中国大陆当前在售新品",
    generalTopics: ["品牌、型号和参数"], categoryTopics: [],
    jd: { applicable: true, disposition: "included" as const, scope: [], rationale: "默认覆盖。" },
    sourceCandidates: [], excludedContent: [], unresolvedItems: [], decisionIds: [],
  };
}

function message(
  sequence: number,
  role: "user" | "assistant",
  text: string,
  deliveryStatus: "completed" | "failed",
) {
  return {
    id: `message-${sequence}`,
    sessionId: "session-1",
    sequence,
    role,
    text,
    deliveryStatus,
    ...(deliveryStatus === "failed" ? { error: "首轮失败" } : {}),
    createdAt: `2026-08-19T00:0${sequence}:00.000Z`,
  };
}
