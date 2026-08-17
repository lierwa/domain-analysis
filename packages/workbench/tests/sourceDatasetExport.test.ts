import { sourceCollectionRunViewSchema } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import { SourceDatasetExportError, serializeSourceCollectionRun } from "../src/sourceDatasetExport";

describe("Source Dataset export", () => {
  it("CSV 保留复杂文本并转义表格公式前缀", async () => {
    const csv = await collect(serializeSourceCollectionRun(view({
      kind: "ordered_record",
      title: "TCL 65T7G",
      fieldGroups: [{
        label: "规格",
        fields: [{ name: "危险,字段", value: "=1+1\n\"quoted\"", unit: "text" }],
      }],
      blocks: [],
    }), "csv"));

    expect(csv).toContain("\"危险,字段\"");
    expect(csv).toContain("\"'=1+1\n\"\"quoted\"\"\"");
    expect(csv).not.toContain("\n=1+1");
  });

  it("文档没有无损表格投影时明确要求 JSONL", async () => {
    const chunks = serializeSourceCollectionRun(view({
      kind: "document",
      title: "技术资料",
      publisher: "技术机构",
      publicationStatus: "current",
      sections: [{ blocks: [{ kind: "text", role: "description", text: "原理正文" }] }],
    }), "csv");
    await expect(collect(chunks)).rejects.toBeInstanceOf(SourceDatasetExportError);
  });
});

function view(content: object) {
  return sourceCollectionRunViewSchema.parse({
    run: {
      id: "run-1",
      projectId: "project-1",
      categoryDefinitionVersionId: "definition-1",
      confirmedScopeVersionId: "scope-1",
      collectionBoardVersionId: "board-1",
      categoryCode: "television",
      collectionLaneId: "lane-1",
      providerKey: "fixture-provider",
      sourceAuthorityType: "brand_official_site",
      accessPolicy: { kind: "manual", version: "v1" },
      status: "completed",
      snapshotCount: 1,
      accessibleCount: 1,
      failedCount: 0,
      assetCount: 0,
      startedAt: "2026-08-17T08:00:00.000Z",
      finishedAt: "2026-08-17T08:01:00.000Z",
    },
    records: [{
      object: {
        id: "object-1",
        projectId: "project-1",
        sourceIdentity: "fixture-provider",
        kind: "product",
        externalKey: "65T7G",
        createdAt: "2026-08-17T08:00:00.000Z",
      },
      snapshot: {
        id: "snapshot-1",
        runId: "run-1",
        objectId: "object-1",
        idempotencyKey: "snapshot-1",
        observation: {
          requestedUrl: "https://example.com/televisions/65t7g",
          finalUrl: "https://example.com/televisions/65t7g",
          observedAt: "2026-08-17T08:00:00.000Z",
          state: "accessible",
        },
        content,
        parsing: { adapterId: "fixture", adapterVersion: "1" },
        claimScopes: ["model_fact"],
        usagePermission: {
          localRead: "allowed",
          modelInput: "allowed",
          evidenceStorage: "allowed",
          derivedKnowledgePublication: "allowed",
          sourceRedistribution: "allowed",
          basis: "测试夹具",
        },
        relations: [],
        contentHash: "a".repeat(64),
        createdAt: "2026-08-17T08:00:00.000Z",
      },
      assets: [],
    }],
  });
}

async function collect(chunks: AsyncIterable<string>) {
  let output = "";
  for await (const chunk of chunks) output += chunk;
  return output;
}
