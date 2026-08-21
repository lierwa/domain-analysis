import { sourceDatasetRunViewSchema } from "@domain-analysis/shared";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { groupSourceRunsByBatch, shouldPollSourceDataset, SourceRunDetail } from "../src/pages/SourceDatasetPanel";

describe("原始来源逐项对账投影", () => {
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
      expect.objectContaining({ label: "历史记录（无批次）",
        runs: [expect.objectContaining({ id: "run-old" })] }),
    ]);
  });

  it("展示 target 结果、计划版本和附件下载入口", () => {
    const html = renderToString(<SourceRunDetail taskId="task-1" view={view()} onResume={() => undefined} />);
    const visible = html.replaceAll("<!-- -->", "");

    expect(visible).toContain("清单逐项对账");
    expect(visible).toContain("standard.document");
    expect(visible).toContain("completed");
    expect(visible).toContain("计划 v2");
    expect(html).toContain("/api/capture-tasks/task-1/source-runs/run-1/assets/asset-1");
    expect(visible).toContain("GB-原文.pdf · 4 B");
    expect(visible).toContain("请求账本 2 / 4");
    expect(visible).toContain("circuit closed");
    expect(visible).toContain("捕获工作项 1");
    expect(visible).toContain("图片 URL 引用 25");
    expect(visible).toContain("https://img.example.com/24.webp");
    expect(visible).toContain("显式继续");
  });

  it("只在后台批次或来源仍运行时持续刷新持久状态", () => {
    const running = { batches: [{ id: "batch-running", taskId: "task-1", sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanVersion: 2, taskRevision: 2, status: "running" as const, plannedSourceCount: 1,
      startedAt: "2026-08-21T08:00:00.000Z" }], runs: [] };
    expect(shouldPollSourceDataset(running)).toBe(true);
    expect(shouldPollSourceDataset({ ...running, batches: running.batches.map((batch) => ({ ...batch,
      status: "completed" as const, finishedAt: "2026-08-21T08:01:00.000Z" })) })).toBe(false);
  });
});

function view() {
  const timestamp = "2026-08-20T00:00:00.000Z";
  return sourceDatasetRunViewSchema.parse({
    run: { id: "run-1", taskId: "task-1", sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanSourceKey: "standard", sourceCollectionPlanVersion: 2,
      providerKey: "jd.catalog-product", providerVersion: "2.0.0",
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
    accessGates: [{ key: "public@1", providerKey: "jd.catalog-product", providerVersion: "2.0.0",
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
