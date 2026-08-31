// @vitest-environment jsdom

import { sourceDatasetTaskViewSchema } from "@domain-analysis/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceDatasetRecordList } from "../src/pages/SourceDatasetRecordList";
import { buildSourceDataGraph } from "../src/pages/sourceDatasetMapModel";

describe("型号原始资源按需读取", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("展开型号资源后只请求一页，并同时显示资源类型文字和颜色样式", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ item: {
      items: [{ snapshotId: "snapshot-1", runId: "run-1", targetKey: "market.catalog",
        sourceIdentity: "zol.catalog", objectKind: "web_resource", externalKey: "https://example.com/item-1",
        observation: { requestedUrl: "https://example.com/item-1", finalUrl: "https://example.com/item-1",
          observedAt: "2026-08-20T00:00:00.000Z", state: "accessible", responseHeaders: {} },
        outcome: "accepted", lineage: { workKey: "page:item-1", discoveryKind: "html_link", depth: 1,
          parentUrl: "https://example.com/catalog" }, resourceFormat: "html",
        captureSubjectId: "model-1", resourceKind: "parameters",
        payload: { kind: "inline_text", mediaType: "text/html", bytes: 1024 },
        assetCount: 0, resourceReferenceCount: 0 }],
      totalCount: 1,
    } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(<QueryClientProvider client={queryClient}>
      <SourceDatasetRecordList taskId="task-1" entity={resourceEntity()} onSelect={() => undefined} />
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
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
    expect(requestUrl.pathname).toBe("/api/capture-tasks/task-1/source-map/records");
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      limit: "30", subjectId: "model-1", resourceKind: "parameters",
    });
  });
});

function resourceEntity() {
  const view = sourceDatasetTaskViewSchema.parse({ batches: [], runs: [], capturedBrands: [{
    subjectId: "brand-1", sourceEntityId: "zol-brand-1", displayName: "测试品牌",
    counts: { total: 1, completed: 1, needsAttention: 0 },
    models: [{ subjectId: "model-1", sourceEntityId: "zol-model-1", displayName: "测试型号",
      status: "completed", issueCount: 0,
      resources: { parameterPages: 1, galleryPages: 0, pictureSets: 0, images: 0 } }],
  }] });
  const entity = buildSourceDataGraph(view, { id: "task-1", name: "电视抓取任务" }, "product")
    .nodes.find((node) => node.entity.kind === "resource")?.entity;
  if (!entity || entity.kind !== "resource") throw new Error("测试型号资源不存在");
  return entity;
}
