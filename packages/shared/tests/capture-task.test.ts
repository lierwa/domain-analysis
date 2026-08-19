import { describe, expect, it } from "vitest";

import { categoryInterviewRuntimeOutputSchema, interviewTimelineEventSchema } from "../src";

describe("抓取任务对话契约", () => {
  it("即使换成 jd.intent 也拒绝把京东默认覆盖伪装成负责人问题", () => {
    const result = categoryInterviewRuntimeOutputSchema.safeParse({
      assistantText: "需要确认京东意向。",
      proposedDecision: {
        key: "jd.intent",
        question: "是否纳入京东？",
        options: [
          { label: "纳入", description: "抓取可访问内容", recommended: true },
          { label: "不纳入", description: "只看官网", recommended: false },
        ],
        selection: "纳入",
        rationale: "该取舍会改变来源范围。",
      },
      unresolvedItems: [],
      resolvedUnresolvedKeys: [],
    });
    expect(result.success).toBe(false);
  });

  it("允许非京东取舍在代价说明中提及京东来源", () => {
    const result = categoryInterviewRuntimeOutputSchema.safeParse({
      assistantText: "需要确认型号生命周期范围。",
      proposedDecision: {
        key: "catalog.lifecycle-scope",
        question: "首期是否纳入近两年停售型号？",
        options: [
          { label: "仅当前在售", description: "边界清晰，京东当前页更容易核验。", recommended: true },
          { label: "加近两年停售", description: "覆盖更广，但会增加京东历史页核验量。", recommended: false },
        ],
        selection: "仅当前在售",
        rationale: "该取舍决定型号生命周期，不是在询问是否纳入京东。",
      },
      unresolvedItems: [],
      resolvedUnresolvedKeys: [],
    });

    expect(result.success).toBe(true);
  });

  it("拒绝 generic key 下用口语再次询问京东是否必需", () => {
    const result = categoryInterviewRuntimeOutputSchema.safeParse({
      assistantText: "还需要确认一个来源问题。",
      proposedDecision: {
        key: "source.primary-platform",
        question: "要京东数据吗？",
        options: [
          { label: "要", description: "加入平台数据。", recommended: true },
          { label: "不要", description: "只使用官网。", recommended: false },
        ],
        selection: "要",
        rationale: "等待负责人选择。",
      },
      unresolvedItems: [],
      resolvedUnresolvedKeys: [],
    });

    expect(result.success).toBe(false);
  });

  it("淘宝即使伪装成内容边界也不能成为负责人选择题", () => {
    const result = categoryInterviewRuntimeOutputSchema.safeParse({
      assistantText: "需要确认淘宝范围。",
      proposedDecision: {
        key: "catalog.data-scope",
        question: "要淘宝数据吗？",
        options: [
          { label: "要淘宝", description: "后续再接入。", recommended: true },
          { label: "不要淘宝", description: "只保留其他来源。", recommended: false },
        ],
        selection: "要淘宝",
        rationale: "等待负责人选择。",
      },
      unresolvedItems: [], resolvedUnresolvedKeys: [],
    });

    expect(result.success).toBe(false);
  });

  it("允许生命周期问题提到官网销售范围，而不是把官网本身当来源选择", () => {
    const result = categoryInterviewRuntimeOutputSchema.safeParse({
      assistantText: "需要确认型号生命周期。",
      proposedDecision: {
        key: "catalog.lifecycle-scope",
        question: "是否覆盖当前在官网销售的型号？",
        options: [
          { label: "仅当前在售", description: "边界清晰。", recommended: true },
          { label: "包含停售型号", description: "历史覆盖更广。", recommended: false },
        ],
        selection: "仅当前在售",
        rationale: "这是型号生命周期边界。",
      },
      unresolvedItems: [], resolvedUnresolvedKeys: [],
    });

    expect(result.success).toBe(true);
  });
});

describe("抓取任务对话结构约束", () => {
  it("推荐选择必须与唯一推荐选项一致", () => {
    const result = categoryInterviewRuntimeOutputSchema.safeParse({
      assistantText: "需要确认生命周期。",
      proposedDecision: {
        key: "catalog.lifecycle-scope",
        question: "是否纳入停售型号？",
        options: [
          { label: "仅当前在售", description: "边界清晰。", recommended: true },
          { label: "包含停售", description: "范围更广。", recommended: false },
        ],
        selection: "包含停售",
        rationale: "选择与推荐冲突。",
      },
      unresolvedItems: [], resolvedUnresolvedKeys: [],
    });

    expect(result.success).toBe(false);
  });

  it("允许用户否定问题前提时撤回当前 proposed Decision", () => {
    const result = categoryInterviewRuntimeOutputSchema.safeParse({
      assistantText: "你的纠正成立，这不是负责人取舍；我已按公开事实继续形成草稿。",
      decisionWithdrawal: {
        decisionId: "decision-1",
        rationale: "用户指出该问题应由系统调查，不应要求负责人选择。",
      },
      unresolvedItems: [],
      resolvedUnresolvedKeys: [],
    });

    expect(result.success).toBe(true);
  });

  it("不允许只用 owner=user 未决项代替唯一 proposed Decision", () => {
    const result = categoryInterviewRuntimeOutputSchema.safeParse({
      assistantText: "等待负责人决定。",
      unresolvedItems: [{ key: "catalog.scope", description: "等待确认范围。", owner: "user" }],
      resolvedUnresolvedKeys: [],
    });

    expect(result.success).toBe(false);
  });

  it("只接受带可展示细节和执行状态的产品活动，不接受旧字符串状态", () => {
    expect(interviewTimelineEventSchema.safeParse({
      type: "turn.activity",
      sessionId: "session-1",
      turnId: "turn-1",
      activity: {
        id: "search-1",
        kind: "web_search",
        label: "搜索网页",
        detail: "冰箱 品牌 官网 参数",
        status: "running",
      },
    }).success).toBe(true);
    expect(interviewTimelineEventSchema.safeParse({
      type: "turn.activity",
      sessionId: "session-1",
      turnId: "turn-1",
      activity: "searching_sources",
    }).success).toBe(false);
  });
});
