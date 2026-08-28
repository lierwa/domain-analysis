import { sourceDatasetRunViewSchema, sourceDatasetTaskViewSchema } from "@domain-analysis/shared";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildSourceDataGraph,
  groupSourceRunsByBatch,
  initialSourceDataMapExpansion,
  shouldPollSourceDataset,
  shouldPollSourceRun,
  SourceRunDetail,
  visibleSourceDataGraph,
} from "../src/pages/SourceDatasetPanel";
import { sourceDataMapNodeSize } from "../src/pages/SourceDatasetMapCanvas";

describe("原始数据血缘地图", () => {
  it("初始一次展开全部结构节点和记录组首批行，单条快照正文仍不进入图模型", () => {
    const dataset = sourceDatasetTaskViewSchema.parse({
      batches: [],
      runs: [{ ...view().run, sourceCollectionPlanSourceKey: "zol.catalog" }],
      sources: [{ planId: "plan-1", planVersion: 2, planStatus: "confirmed", sourceKey: "zol.catalog",
        name: "ZOL 电视产品库", publisher: "中关村在线", sourceKind: "other",
        role: "跨品牌市场目录", targets: [{ targetKey: "market.catalog", name: "电视门类与产品页",
          captureUnit: "公开目录页", taskTopics: ["品牌", "型号"], recordGroups: [
            recordGroup("planned_entry:0", 1, "html"),
            recordGroup("html_link:1", 1, "html"),
          ] }] }],
    });

    const graph = buildSourceDataGraph(dataset, task(), "source");
    const collectionId = "collection:source-kind:other";
    const sourceId = "source:plan-1:2:zol.catalog";
    const targetId = `${sourceId}:target:market.catalog`;
    const firstGroupId = `${targetId}:group:planned_entry:0`;
    const secondGroupId = `${targetId}:group:html_link:1`;

    const initialExpanded = initialSourceDataMapExpansion(graph);
    expect([...initialExpanded]).toEqual([collectionId, sourceId, targetId, firstGroupId, secondGroupId]);
    const initialVisible = visibleSourceDataGraph(graph, initialExpanded, "");
    expect(initialVisible.nodes.map((node) => node.kind))
      .toEqual(["task", "collection", "source", "collection", "group", "group"]);
    expect(initialVisible.nodes.find((node) => node.id === `list:${targetId}`)?.inlineChildren)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: `${targetId}:group:planned_entry:0` }),
        expect.objectContaining({ id: `${targetId}:group:html_link:1` }),
      ]));
    expect(initialVisible.nodes.filter((node) => node.recordsVisible).map((node) => node.id))
      .toEqual([`records:${firstGroupId}`, `records:${secondGroupId}`]);

    expect(visibleSourceDataGraph(graph, new Set(), "").nodes.map((node) => node.kind)).toEqual(["task", "collection"]);
    expect(visibleSourceDataGraph(graph, new Set([collectionId]), "").nodes.find((node) => node.id === collectionId)
      ?.inlineChildren?.map((node) => node.id)).toEqual([sourceId]);
    const sourceVisible = visibleSourceDataGraph(graph, new Set([collectionId, sourceId]), "");
    expect(sourceVisible.nodes.map((node) => node.kind)).toEqual(["task", "collection", "source"]);
    expect(sourceVisible.nodes.find((node) => node.id === sourceId)?.inlineChildren?.map((node) => node.id))
      .toEqual([targetId]);
    const expanded = visibleSourceDataGraph(graph, new Set([collectionId, sourceId, targetId]), "");
    expect(expanded.nodes.map((node) => node.kind)).toEqual(["task", "collection", "source", "collection"]);
    expect(expanded.nodes.find((node) => node.id === `list:${targetId}`)?.inlineChildren)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: `${targetId}:group:planned_entry:0` }),
        expect.objectContaining({ id: `${targetId}:group:html_link:1` }),
      ]));
    expect(graph.nodes.some((node) => node.kind === "record")).toBe(false);
    const records = visibleSourceDataGraph(graph,
      new Set([collectionId, sourceId, targetId, `${targetId}:group:html_link:1`]), "");
    expect(records.nodes).toContainEqual(expect.objectContaining({
      id: `records:${targetId}:group:html_link:1`, recordsVisible: true, meta: "1 条 · HTML 1",
    }));
  });

  it("品牌视角只使用计划登记的官网关系，并把公共资料放入独立来源组", () => {
    const dataset = sourceDatasetTaskViewSchema.parse({ batches: [], runs: [],
      sources: [
        planSource("plan-1", 2, "confirmed", "sony.official", "Sony 官网", "Sony"),
        planSource("plan-1", 2, "confirmed", "zol.catalog", "ZOL 电视产品库", "中关村在线"),
      ], brands: [
        { planId: "plan-1", planVersion: 2, planStatus: "confirmed", name: "Sony", aliases: ["索尼"],
          status: "planned", officialSourceKeys: ["sony.official"] },
        { planId: "plan-1", planVersion: 2, planStatus: "confirmed", name: "示例品牌", aliases: [],
          status: "unresolved", officialSourceKeys: [] },
      ] });

    const graph = buildSourceDataGraph(dataset, task(), "brand");

    expect(graph.nodes.filter((node) => ["brand", "shared"].includes(node.kind)).map((node) => node.title))
      .toEqual(["Sony", "示例品牌", "跨品牌与专业资料"]);
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: "brand:Sony",
      target: "source:plan-1:2:sony.official" }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: "shared:cross-brand",
      target: "source:plan-1:2:zol.catalog" }));
    expect(graph.edges).not.toContainEqual(expect.objectContaining({ source: "brand:Sony",
      target: "source:plan-1:2:zol.catalog" }));
  });

  it("内容视角直接投影 target 中持久化的任务主题", () => {
    const dataset = sourceDatasetTaskViewSchema.parse({ batches: [], runs: [],
      sources: [planSource("plan-1", 2, "confirmed", "zol.catalog", "ZOL 电视产品库", "中关村在线")] });

    const graph = buildSourceDataGraph(dataset, task(), "content");

    expect(graph.nodes.filter((node) => node.kind === "topic").map((node) => node.title)).toEqual(["品牌", "型号"]);
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: "topic:%E5%93%81%E7%89%8C",
      target: "source:plan-1:2:zol.catalog" }));
  });

  it("大量记录只形成一个汇总节点，并可按资源类型搜索", () => {
    const run = { ...view().run, sourceCollectionPlanSourceKey: "zol.catalog" };
    const dataset = sourceDatasetTaskViewSchema.parse({ batches: [], runs: [run],
      sources: [planSource("plan-1", 2, "confirmed", "zol.catalog", "ZOL 电视产品库", "中关村在线",
        [recordGroup("unrecorded", 1_000, "pdf")])] });
    const graph = buildSourceDataGraph(dataset, task(), "source");
    const sourceId = "source:plan-1:2:zol.catalog";
    const targetId = `${sourceId}:target:market.catalog`;

    const groupId = `${targetId}:group:unrecorded`;
    const expanded = visibleSourceDataGraph(graph, new Set(["collection:source-kind:other", sourceId, targetId]), "");
    expect(graph.nodes.filter((node) => node.kind === "record")).toHaveLength(0);
    expect(expanded.nodes.find((node) => node.id === sourceId)?.inlineChildren)
      .toContainEqual(expect.objectContaining({ kind: "target", id: targetId }));
    const summary = expanded.nodes.find((node) => node.id === groupId)!;
    expect(summary).toEqual(expect.objectContaining({ kind: "group", meta: "1000 条 · PDF 1000" }));
    expect(summary.recordsVisible).toBeUndefined();
    const records = visibleSourceDataGraph(graph,
      new Set(["collection:source-kind:other", sourceId, targetId, groupId]), "");
    expect(records.nodes).toContainEqual(expect.objectContaining({ id: groupId, recordsVisible: true }));
    const searched = visibleSourceDataGraph(graph, new Set(), "PDF");
    expect(searched.nodes).toContainEqual(expect.objectContaining({
      id: `${targetId}:group:unrecorded`, searchMatched: true,
    }));
  });

  it("来源列表行连接各自复合来源节点，并允许多个分支同时展开", () => {
    const sources = Array.from({ length: 7 }, (_, index) => planSource("plan-1", 2, "confirmed",
      `source-${index}`, `来源 ${index}`, `发布方 ${index}`));
    const dataset = sourceDatasetTaskViewSchema.parse({ batches: [], runs: [], sources });
    const graph = buildSourceDataGraph(dataset, task(), "source");
    const collectionId = "collection:source-kind:other";
    const sourceId = "source:plan-1:2:source-0";
    const secondSourceId = "source:plan-1:2:source-1";

    const bundled = visibleSourceDataGraph(graph, new Set([collectionId]), "");
    expect(bundled.nodes.map((node) => node.kind)).toEqual(["task", "collection"]);
    expect(bundled.nodes.find((node) => node.id === collectionId)?.inlineChildren).toHaveLength(7);

    const drilled = visibleSourceDataGraph(graph, new Set([collectionId, sourceId, secondSourceId]), "");
    expect(drilled.nodes.map((node) => node.kind)).toEqual(["task", "collection", "source", "source"]);
    expect(drilled.nodes.filter((node) => node.kind === "source")
      .every((node) => node.inlineChildren?.length === 1)).toBe(true);
    expect(drilled.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: collectionId, sourceHandle: sourceId,
        target: sourceId }),
      expect.objectContaining({ source: collectionId, sourceHandle: secondSourceId,
        target: secondSourceId }),
    ]));
    expect(drilled.edges.every((edge) => !("label" in edge))).toBe(true);
    const collection = bundled.nodes.find((node) => node.id === collectionId)!;
    expect(sourceDataMapNodeSize(collection)).toEqual({ width: 350, height: 364 });
  });

  it("记录组可以收起为摘要，展开时显示自适应高度的记录列表", () => {
    const dataset = sourceDatasetTaskViewSchema.parse({ batches: [], runs: [],
      sources: [planSource("plan-1", 2, "confirmed", "single", "单条来源", "发布方",
        [recordGroup("unrecorded", 1, "html")])] });
    const graph = buildSourceDataGraph(dataset, task(), "source");
    const sourceId = "source:plan-1:2:single";
    const targetId = `${sourceId}:target:market.catalog`;
    const groupId = `${targetId}:group:unrecorded`;
    const visible = visibleSourceDataGraph(graph,
      new Set(["collection:source-kind:other", sourceId, targetId]), "");
    const source = visible.nodes.find((node) => node.id === sourceId)!;
    const summary = visible.nodes.find((node) => node.id === groupId)!;

    expect(source.inlineChildren).toContainEqual(expect.objectContaining({ id: targetId }));
    expect(summary).toEqual(expect.objectContaining({ kind: "group" }));
    expect(summary.recordsVisible).toBeUndefined();
    expect(visible.edges).toContainEqual(expect.objectContaining({ source: sourceId, sourceHandle: targetId,
      target: groupId }));
    expect(sourceDataMapNodeSize(summary)).toEqual({ width: 292, height: 86 });
    const records = visibleSourceDataGraph(graph,
      new Set(["collection:source-kind:other", sourceId, targetId, groupId]), "")
      .nodes.find((node) => node.id === groupId)!;
    expect(records).toEqual(expect.objectContaining({ recordsVisible: true }));
    expect(sourceDataMapNodeSize(records)).toEqual({ width: 360, height: 160 });
  });

  it("同一来源和多个捕获目标形成一张复合节点，点击目标行后复合节点保持不变", () => {
    const targets = ["规格下载", "产品目录", "支持页面"].map((name, index) => ({
      targetKey: `target-${index}`, name, captureUnit: "公开页面", taskTopics: ["型号"],
      recordGroups: [recordGroup("html_link:1", 1, "html")],
    }));
    const dataset = sourceDatasetTaskViewSchema.parse({ batches: [], runs: [], sources: [{
      planId: "plan-1", planVersion: 2, planStatus: "confirmed", sourceKey: "brand.official",
      name: "品牌官网", publisher: "品牌", sourceKind: "brand_official", role: "品牌官网资料", targets,
    }] });
    const graph = buildSourceDataGraph(dataset, task(), "source");
    const collectionId = "collection:source-kind:brand_official";
    const sourceId = "source:plan-1:2:brand.official";
    const targetId = `${sourceId}:target:target-0`;

    const targetsVisible = visibleSourceDataGraph(graph, new Set([collectionId, sourceId]), "");
    expect(targetsVisible.nodes.find((node) => node.id === sourceId)?.inlineChildren).toHaveLength(3);
    expect(targetsVisible.nodes.filter((node) => node.kind === "target")).toHaveLength(0);

    const groupId = `${targetId}:group:html_link:1`;
    const recordsVisible = visibleSourceDataGraph(graph, new Set([collectionId, sourceId, targetId, groupId]), "");
    expect(recordsVisible.nodes.find((node) => node.id === sourceId)?.inlineChildren).toHaveLength(3);
    expect(recordsVisible.nodes).toContainEqual(expect.objectContaining({
      id: groupId, recordsVisible: true,
    }));
    expect(recordsVisible.edges).toContainEqual(expect.objectContaining({
      source: sourceId, sourceHandle: targetId, target: groupId,
    }));
  });

  it("按一次开始抓取的批次分组，并把旧记录明确隔离", () => {
    const grouped = groupSourceRunsByBatch({
      batches: [{ id: "batch-new", taskId: "task-1", sourceCollectionPlanId: "plan-2",
        sourceCollectionPlanVersion: 2, taskRevision: 2, status: "partial", plannedSourceCount: 2,
        startedAt: "2026-08-21T08:00:00.000Z", finishedAt: "2026-08-21T08:01:00.000Z" }],
      runs: [
        { ...view().run, id: "run-new", executionBatchId: "batch-new", sourceCollectionPlanVersion: 2 },
        { ...view().run, id: "run-old", executionBatchId: undefined, sourceCollectionPlanVersion: 1 },
      ],
    });

    expect(grouped).toEqual([
      expect.objectContaining({ label: "批次 batch-new", planVersion: 2,
        runs: [expect.objectContaining({ id: "run-new" })] }),
      expect.objectContaining({ label: "未关联批次的记录",
        runs: [expect.objectContaining({ id: "run-old" })] }),
    ]);
  });

  it("展示 target 结果、计划版本和附件下载入口", () => {
    const html = renderToString(<SourceRunDetail taskId="task-1" view={view()} />);
    const visible = html.replaceAll("<!-- -->", "");

    expect(visible).toContain("清单逐项对账");
    expect(visible).toContain("standard.document");
    expect(visible).toContain("completed");
    expect(visible).toContain("计划 v2");
    expect(html).toContain("/api/capture-tasks/task-1/source-runs/run-1/assets/asset-1");
    expect(visible).toContain("GB-原文.pdf · 4 B");
    expect(visible).toContain("请求账本 2 / 4");
    expect(visible).toContain("circuit closed");
    expect(visible).toContain("捕获工作项");
    expect(visible).toContain("1 · 1 completed");
    expect(visible).toContain("图片 URL 引用 25");
    expect(visible).toContain("https://img.example.com/24.webp");
    expect(visible).not.toContain("显式继续");
  });

  it("只在后台批次或来源仍运行时持续刷新持久状态", () => {
    const running = { batches: [{ id: "batch-running", taskId: "task-1", sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanVersion: 2, taskRevision: 2, status: "running" as const, plannedSourceCount: 1,
      startedAt: "2026-08-21T08:00:00.000Z" }], runs: [] };
    expect(shouldPollSourceDataset(running)).toBe(true);
    expect(shouldPollSourceDataset({ ...running, batches: running.batches.map((batch) => ({ ...batch,
      status: "completed" as const, finishedAt: "2026-08-21T08:01:00.000Z" })) })).toBe(false);
  });

  it("最新批次已结束时不被历史僵尸运行触发永久刷新", () => {
    const dataset = pollingView("partial");

    expect(shouldPollSourceDataset(dataset)).toBe(false);
    expect(shouldPollSourceRun(dataset, "run-stale")).toBe(false);
  });

  it("只刷新最新运行批次及其所属来源详情", () => {
    const dataset = pollingView("running");

    expect(shouldPollSourceDataset(dataset)).toBe(true);
    expect(shouldPollSourceRun(dataset, "run-current")).toBe(true);
    expect(shouldPollSourceRun(dataset, "run-stale")).toBe(false);
  });

});

function pollingView(latestStatus: "running" | "partial") {
  const startedAt = "2026-08-21T08:00:00.000Z";
  const staleStartedAt = "2026-08-20T08:00:00.000Z";
  return sourceDatasetTaskViewSchema.parse({
    batches: [
      { id: "batch-current", taskId: "task-1", sourceCollectionPlanId: "plan-2",
        sourceCollectionPlanVersion: 2, taskRevision: 2, status: latestStatus, plannedSourceCount: 1,
        startedAt, ...(latestStatus === "partial"
          ? { finishedAt: "2026-08-21T08:01:00.000Z", terminationReason: "fixture partial" } : {}) },
      { id: "batch-stale", taskId: "task-1", sourceCollectionPlanId: "plan-1",
        sourceCollectionPlanVersion: 1, taskRevision: 1, status: "running", plannedSourceCount: 1,
        startedAt: staleStartedAt },
    ],
    runs: [
      { ...view().run, id: "run-current", executionBatchId: "batch-current",
        sourceCollectionPlanId: "plan-2", sourceCollectionPlanVersion: 2,
        status: latestStatus === "running" ? "running" : "failed",
        startedAt, finishedAt: latestStatus === "running" ? undefined : "2026-08-21T08:01:00.000Z",
        terminationReason: latestStatus === "running" ? undefined : "fixture failed" },
      { ...view().run, id: "run-stale", executionBatchId: "batch-stale",
        status: "running", startedAt: staleStartedAt, finishedAt: undefined, terminationReason: undefined },
    ],
  });
}

function task() {
  return { id: "task-1", name: "电视抓取任务", category: "电视" };
}

function view() {
  const timestamp = "2026-08-20T00:00:00.000Z";
  return sourceDatasetRunViewSchema.parse({
    run: { id: "run-1", taskId: "task-1", sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanSourceKey: "standard", sourceCollectionPlanVersion: 2,
      providerKey: "public.web-resource", providerVersion: "2.0.0",
      accessPolicy: { kind: "manual", version: "fixture" }, status: "failed",
      requestBudget: 4,
      snapshotCount: 1, accessibleCount: 1, failedCount: 0, assetCount: 1,
      startedAt: timestamp, finishedAt: timestamp, terminationReason: "rate_limited" },
    targets: [{ id: "target-run-1", runId: "run-1", targetKey: "standard.document",
      status: "completed", snapshotCount: 1, accessibleCount: 1, failedCount: 0, assetCount: 1,
      startedAt: timestamp, finishedAt: timestamp, terminationReason: "target_scope_completed" }],
    workItems: [{ id: "work-1", runId: "run-1", targetKey: "standard.document",
      workKey: "get:standard", captureUnit: "document", expectedUnitCount: 1, observedUnitCount: 1,
      status: "completed", createdAt: timestamp, startedAt: timestamp, finishedAt: timestamp }],
    requestAttempts: [0, 1].map((ordinal) => ({ id: `attempt-${ordinal}`, runId: "run-1",
      targetKey: "standard.document", workKey: "get:standard", gateKey: "public@1",
      requestedUrl: `https://example.com/gb.pdf?attempt=${ordinal}`, origin: "https://example.com",
      startedAt: timestamp, finishedAt: timestamp, finalUrl: "https://example.com/gb.pdf",
      httpStatus: 200, bytes: 4, state: "completed" })),
    accessGates: [{ key: "public@1", providerKey: "public.web-resource", providerVersion: "2.0.0",
      policyVersion: "fixture", circuitState: "closed", windowRequestCount: 2,
      manualResumeRequired: false, updatedAt: timestamp }],
    records: [{ object: { id: "object-1", taskId: "task-1", sourceIdentity: "国家标准全文公开系统",
      kind: "document", externalKey: "https://example.com/gb.pdf", createdAt: timestamp },
      snapshot: { id: "snapshot-1", runId: "run-1", targetKey: "standard.document",
        objectId: "object-1", idempotencyKey: "standard-document-hash",
        observation: { requestedUrl: "https://example.com/gb.pdf", finalUrl: "https://example.com/gb.pdf",
          observedAt: timestamp, state: "accessible", httpStatus: 200, responseHeaders: {} },
        payload: { kind: "asset", assetKey: "raw", filename: "GB-原文.pdf", mediaType: "application/pdf",
          bytes: 4, contentHash: "0".repeat(64) }, contentHash: "1".repeat(64), createdAt: timestamp },
      assets: [{ id: "asset-1", snapshotId: "snapshot-1", assetKey: "raw", filename: "GB-原文.pdf",
        sourceUrl: "https://example.com/gb.pdf", mediaType: "application/pdf", contentHash: "0".repeat(64),
        casIntegrity: "sha512-fixture", bytes: 4, createdAt: timestamp }],
      resourceReferences: Array.from({ length: 25 }, (_, ordinal) => ({
        id: `reference-${ordinal}`, snapshotId: "snapshot-1", kind: "image",
        sourceUrl: `https://img.example.com/${ordinal}.webp`, observedValue: `//img.example.com/${ordinal}.webp`,
        locator: `#description img:nth-of-type(${ordinal + 1})@data-src`, role: "detail",
        section: "description", ordinal, createdAt: timestamp,
      })) }],
  });
}

function planSource(planId: string, planVersion: number, planStatus: "confirmed" | "superseded",
  sourceKey: string, name: string, publisher: string,
  recordGroups: Array<ReturnType<typeof recordGroup>> = []) {
  return { planId, planVersion, planStatus, sourceKey, name, publisher, sourceKind: "other" as const,
    role: "市场目录", targets: [{ targetKey: "market.catalog", name: "电视目录",
      captureUnit: "公开目录页", taskTopics: ["品牌", "型号"], recordGroups }] };
}

function recordGroup(groupKey: "planned_entry:0" | "html_link:1" | "unrecorded", totalCount: number,
  format: "html" | "pdf") {
  return { groupKey, totalCount, outcomes: { accepted: totalCount, supporting: 0, rejected: 0, failed: 0 },
    formats: [{ format, count: totalCount }] };
}
