/** @vitest-environment jsdom */

import { sourceDatasetRunAuditViewSchema, sourceDatasetTaskViewSchema } from "@domain-analysis/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSourceDataGraph,
  formatRunElapsed,
  groupSourceRunsByBatch,
  initialSourceDataMapExpansion,
  latestRunForPlan,
  shouldPollSourceDataset,
  shouldPollSourceRun,
  SourceRunDetail,
  SourceDatasetPanel,
  visibleSourceDataGraph,
} from "../src/pages/SourceDatasetPanel";
import { SourceExecutionControls } from "../src/pages/SourceExecutionControls";
import { sourceDataMapExpansionPath } from "../src/pages/sourceDatasetMapModel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Source Dataset 商品地图", () => {
  it("默认只展示品牌摘要，不把 247 个型号和图片节点放进首屏", () => {
    const graph = buildSourceDataGraph(dataset(), task(), "product");
    const visible = visibleSourceDataGraph(graph, initialSourceDataMapExpansion(graph), "");

    expect([...initialSourceDataMapExpansion(graph)]).toEqual([]);
    expect(visible.nodes.map((node) => node.kind)).toEqual(["task", "brand", "brand"]);
    expect(graph.nodes.filter((node) => node.kind === "model")).toHaveLength(3);
    expect(graph.nodes.some((node) => node.kind === "image")).toBe(false);
    expect(graph.nodes.find((node) => node.kind === "brand")?.meta).toContain("个型号完成");
  });

  it("一次只展开品牌到型号的活动路径，资源节点按页读取", () => {
    const graph = buildSourceDataGraph(dataset(), task(), "product");
    const modelId = "model:model-1";
    const path = sourceDataMapExpansionPath(graph, modelId);
    const brandVisible = visibleSourceDataGraph(graph, new Set(["brand:brand-1"]), "");
    const modelVisible = visibleSourceDataGraph(graph, path, "");

    expect([...path]).toEqual([modelId, "brand:brand-1"]);
    expect(brandVisible.nodes.find((node) => node.id === "list:brand:brand-1")?.inlineChildren)
      .toHaveLength(2);
    expect(modelVisible.nodes.find((node) => node.id === `list:${modelId}`)?.inlineChildren)
      .toEqual(expect.arrayContaining([expect.objectContaining({ kind: "resource", title: "图片" })]));
    const resourceId = `${modelId}:resource:image`;
    const records = visibleSourceDataGraph(graph, sourceDataMapExpansionPath(graph, resourceId), "");
    expect(records.nodes).toContainEqual(expect.objectContaining({ id: `records:${resourceId}`,
      recordsVisible: true }));
  });

  it("警告只落在异常型号，品牌和任务只显示汇总数字", () => {
    const graph = buildSourceDataGraph(dataset(), task(), "product");

    expect(graph.nodes.find((node) => node.id === "task:task-1")?.status).toBe("neutral");
    expect(graph.nodes.find((node) => node.id === "brand:brand-1")?.status).toBe("neutral");
    expect(graph.nodes.find((node) => node.id === "model:model-2")?.status).toBe("attention");
    expect(graph.stats.attentionCount).toBe(1);
  });

  it("已处理但源站无图片的型号只显示来源标识", () => {
    const view = dataset();
    const brand = view.capturedBrands[0]!;
    const model = brand.models[1]!;
    model.status = "completed";
    model.issueCount = 0;
    brand.counts = { total: 2, completed: 2, needsAttention: 0 };
    view.issues = [];
    view.currentExecution = { ...view.currentExecution!, completedModelCount: 247,
      needsAttentionModelCount: 0, issueCount: 0 };

    const graph = buildSourceDataGraph(view, task(), "product");
    const node = graph.nodes.find((item) => item.id === "model:model-2");

    expect(node?.status).toBe("neutral");
    expect(node?.meta).toContain("来源无图片");
    expect(graph.stats.attentionCount).toBe(0);
  });

  it("搜索型号时只带出该型号及其品牌血缘", () => {
    const graph = buildSourceDataGraph(dataset(), task(), "product");
    const searched = visibleSourceDataGraph(graph, new Set(), "1228243");

    expect(searched.nodes.map((node) => node.id)).toEqual([
      "task:task-1", "brand:brand-1", "model:model-2",
    ]);
    expect(searched.nodes.find((node) => node.id === "model:model-2")?.searchMatched).toBe(true);
  });

  it("运行审计明确投影来源、Batch、Run 和记录组", () => {
    const graph = buildSourceDataGraph(dataset(), task(), "audit");
    const runId = "run:run-1";
    const visible = visibleSourceDataGraph(graph, sourceDataMapExpansionPath(graph, runId), "");

    expect(graph.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining([
      "source", "batch", "run", "audit_group",
    ]));
    expect(visible.nodes.find((node) => node.id === `list:${runId}`)?.inlineChildren)
      .toEqual(expect.arrayContaining([expect.objectContaining({ title: "原始快照" }),
        expect.objectContaining({ title: "图片附件" })]));
  });

  it("Run 详情只渲染轻量审计，不渲染整批图片画廊", () => {
    const html = renderToString(<SourceRunDetail taskId="task-1" view={runAudit()} />)
      .replaceAll("<!-- -->", "");

    expect(html).toContain("运行审计");
    expect(html).toContain("原始记录组");
    expect(html).toContain("请求尝试");
    expect(html).not.toContain("型号图片画廊");
    expect(html).not.toContain("<img");
  });

  it("从记录组进入 Run 审计后，Esc 把焦点还给最初的地图触发按钮", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["source-runs", "task-1"], dataset());
    client.setQueryData(["source-run", "task-1", "run-1"], runAudit());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0); return 1;
    });
    render(<QueryClientProvider client={client}>
      <SourceDatasetPanel task={captureTask()} />
    </QueryClientProvider>);

    await user.click(screen.getByRole("button", { name: "运行审计" }));
    await user.click(screen.getByRole("button", { name: "大纲" }));
    await user.click(screen.getByRole("button", { name: /展开ZOL 家用微波炉/ }));
    await user.click(screen.getByRole("button", { name: /展开Batch/ }));
    await user.click(screen.getByRole("button", { name: "展开Run · run-1" }));
    const trigger = screen.getByRole("button", { name: /原始快照 3799 条/ });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "打开 Run 审计" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toBe(document.activeElement);
  });

  it("完成态只提供二级重新执行，不再展示启动计划主按钮", () => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}>
      <SourceExecutionControls task={captureTask()} view={dataset()} />
    </QueryClientProvider>);

    expect(screen.getByRole("button", { name: "重新执行计划" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "启动计划 v2" })).toBeNull();
    expect(screen.getByText("246/247")).toBeTruthy();
    expect(screen.getByText("3799")).toBeTruthy();
  });

  it("在 Source Dataset 展示全部资料的最低覆盖结论", () => {
    const client = new QueryClient();
    client.setQueryData(["source-runs", "task-1"], dataset());
    render(<QueryClientProvider client={client}>
      <SourceDatasetPanel task={captureTask()} />
    </QueryClientProvider>);

    expect(screen.getByText("原始资料入口最低覆盖：已达到")).toBeTruthy();
  });

  it("只轮询当前活动 Batch，并保留运行时间格式", () => {
    const active = sourceDatasetTaskViewSchema.parse({ ...dataset(), currentExecution: {
      ...dataset().currentExecution!, status: "running", recoveryState: "none", finishedAt: undefined,
    }, runs: dataset().runs.map((run) => ({ ...run, status: "running", finishedAt: undefined })) });
    expect(shouldPollSourceDataset(active)).toBe(true);
    expect(shouldPollSourceRun(active, "run-1")).toBe(true);
    expect(shouldPollSourceDataset(dataset())).toBe(false);
    expect(formatRunElapsed("2026-08-21T08:00:00.000Z",
      Date.parse("2026-08-21T09:07:42.000Z"))).toBe("1 小时 07 分");
  });

  it("运行辅助函数仍以 Batch 为边界", () => {
    expect(groupSourceRunsByBatch(dataset())[0]).toEqual(expect.objectContaining({
      label: "批次 batch-1", runs: [expect.objectContaining({ id: "run-1" })],
    }));
    expect(latestRunForPlan(dataset(), "plan-1", 2, "zol.microwave_oven.ranked-brands")?.id)
      .toBe("run-1");
  });
});

function dataset() {
  return sourceDatasetTaskViewSchema.parse({
    batches: [{ id: "batch-1", taskId: "task-1", sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanVersion: 2, taskRevision: 1, status: "completed", recoveryState: "completed",
      plannedSourceCount: 1, startedAt: "2026-08-31T01:00:00.000Z", finishedAt: "2026-08-31T05:00:00.000Z" }],
    runs: [run()],
    executions: [{ batchId: "batch-1", taskId: "task-1", sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanVersion: 2, taskRevision: 1, status: "completed", plannedSourceCount: 1,
      latestRuns: [run()], counts: { running: 0, completed: 1, failed: 0, stopped: 0, missing: 0 },
      failureCounts: {} }],
    sources: [{ planId: "plan-1", planVersion: 2, planStatus: "confirmed",
      sourceKey: "zol.microwave_oven.ranked-brands", name: "ZOL 家用微波炉榜单品牌参数与图集",
      publisher: "中关村在线", sourceKind: "other", role: "跨品牌市场目录", targets: [] }],
    currentExecution: { batchId: "batch-1", status: "completed", recoveryState: "completed", planVersion: 2,
      runCount: 4, snapshotCount: 3799, assetCount: 2918, brandCount: 19, modelCount: 247,
      completedModelCount: 246, needsAttentionModelCount: 1, issueCount: 1,
      cumulativeRunDurationMs: 13_949_670, startedAt: "2026-08-31T01:00:00.000Z",
      finishedAt: "2026-08-31T05:00:00.000Z" },
    capturedBrands: [
      { subjectId: "brand-1", sourceEntityId: "fotile", displayName: "方太", counts: {
        total: 2, completed: 1, needsAttention: 1 }, models: [
        { subjectId: "model-1", sourceEntityId: "1228247", displayName: "方太W25800K-E2", status: "completed",
          resources: { parameterPages: 1, galleryPages: 1, pictureSets: 2, images: 12 }, issueCount: 0 },
        { subjectId: "model-2", sourceEntityId: "1228243", displayName: "方太W25800K-01AG",
          status: "needs_attention", resources: { parameterPages: 1, galleryPages: 1, pictureSets: 0, images: 0 },
          issueCount: 1 },
      ] },
      { subjectId: "brand-2", sourceEntityId: "midea", displayName: "美的", counts: {
        total: 1, completed: 1, needsAttention: 0 }, models: [
        { subjectId: "model-3", sourceEntityId: "1406245", displayName: "美的PM2002", status: "completed",
          resources: { parameterPages: 1, galleryPages: 1, pictureSets: 3, images: 22 }, issueCount: 0 },
      ] },
    ],
    issues: [{ id: "issue-1", classification: "content_rejected", subjectId: "model-2",
      requestedUrl: "https://detail.zol.com.cn/1229/1228243/pic.shtml",
      ruleVersion: "zol-catalog-gallery-v2", reason: "图集没有明确的大图分区入口", httpStatus: 200,
      occurrenceCount: 3, runIds: ["run-1", "run-2", "run-3"], latestSnapshotId: "snapshot-1" }],
    coverage: { policyVersion: "source-coverage-v1", status: "satisfied",
      productCatalog: { status: "satisfied", reference: { providerKey: "zol.catalog-gallery",
        sourceBatchId: "batch-1", reason: "ZOL 已完成" } }, acceptedSources: [], attemptedUrls: [],
      families: [coverageDimension("standards_and_regulation", 9, 6, 3),
        coverageDimension("professional_technical", 5, 5, 3),
        coverageDimension("brand_official", 6, 3, 3)],
      facets: [coverageDimension("operating_principle", 7, 7, 2),
        coverageDimension("core_components", 7, 7, 2),
        coverageDimension("safety_and_regulation", 7, 5, 2),
        coverageDimension("performance_and_testing", 10, 8, 2),
        coverageDimension("use_and_maintenance", 6, 5, 2)],
      gaps: [], unfinishedExecutionIds: [], assessedAt: "2026-09-01T00:00:00.000Z" },
  });
}

function coverageDimension(key: string, acceptedSourceCount: number,
  distinctOriginCount: number, minimumAcceptedSources: number) {
  return { key, acceptedSourceCount, distinctOriginCount, minimumAcceptedSources,
    minimumDistinctOrigins: 2, status: "satisfied" as const };
}

function run() {
  return { id: "run-1", taskId: "task-1", executionBatchId: "batch-1",
    sourceCollectionPlanId: "plan-1", sourceCollectionPlanVersion: 2,
    sourceCollectionPlanSourceKey: "zol.microwave_oven.ranked-brands",
    providerKey: "zol.catalog-gallery", providerVersion: "2.0.0",
    accessPolicy: { kind: "manual" as const, version: "fixture" }, status: "completed" as const,
    requestBudget: 4000, snapshotCount: 3799, accessibleCount: 3796, failedCount: 3,
    assetCount: 2918, startedAt: "2026-08-31T01:00:00.000Z", finishedAt: "2026-08-31T05:00:00.000Z" };
}

function runAudit() {
  return sourceDatasetRunAuditViewSchema.parse({ run: run(), targets: [],
    workItems: [{ id: "work-1", runId: "run-1", targetKey: "models", workKey: "asset:image:1406245:0",
      captureUnit: "zol_model_gallery_image", resourceKind: "image", expectedUnitCount: 1,
      observedUnitCount: 1, status: "completed", createdAt: "2026-08-31T01:00:00.000Z" }],
    requestAttempts: [], accessGates: [], recordGroups: [{ targetKey: "models", resourceKind: "image",
      totalCount: 2918 }] });
}

function task() { return { id: "task-1", name: "家用微波炉抓取任务", category: "家用微波炉" }; }
function captureTask() { return { ...task(), revision: 1, content: { category: { label: "家用微波炉" } } } as never; }
