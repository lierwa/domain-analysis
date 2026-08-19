import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/pages/CategoryInterviewTimeline", () => ({
  ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY: "domain-analysis.active-category-interview",
  CategoryInterviewTimeline: () => <section aria-label="抓取任务对话" />,
}));

import { CaptureTaskWorkspacePage } from "../src/pages/CaptureTaskWorkspacePage";
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
});
