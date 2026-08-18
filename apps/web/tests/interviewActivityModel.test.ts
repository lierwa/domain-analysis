import type { InterviewTurnActivity } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import {
  completeInterviewActivities,
  mergeInterviewActivity,
} from "../src/pages/interviewActivityModel";

describe("采访活动时间线", () => {
  it("保留已经发生的步骤，只更新同一个工具调用，不让状态倒退", () => {
    const starting = activity("agent-starting", "agent", "启动抓取规划 Agent");
    const analysis = activity("turn-analysis", "analysis", "分析需求与当前抓取范围");
    const search = activity("search-1", "web_search", "搜索网页", "冰箱 中国市场 主流品牌 官方网站");

    let timeline = mergeInterviewActivity([], starting);
    timeline = mergeInterviewActivity(timeline, analysis);
    timeline = mergeInterviewActivity(timeline, search);
    timeline = mergeInterviewActivity(timeline, { ...search, status: "completed" });

    expect(timeline).toEqual([
      { ...starting, status: "completed" },
      { ...analysis, status: "completed" },
      { ...search, status: "completed" },
    ]);
  });

  it("本轮完成时关闭所有仍在运行的 loading", () => {
    const running = activity("turn-finalizing", "finalizing", "校验并生成本轮结果");
    expect(completeInterviewActivities([running])).toEqual([{ ...running, status: "completed" }]);
  });
});

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
