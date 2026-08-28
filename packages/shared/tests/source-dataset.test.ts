import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  sourceAccessGateStateSchema,
  sourceCaptureWorkItemSchema,
  sourceProviderEventSchema,
  sourceRequestAttemptSchema,
  sourceSnapshotCommitSchema,
} from "../src";

describe("来源执行 target contract", () => {
  it("新快照必须明确归属 target", () => {
    const commit = snapshotCommit();
    expect(sourceSnapshotCommitSchema.parse(commit).targetKey).toBe("official.manual");
    const { targetKey: _targetKey, ...withoutTarget } = commit;
    expect(sourceSnapshotCommitSchema.safeParse(withoutTarget).success).toBe(false);
  });

  it("新快照可保存可校验的站内发现血缘", () => {
    const commit = sourceSnapshotCommitSchema.parse({
      ...snapshotCommit(),
      lineage: {
        workKey: "page:product-1",
        discoveryKind: "html_link",
        depth: 2,
        parentUrl: "https://example.com/catalog/brand",
      },
    });

    expect(commit.lineage).toEqual({
      workKey: "page:product-1",
      discoveryKind: "html_link",
      depth: 2,
      parentUrl: "https://example.com/catalog/brand",
    });
    expect(sourceSnapshotCommitSchema.safeParse({
      ...snapshotCommit(),
      lineage: { workKey: "page:product-1", discoveryKind: "html_link", depth: 2 },
    }).success).toBe(false);
    expect(sourceSnapshotCommitSchema.safeParse({
      ...snapshotCommit(),
      lineage: { workKey: "target:manual", discoveryKind: "planned_entry", depth: 1 },
    }).success).toBe(false);
  });

  it("Provider 产物把原始附件字节绑定到明确 target", () => {
    const content = new TextEncoder().encode("manual-pdf");
    const { runId: _runId, targetKey: _targetKey, ...snapshot } = snapshotCommit();
    const event = sourceProviderEventSchema.parse({
      type: "capture",
      targetKey: "official.manual",
      snapshot: {
        ...snapshot,
        lineage: { workKey: "target:official.manual", discoveryKind: "planned_entry", depth: 0 },
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

  it("详情捕获可保存 25 条图片 URL 引用而不携带图片字节", () => {
    const { runId: _runId, targetKey: _targetKey, ...snapshot } = snapshotCommit();
    const event = sourceProviderEventSchema.parse({
      type: "capture",
      targetKey: "market.product-records",
      snapshot: {
        ...snapshot,
        object: { sourceIdentity: "market-catalog", kind: "product", externalKey: "product-1" },
        payload: {
          kind: "inline_text",
          mediaType: "text/html",
          charset: "utf-8",
          text: "<html>detail</html>",
          bytes: 19,
          contentHash: hash(new TextEncoder().encode("<html>detail</html>")),
        },
      },
      assets: [],
      resourceReferences: Array.from({ length: 25 }, (_, ordinal) => ({
        kind: "image",
        sourceUrl: `https://img.example.com/${ordinal}.webp`,
        role: ordinal === 0 ? "primary" : "detail",
        section: ordinal === 0 ? "gallery" : "description",
        ordinal,
      })),
    });

    if (event.type !== "capture") throw new Error("预期 capture 事件");
    expect(event.resourceReferences).toHaveLength(25);
    expect(event.assets).toEqual([]);
    expect(event.resourceReferences[0]).not.toHaveProperty("content");
    expect(event.resourceReferences[0]).not.toHaveProperty("contentHash");
    expect(event.resourceReferences[0]).not.toHaveProperty("bytes");
  });

  it("拒绝把没有原始内容的 accessible 事件计为完成", () => {
    const { runId: _runId, targetKey: _targetKey, ...snapshot } = snapshotCommit();
    expect(sourceProviderEventSchema.safeParse({
      type: "capture", targetKey: "official.manual", snapshot, assets: [],
    }).success).toBe(false);
  });

  it("捕获工作项、请求尝试与跨进程 gate 使用分离的 typed 状态", () => {
    const at = "2026-08-21T00:00:00.000Z";
    const workItem = sourceCaptureWorkItemSchema.parse({
      id: "work-1",
      runId: "run-1",
      targetKey: "brand.product-detail",
      workKey: "product:model-1",
      parentObjectKey: "catalog:brand",
      captureUnit: "exact_page",
      expectedUnitCount: 1,
      observedUnitCount: 0,
      status: "pending",
      createdAt: at,
    });
    const attempt = sourceRequestAttemptSchema.parse({
      id: "attempt-1",
      runId: "run-1",
      targetKey: "brand.product-detail",
      workKey: "product:model-1",
      gateKey: "public.web-resource@1.0.0",
      requestedUrl: "https://brand.example/products/model-1",
      origin: "https://brand.example",
      startedAt: at,
      state: "started",
    });
    const gate = sourceAccessGateStateSchema.parse({
      key: "public.web-resource@1.0.0",
      providerKey: "public.web-resource",
      providerVersion: "1.0.0",
      policyVersion: "public-v1-default",
      circuitState: "open",
      windowRequestCount: 1,
      blockedAt: at,
      blockedReason: "rate_limited",
      manualResumeRequired: true,
      updatedAt: at,
    });

    expect(workItem.status).toBe("pending");
    expect(attempt.state).toBe("started");
    expect(gate).toMatchObject({ circuitState: "open", manualResumeRequired: true });
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
