// @vitest-environment jsdom

import { sourceDatasetTaskViewSchema } from "@domain-analysis/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceDatasetRecordList } from "../src/pages/SourceDatasetRecordList";
import { buildSourceDataGraph } from "../src/pages/sourceDatasetMapModel";

describe("原始数据记录组按需读取", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("展开记录组后只请求一页，并同时显示资源类型文字和颜色样式", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ item: {
      items: [{ snapshotId: "snapshot-1", runId: "run-1", targetKey: "market.catalog",
        sourceIdentity: "zol.catalog", objectKind: "web_resource", externalKey: "https://example.com/item-1",
        observation: { requestedUrl: "https://example.com/item-1", finalUrl: "https://example.com/item-1",
          observedAt: "2026-08-20T00:00:00.000Z", state: "accessible", responseHeaders: {} },
        outcome: "accepted", lineage: { workKey: "page:item-1", discoveryKind: "html_link", depth: 1,
          parentUrl: "https://example.com/catalog" }, resourceFormat: "html",
        payload: { kind: "inline_text", mediaType: "text/html", bytes: 1024 },
        assetCount: 0, resourceReferenceCount: 0 }],
      totalCount: 1,
    } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(<QueryClientProvider client={queryClient}>
      <SourceDatasetRecordList taskId="task-1" entity={groupEntity()} onSelect={() => undefined} />
    </QueryClientProvider>);

    const name = await screen.findByText("item-1");
    const meta = screen.getByText("内容通过 · 1.0 KB");
    const row = screen.getByRole("button", { name: /item-1/ });
    expect(name.parentElement).toBe(row);
    expect(meta.parentElement).toBe(row);
    expect(screen.getAllByText("HTML")).toHaveLength(1);
    expect(screen.queryByText("HTML 1")).toBeNull();
    expect(screen.getAllByText("HTML")[0]?.className).toContain("orange");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/capture-tasks/task-1/source-map/records?sourceKey=zol.catalog&targetKey=market.catalog&groupKey=html_link%3A1&limit=30",
    );
  });
});

function groupEntity() {
  const view = sourceDatasetTaskViewSchema.parse({ batches: [], runs: [], sources: [{
    planId: "plan-1", planVersion: 1, planStatus: "confirmed", sourceKey: "zol.catalog",
    name: "ZOL 电视产品库", publisher: "中关村在线", sourceKind: "other", role: "跨品牌市场目录",
    targets: [{ targetKey: "market.catalog", name: "电视产品页", captureUnit: "公开产品页",
      taskTopics: ["型号"], recordGroups: [{ groupKey: "html_link:1", totalCount: 1,
        outcomes: { accepted: 1, supporting: 0, rejected: 0, failed: 0 },
        formats: [{ format: "html", count: 1 }] }] }],
  }] });
  const entity = buildSourceDataGraph(view, { id: "task-1", name: "电视抓取任务" }, "source")
    .nodes.find((node) => node.entity.kind === "group")?.entity;
  if (!entity || entity.kind !== "group") throw new Error("测试记录组不存在");
  return entity;
}
