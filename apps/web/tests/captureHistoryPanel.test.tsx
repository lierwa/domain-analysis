/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CaptureHistoryPanel } from "../src/pages/CaptureHistoryPanel";

afterEach(cleanup);

describe("采集历史", () => {
  it("按采集方案关联抓取范围、执行批次和实际产量", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["crawl-planning", "task-1"], {
      taskId: "task-1", taskRevision: 3, runs: [], plans: [{ id: "plan-4", taskId: "task-1",
        taskRevision: 3, version: 4, status: "confirmed", createdAt: "2026-09-01T11:10:53.070Z",
        content: { summary: "沿用商品目录，本次补抓 5 个专业资料入口。", sources: [{ key: "source-1" },
          { key: "source-2" }, { key: "source-3" }, { key: "source-4" }, { key: "source-5" }] } }],
    });
    client.setQueryData(["source-runs", "task-1"], {
      batches: [{ id: "source-batch-12345678", taskId: "task-1", sourceCollectionPlanId: "plan-4",
        sourceCollectionPlanVersion: 4, taskRevision: 3, status: "completed", plannedSourceCount: 5,
        startedAt: "2026-09-01T11:11:27.522Z", finishedAt: "2026-09-01T11:12:56.802Z" }],
      runs: Array.from({ length: 5 }, (_, index) => ({ id: `run-${index}`, executionBatchId: "source-batch-12345678",
        sourceCollectionPlanSourceKey: `public.source-${index}`, providerKey: "public.web-resource",
        status: "completed", snapshotCount: 1, assetCount: index === 0 ? 1 : 0 })),
      coverage: { productCatalog: { status: "satisfied", brandCount: 19, coveredModelCount: 247 },
        acceptedSources: Array.from({ length: 20 }, (_, index) => ({ sourceKey: `source-${index}` })) },
    });
    const onOpenData = vi.fn();
    render(<QueryClientProvider client={client}>
      <CaptureHistoryPanel task={{ id: "task-1", revision: 3 }} onOpenData={onOpenData} />
    </QueryClientProvider>);

    expect(screen.getByText("采集方案 v4")).toBeTruthy();
    expect(screen.getByText(/对应抓取范围修订 v3/)).toBeTruthy();
    expect(screen.getByText("执行完成")).toBeTruthy();
    expect(screen.getByText("5 份快照")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /查看当前可用资料/ }));
    expect(onOpenData).toHaveBeenCalledOnce();
  });
});
