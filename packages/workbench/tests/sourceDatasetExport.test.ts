import { sourceDatasetRunViewSchema } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import { serializeSourceDataset } from "../src/sourceDatasetExport";

describe("Source Dataset 导出", () => {
  it("CSV 保留 target 归属与附件清单", async () => {
    const output = await collect(serializeSourceDataset(view(), "csv"));

    expect(output).toContain("run_id,target_key,snapshot_id");
    expect(output).toContain("standard.document");
    expect(output).toContain("standard.pdf");
  });
});

function view() {
  const at = "2026-08-20T00:00:00.000Z";
  return sourceDatasetRunViewSchema.parse({
    run: { id: "run-1", taskId: "task-1", sourceCollectionPlanVersion: 2,
      providerKey: "public.web-resource", providerVersion: "1.0.0",
      accessPolicy: { kind: "manual", version: "test" }, status: "completed",
      snapshotCount: 1, accessibleCount: 1, failedCount: 0, assetCount: 1,
      startedAt: at, finishedAt: at },
    targets: [{ id: "target-run-1", runId: "run-1", targetKey: "standard.document",
      status: "completed", snapshotCount: 1, accessibleCount: 1, failedCount: 0,
      assetCount: 1, startedAt: at, finishedAt: at }],
    records: [{ object: { id: "object-1", taskId: "task-1", sourceIdentity: "standards",
      kind: "document", externalKey: "standard", createdAt: at }, snapshot: {
      id: "snapshot-1", runId: "run-1", targetKey: "standard.document", objectId: "object-1",
      idempotencyKey: "standard-1", observation: { requestedUrl: "https://example.com/standard.pdf",
        observedAt: at, state: "accessible", responseHeaders: {} }, payload: { kind: "asset",
        assetKey: "raw", filename: "standard.pdf", mediaType: "application/pdf", bytes: 4,
        contentHash: "0".repeat(64) }, contentHash: "1".repeat(64), createdAt: at }, assets: [{
      id: "asset-1", snapshotId: "snapshot-1", assetKey: "raw", filename: "standard.pdf",
      sourceUrl: "https://example.com/standard.pdf", mediaType: "application/pdf",
      contentHash: "0".repeat(64), casIntegrity: "sha256-test", bytes: 4, createdAt: at,
    }] }],
  });
}

async function collect(iterable: AsyncIterable<string>) {
  let output = "";
  for await (const chunk of iterable) output += chunk;
  return output;
}
