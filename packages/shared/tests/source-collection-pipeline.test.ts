import {
  sourceCollectionPipelineRunSchema,
  startSourceCollectionPipelineSchema,
} from "../src/source-collection-pipeline";
import { describe, expect, it } from "vitest";

describe("source collection pipeline contract", () => {
  it("freezes category-neutral work items and rejects duplicate identities", () => {
    const input = startSourceCollectionPipelineSchema.parse({
      sourceRunId: "source-run-1",
      workItems: [workItem("model-a"), workItem("model-b")],
    });
    expect(input.workItems.map((item) => item.object.externalKey))
      .toEqual(["model-a", "model-b"]);
    expect(() => startSourceCollectionPipelineSchema.parse({
      sourceRunId: "source-run-1",
      workItems: [workItem("model-a"), workItem("model-a")],
    })).toThrow(/工作项 id 不能重复/);
  });

  it("keeps execution progress separate from source facts", () => {
    const run = sourceCollectionPipelineRunSchema.parse({
      id: "source-collection:source-run-1",
      sourceRunId: "source-run-1",
      inputHash: "a".repeat(64),
      lifecycleStatus: "running",
      totalItems: 2,
      completedItems: 1,
      currentItemId: "model-b",
      recentRequestStartedAt: ["2026-08-17T08:00:00.000Z"],
      lastRequestFinishedAt: "2026-08-17T08:00:01.000Z",
      createdAt: "2026-08-17T08:00:00.000Z",
      updatedAt: "2026-08-17T08:00:01.000Z",
    });
    expect(run).not.toHaveProperty("snapshots");
    expect(run.completedItems).toBe(1);
  });
});

function workItem(externalKey: string) {
  return {
    id: `item-${externalKey}`,
    object: {
      sourceIdentity: "fixture-brand-site",
      kind: "product" as const,
      externalKey,
    },
    requestedUrl: `https://example.com/products/${externalKey}`,
    targetKeys: [`model:${externalKey}`],
    knowledgeNeedIds: ["need:model-fact"],
    parsing: { adapterId: "fixture", adapterVersion: "v1" },
    claimScopes: ["model_fact" as const],
    usagePermission: {
      localRead: "allowed" as const,
      modelInput: "allowed" as const,
      evidenceStorage: "allowed" as const,
      derivedKnowledgePublication: "allowed" as const,
      sourceRedistribution: "unknown" as const,
      basis: "fixture policy",
    },
  };
}
