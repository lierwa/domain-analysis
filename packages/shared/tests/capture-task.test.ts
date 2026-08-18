import { describe, expect, it } from "vitest";

import { categoryInterviewRuntimeOutputSchema, interviewTimelineEventSchema } from "../src";

describe("抓取任务对话契约", () => {
  it("拒绝没有唯一推荐项的问题", () => {
    const result = categoryInterviewRuntimeOutputSchema.safeParse({
      assistantText: "需要确认京东意向。",
      question: {
        key: "jd.intent",
        text: "是否纳入京东？",
        options: [
          { label: "纳入", description: "抓取可访问内容", recommended: false },
          { label: "不纳入", description: "只看官网", recommended: false },
        ],
        rationale: "该取舍会改变来源范围。",
      },
      unresolvedItems: [],
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
