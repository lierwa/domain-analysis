import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/pages/CategoryInterviewTimeline", () => ({
  ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY: "domain-analysis.active-category-interview",
  CategoryInterviewTimeline: () => <section aria-label="抓取任务对话" />,
}));

import {
  CaptureTaskWorkspacePage,
  upsertInterviewPreservingOrder,
} from "../src/pages/CaptureTaskWorkspacePage";
import { ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY } from "../src/pages/CategoryInterviewTimeline";

describe("抓取任务工作区恢复", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("刷新时存在活动采访指针就直接恢复对话，而不是回到正式任务列表", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => key === ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY
          ? "interview-session-active"
          : null,
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <CaptureTaskWorkspacePage />
      </QueryClientProvider>,
    );

    expect(html).toContain("抓取任务对话");
    expect(html).toContain("继续完善抓取范围");
  });

  it("任务记录同时显示未完成采访、正式任务和各自删除入口", () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["category-interviews"], [{
      id: "interview-session-active",
      initialRequest: "抓电视机",
      phase: "active",
      turnState: "idle",
      revision: 1,
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z",
    }]);
    queryClient.setQueryData(["capture-tasks"], [{
      id: "capture-task-ready",
      name: "家用冰箱抓取任务",
      status: "ready",
      revision: 1,
    }]);

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <CaptureTaskWorkspacePage />
      </QueryClientProvider>,
    );

    expect(html).toContain("抓电视机");
    expect(html).toContain("家用冰箱抓取任务");
    expect(html).toContain("aria-label=\"删除抓电视机\"");
    expect(html).toContain("aria-label=\"删除家用冰箱抓取任务\"");
  });

  it("查看或更新已有采访只替换原位置，不把选中项移到列表顶部", () => {
    const current = [interview("first", "第一条"), interview("second", "第二条"), interview("third", "第三条")];
    const changed = { ...current[1]!, initialRequest: "第二条（已更新）", revision: 2 };

    const next = upsertInterviewPreservingOrder(current, changed);

    expect(next.map((item) => item.id)).toEqual(["first", "second", "third"]);
    expect(next[1]).toEqual(changed);
  });

  it("真正新建的采访仍插入任务记录顶部", () => {
    const current = [interview("first", "第一条"), interview("second", "第二条")];

    const next = upsertInterviewPreservingOrder(current, interview("new", "新任务"));

    expect(next.map((item) => item.id)).toEqual(["new", "first", "second"]);
  });
});

function interview(id: string, initialRequest: string) {
  return {
    id, initialRequest, phase: "active" as const, turnState: "idle" as const, revision: 1,
    createdAt: "2026-08-19T00:00:00.000Z", updatedAt: "2026-08-19T00:00:00.000Z",
  };
}
