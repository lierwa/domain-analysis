import { sourceDatasetRunViewSchema } from "@domain-analysis/shared";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SourceRunDetail } from "../src/pages/SourceDatasetPanel";

describe("原始来源逐项对账投影", () => {
  it("展示 target 结果、计划版本和附件下载入口", () => {
    const html = renderToString(<SourceRunDetail taskId="task-1" view={view()} />);
    const visible = html.replaceAll("<!-- -->", "");

    expect(visible).toContain("清单逐项对账");
    expect(visible).toContain("standard.document");
    expect(visible).toContain("completed");
    expect(visible).toContain("计划 v2");
    expect(html).toContain("/api/capture-tasks/task-1/source-runs/run-1/assets/asset-1");
    expect(visible).toContain("GB-原文.pdf · 4 B");
  });
});

function view() {
  const timestamp = "2026-08-20T00:00:00.000Z";
  return sourceDatasetRunViewSchema.parse({
    run: { id: "run-1", taskId: "task-1", sourceCollectionPlanId: "plan-1",
      sourceCollectionPlanSourceKey: "standard", sourceCollectionPlanVersion: 2,
      providerKey: "public.web-resource", providerVersion: "1.0.0",
      accessPolicy: { kind: "manual", version: "fixture" }, status: "completed",
      snapshotCount: 1, accessibleCount: 1, failedCount: 0, assetCount: 1,
      startedAt: timestamp, finishedAt: timestamp, terminationReason: "plan_scope_completed" },
    targets: [{ id: "target-run-1", runId: "run-1", targetKey: "standard.document",
      status: "completed", snapshotCount: 1, accessibleCount: 1, failedCount: 0, assetCount: 1,
      startedAt: timestamp, finishedAt: timestamp, terminationReason: "target_scope_completed" }],
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
        casIntegrity: "sha512-fixture", bytes: 4, createdAt: timestamp }] }],
  });
}
