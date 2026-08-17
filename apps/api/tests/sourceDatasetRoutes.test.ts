import type { SourceDatasetModule, SourceEvidenceModule } from "@domain-analysis/workbench";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerSourceDatasetRoutes } from "../src/routes/sourceDatasetRoutes";

describe("Source Dataset HTTP contract", () => {
  it("只从统一 module 列出并读取项目的来源运行", async () => {
    const sourceDatasets = fakeSourceDatasets();
    const app = Fastify();
    await registerSourceDatasetRoutes(app, sourceDatasets);

    const list = await app.inject({
      method: "GET",
      url: "/api/product-projects/project-1/source-runs",
    });
    const detail = await app.inject({
      method: "GET",
      url: "/api/product-projects/project-1/source-runs/run-1",
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().items).toEqual([expect.objectContaining({ categoryCode: "television" })]);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().item.run.projectId).toBe("project-1");
    expect(sourceDatasets.listProject).toHaveBeenCalledWith("project-1");
    expect(sourceDatasets.getRun).toHaveBeenCalledWith("run-1");
    await app.close();
  });

  it("拒绝跨项目读取来源运行", async () => {
    const app = Fastify();
    await registerSourceDatasetRoutes(app, fakeSourceDatasets());
    const response = await app.inject({
      method: "GET",
      url: "/api/product-projects/another-project/source-runs/run-1",
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("以附件形式流式导出 JSONL", async () => {
    const sourceDatasets = fakeSourceDatasets();
    const app = Fastify();
    await registerSourceDatasetRoutes(app, sourceDatasets);
    const response = await app.inject({
      method: "GET",
      url: "/api/product-projects/project-1/source-runs/run-1/export?format=jsonl",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(response.headers["content-disposition"]).toBe(
      "attachment; filename=source-run.jsonl",
    );
    expect(response.body).toBe("{\"snapshot\":1}\n");
    expect(sourceDatasets.exportRun).toHaveBeenCalledWith({ runId: "run-1", format: "jsonl" });
    await app.close();
  });

  it("把已选来源片段交给统一 SourceDataset→Evidence adapter", async () => {
    const sourceDatasets = fakeSourceDatasets();
    const sourceEvidence = {
      materialize: vi.fn(async () => ({ id: "evidence-1" })),
    } as unknown as SourceEvidenceModule & { materialize: ReturnType<typeof vi.fn> };
    const app = Fastify();
    await registerSourceDatasetRoutes(app, sourceDatasets, sourceEvidence);
    const response = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-1/source-snapshots/snapshot-1/evidence",
      payload: {
        requestId: "request-1",
        selection: { kind: "ordered_field", groupIndex: 0, fieldIndex: 1 },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ item: { id: "evidence-1" } });
    expect(sourceEvidence.materialize).toHaveBeenCalledWith({
      snapshotId: "snapshot-1",
      requestId: "request-1",
      selection: { kind: "ordered_field", groupIndex: 0, fieldIndex: 1 },
    });
    await app.close();
  });

});

function fakeSourceDatasets() {
  const run = {
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
  } as const;
  return {
    listProject: vi.fn(async () => [run]),
    getRun: vi.fn(async () => ({ run, records: [] })),
    getSnapshot: vi.fn(async (snapshotId: string) => snapshotId === "snapshot-1" ? ({
      object: { projectId: "project-1" },
      snapshot: { id: snapshotId },
      assets: [],
    }) : null),
    exportRun: vi.fn(function (_input: unknown) {
      return (async function* () { yield "{\"snapshot\":1}\n"; })();
    }),
  } as unknown as SourceDatasetModule & {
    listProject: ReturnType<typeof vi.fn>;
    getRun: ReturnType<typeof vi.fn>;
    exportRun: ReturnType<typeof vi.fn>;
  };
}
