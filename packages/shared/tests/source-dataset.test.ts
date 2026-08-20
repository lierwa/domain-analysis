import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sourceProviderEventSchema, sourceSnapshotCommitSchema } from "../src";

describe("来源执行 target contract", () => {
  it("新快照必须明确归属 target", () => {
    const commit = snapshotCommit();
    expect(sourceSnapshotCommitSchema.parse(commit).targetKey).toBe("official.manual");
    const { targetKey: _targetKey, ...withoutTarget } = commit;
    expect(sourceSnapshotCommitSchema.safeParse(withoutTarget).success).toBe(false);
  });

  it("Provider 产物把原始附件字节绑定到明确 target", () => {
    const content = new TextEncoder().encode("manual-pdf");
    const { runId: _runId, targetKey: _targetKey, ...snapshot } = snapshotCommit();
    const event = sourceProviderEventSchema.parse({
      type: "capture",
      targetKey: "official.manual",
      snapshot: {
        ...snapshot,
        payload: {
          kind: "asset",
          assetKey: "manual-pdf",
          filename: "manual.pdf",
          mediaType: "application/pdf",
          bytes: content.byteLength,
          contentHash: hash(content),
        },
      },
      assets: [{
        assetKey: "manual-pdf",
        filename: "manual.pdf",
        sourceUrl: "https://example.com/manual.pdf",
        mediaType: "application/pdf",
        contentHash: hash(content),
        content,
      }],
    });

    expect(event).toMatchObject({ type: "capture", targetKey: "official.manual" });
  });

  it("拒绝把没有原始内容的 accessible 事件计为完成", () => {
    const { runId: _runId, targetKey: _targetKey, ...snapshot } = snapshotCommit();
    expect(sourceProviderEventSchema.safeParse({
      type: "capture", targetKey: "official.manual", snapshot, assets: [],
    }).success).toBe(false);
  });
});

function snapshotCommit() {
  return {
    runId: "run-1",
    targetKey: "official.manual",
    idempotencyKey: "manual-1",
    object: { sourceIdentity: "brand", kind: "document", externalKey: "manual" },
    observation: {
      requestedUrl: "https://example.com/manual.pdf",
      observedAt: "2026-08-20T00:00:00.000Z",
      state: "accessible" as const,
      responseHeaders: {},
    },
  };
}

function hash(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
