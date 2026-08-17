import type {
  SourceCollectionProviderPort,
  SourceCollectionRun,
  SourceCollectionWorkItem,
} from "@domain-analysis/shared";
import { describe, expect, it, vi } from "vitest";

import { createSourceCollectionProviderRouter } from "../src/sourceCollectionProviderRouter";

describe("Source Collection provider router", () => {
  it("只按冻结 run 的 providerKey 分发，不从 URL 或品类猜 Provider", async () => {
    const jd = provider("jd");
    const technical = provider("technical");
    const router = createSourceCollectionProviderRouter({
      "jd-source-collection": jd.port,
      "readable-technical-source": technical.port,
    });

    await router.collect({
      sourceRun: run("readable-technical-source", "television"),
      item: item("https://item.jd.com/1001.html"),
    });
    expect(technical.collect).toHaveBeenCalledTimes(1);
    expect(jd.collect).not.toHaveBeenCalled();
  });

  it("未知 Provider 失败关闭", async () => {
    const router = createSourceCollectionProviderRouter({});
    const result = await router.collect({
      sourceRun: run("missing-provider", "refrigerator"),
      item: item("https://example.com/source"),
    });
    expect(result).toMatchObject({
      observation: { state: "source_abnormal", failureCode: "source_abnormal" },
      stopRun: true,
    });
  });
});

function provider(label: string) {
  const collect = vi.fn(async ({ item }: { item: SourceCollectionWorkItem }) => {
    const timestamp = "2026-08-17T08:00:00.000Z";
    return {
      accessStartedAt: timestamp,
      accessFinishedAt: timestamp,
      observation: {
        requestedUrl: item.requestedUrl,
        observedAt: timestamp,
        state: "not_found" as const,
        failureCode: "not_found" as const,
      },
      relations: [],
      stopRun: false,
    };
  });
  return {
    collect,
    port: { collect, cancel: vi.fn() } as SourceCollectionProviderPort,
    label,
  };
}

function run(providerKey: string, categoryCode: string): SourceCollectionRun {
  return {
    id: `run-${providerKey}`, projectId: `project-${categoryCode}`,
    categoryDefinitionVersionId: `definition-${categoryCode}`,
    confirmedScopeVersionId: `scope-${categoryCode}`,
    collectionBoardVersionId: `board-${categoryCode}`, categoryCode,
    collectionLaneId: `lane-${providerKey}`, providerKey,
    sourceAuthorityType: "government_research",
    accessPolicy: { kind: "manual", version: "fixture-v1" }, status: "running",
    snapshotCount: 0, accessibleCount: 0, failedCount: 0, assetCount: 0,
    startedAt: "2026-08-17T08:00:00.000Z",
  };
}

function item(requestedUrl: string): SourceCollectionWorkItem {
  return {
    id: "item-source", object: { sourceIdentity: "fixture", kind: "document", externalKey: "source" },
    requestedUrl, targetKeys: ["category:fixture"], knowledgeNeedIds: ["need:fixture"],
    parsing: { adapterId: "fixture", adapterVersion: "v1" },
    claimScopes: ["foundational_principle"],
    usagePermission: {
      localRead: "allowed", modelInput: "allowed", evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed", sourceRedistribution: "denied", basis: "fixture",
    },
  };
}
