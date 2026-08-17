import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  sourceSnapshotRecordSchema,
} from "@domain-analysis/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  openProductKnowledgeWorkbench,
  type ProductKnowledgeWorkbench,
} from "../src/productKnowledgeWorkbench";
import {
  createConfirmedProject,
  deterministicProjectOptions,
  deterministicSourceOptions,
  fixtureUsagePermission,
  laneId,
  manualAccessPolicy,
  orderedRecord,
} from "./fixtures/sourceDatasetFixtures";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("SourceDatasetModule integration", () => {
  let workbench: ProductKnowledgeWorkbench | undefined;
  let evidenceRoot: string | undefined;

  afterEach(async () => {
    await workbench?.close();
    workbench = undefined;
    if (evidenceRoot) await rm(evidenceRoot, { recursive: true, force: true });
    evidenceRoot = undefined;
  });

  it("同一 interface 可为冰箱和电视逐条保存来源快照", async () => {
    workbench = await openProductKnowledgeWorkbench({
      databaseUrl: databaseUrl!,
      productProjectModule: deterministicProjectOptions(),
      sourceDatasetModule: deterministicSourceOptions(),
    });
    const refrigerator = await createConfirmedProject(workbench, {
      categoryCode: "household_refrigerator",
      label: "冰箱",
      attributeCode: "storage.volume",
      attributeLabel: "容积",
      unit: "L",
      targetKey: "brand:haier",
      targetLabel: "海尔",
    });
    const television = await createConfirmedProject(workbench, {
      categoryCode: "television",
      label: "电视",
      attributeCode: "display.refresh_rate",
      attributeLabel: "刷新率",
      unit: "Hz",
      targetKey: "brand:tcl",
      targetLabel: "TCL",
    });

    const refrigeratorRun = await workbench.sourceDatasets.startRun({
      projectId: refrigerator.project.id,
      collectionLaneId: laneId("household_refrigerator"),
      providerKey: "fixture-brand-site",
      accessPolicy: manualAccessPolicy(),
    });
    const televisionRun = await workbench.sourceDatasets.startRun({
      projectId: television.project.id,
      collectionLaneId: laneId("television"),
      providerKey: "fixture-brand-site",
      accessPolicy: manualAccessPolicy(),
    });

    await workbench.sourceDatasets.commitSnapshot(orderedRecord({
      runId: refrigeratorRun.id,
      idempotencyKey: "haier-bcd-500@2026-08-17T08:00:00Z",
      externalKey: "BCD-500",
      title: "海尔 BCD-500",
      fieldName: "总容积",
      fieldValue: "500",
      unit: "L",
      url: "https://example.com/refrigerators/bcd-500",
    }));
    await workbench.sourceDatasets.commitSnapshot(orderedRecord({
      runId: televisionRun.id,
      idempotencyKey: "tcl-65t7g@2026-08-17T08:00:00Z",
      externalKey: "65T7G",
      title: "TCL 65T7G",
      fieldName: "刷新率",
      fieldValue: "144",
      unit: "Hz",
      url: "https://example.com/televisions/65t7g",
    }));

    const [refrigeratorView, televisionView] = await Promise.all([
      workbench.sourceDatasets.getRun(refrigeratorRun.id),
      workbench.sourceDatasets.getRun(televisionRun.id),
    ]);
    expect(refrigeratorView).toMatchObject({
      run: { categoryCode: "household_refrigerator" },
      records: [{
        object: { kind: "product", externalKey: "BCD-500" },
        snapshot: { content: { kind: "ordered_record", title: "海尔 BCD-500" } },
      }],
    });
    expect(televisionView).toMatchObject({
      run: { categoryCode: "television" },
      records: [{
        object: { kind: "product", externalKey: "65T7G" },
        snapshot: { content: { kind: "ordered_record", title: "TCL 65T7G" } },
      }],
    });
  });

  it("来源计划持久化并按计划批次幂等创建运行", async () => {
    workbench = await openProductKnowledgeWorkbench({
      databaseUrl: databaseUrl!,
      productProjectModule: deterministicProjectOptions(),
      sourceDatasetModule: deterministicSourceOptions(),
    });
    const project = await createConfirmedProject(workbench, {
      categoryCode: "television",
      label: "电视",
      attributeCode: "display.refresh_rate",
      attributeLabel: "刷新率",
      unit: "Hz",
      targetKey: "brand:tcl",
      targetLabel: "TCL",
    });
    const content = {
      recipeVersion: "source-plan-v1",
      confirmedBriefId: "brief-television-1",
      lanes: [{
        collectionLaneId: laneId("television"),
        sourceAuthorityType: "brand_official_site" as const,
        status: "ready" as const,
        issues: [],
        batches: [{
          key: "batch-tcl-official-v1",
          providerKey: "fixture-brand-site",
          accessPolicy: manualAccessPolicy(),
          workItems: [{
            id: "source-item-tcl-catalog",
            object: {
              sourceIdentity: "fixture-brand-site",
              kind: "catalog_entry" as const,
              externalKey: "tcl-television-catalog",
            },
            requestedUrl: "https://example.com/televisions",
            targetKeys: ["brand:tcl"],
            knowledgeNeedIds: ["need-television-models"],
            parsing: { adapterId: "fixture-brand-adapter", adapterVersion: "1.0.0" },
            claimScopes: ["model_fact" as const],
            usagePermission: fixtureUsagePermission(),
          }],
        }],
      }],
    };

    const firstPlan = await workbench.sourceDatasets.savePlan({
      projectId: project.project.id,
      content,
    });
    const repeatedPlan = await workbench.sourceDatasets.savePlan({
      projectId: project.project.id,
      content,
    });
    expect(repeatedPlan.id).toBe(firstPlan.id);
    expect(await workbench.sourceDatasets.getPlan(firstPlan.id)).toEqual(firstPlan);
    expect(await workbench.sourceDatasets.listPlans(project.project.id)).toEqual([firstPlan]);

    const runInput = {
      projectId: project.project.id,
      sourceCollectionPlanId: firstPlan.id,
      sourceCollectionPlanBatchKey: "batch-tcl-official-v1",
      collectionLaneId: laneId("television"),
      providerKey: "fixture-brand-site",
      accessPolicy: manualAccessPolicy(),
    };
    const firstRun = await workbench.sourceDatasets.startRun(runInput);
    const repeatedRun = await workbench.sourceDatasets.startRun(runInput);
    expect(repeatedRun.id).toBe(firstRun.id);
    expect(firstRun).toMatchObject({
      sourceCollectionPlanId: firstPlan.id,
      sourceCollectionPlanBatchKey: "batch-tcl-official-v1",
    });
  });

  it("失败结束并重启后仍保留已提交记录且不覆盖原始字段", async () => {
    const options = {
      databaseUrl: databaseUrl!,
      productProjectModule: deterministicProjectOptions(),
      sourceDatasetModule: deterministicSourceOptions(),
    };
    workbench = await openProductKnowledgeWorkbench(options);
    const television = await createConfirmedProject(workbench, {
      categoryCode: "television",
      label: "电视",
      attributeCode: "connection.hdmi",
      attributeLabel: "HDMI 接口",
      unit: "count",
      targetKey: "brand:tcl",
      targetLabel: "TCL",
    });
    const run = await workbench.sourceDatasets.startRun({
      projectId: television.project.id,
      collectionLaneId: laneId("television"),
      providerKey: "fixture-brand-site",
      accessPolicy: manualAccessPolicy(),
    });
    const input = orderedRecord({
      runId: run.id,
      idempotencyKey: "tcl-65t7g-detail@2026-08-17T08:00:00Z",
      externalKey: "65T7G",
      title: "TCL 65T7G",
      fieldName: "接口",
      fieldValue: "HDMI 2.1",
      unit: "个",
      url: "https://example.com/televisions/65t7g",
    });
    input.content.fieldGroups[0]!.fields.push({ name: "接口", value: "HDMI 2.0", unit: "个" });
    await workbench.sourceDatasets.commitSnapshot(input);
    await workbench.sourceDatasets.finishRun({
      runId: run.id,
      status: "failed",
      terminationReason: "fixture 模拟中断",
    });
    await workbench.close();

    workbench = await openProductKnowledgeWorkbench({ databaseUrl: databaseUrl! });
    const recovered = await workbench.sourceDatasets.getRun(run.id);
    expect(recovered).toMatchObject({
      run: {
        status: "failed",
        snapshotCount: 1,
        accessibleCount: 1,
        terminationReason: "fixture 模拟中断",
      },
    });
    const recoveredContent = recovered?.records[0]?.snapshot.content;
    expect(recoveredContent?.kind).toBe("ordered_record");
    if (!recoveredContent || recoveredContent.kind !== "ordered_record") {
      throw new Error("测试夹具应恢复 ordered_record");
    }
    expect(recoveredContent.fieldGroups[0]?.fields).toEqual([
      { name: "接口", value: "HDMI 2.1", unit: "个" },
      { name: "接口", value: "HDMI 2.0", unit: "个" },
    ]);
    const listed = await workbench.sourceDatasets.listProject(television.project.id);
    expect(listed).toEqual([recovered?.run]);
    const jsonl = await collectExport(workbench.sourceDatasets.exportRun({
      runId: run.id,
      format: "jsonl",
    }));
    const exportedRecords = jsonl.trim().split("\n")
      .map((line) => sourceSnapshotRecordSchema.parse(JSON.parse(line)));
    expect(exportedRecords).toHaveLength(1);
    expect(exportedRecords[0]?.snapshot.id).toBe(recovered?.records[0]?.snapshot.id);
    await expect(workbench.sourceDatasets.commitSnapshot(input)).rejects.toMatchObject({
      code: "run_closed",
    });
  });

  it("失败观察可幂等恢复，同一对象的新观察只追加不覆盖", async () => {
    workbench = await openProductKnowledgeWorkbench({
      databaseUrl: databaseUrl!,
      productProjectModule: deterministicProjectOptions(),
      sourceDatasetModule: deterministicSourceOptions(),
    });
    const television = await createConfirmedProject(workbench, {
      categoryCode: "television",
      label: "电视",
      attributeCode: "display.refresh_rate",
      attributeLabel: "刷新率",
      unit: "Hz",
      targetKey: "brand:tcl",
      targetLabel: "TCL",
    });
    const run = await workbench.sourceDatasets.startRun({
      projectId: television.project.id,
      collectionLaneId: laneId("television"),
      providerKey: "fixture-brand-site",
      accessPolicy: manualAccessPolicy(),
    });
    const unavailable = {
      runId: run.id,
      idempotencyKey: "tcl-65t7g@attempt-1",
      object: {
        sourceIdentity: "fixture-brand-site",
        kind: "product" as const,
        externalKey: "65T7G",
      },
      targetKeys: ["brand:tcl"],
      knowledgeNeedIds: ["need:model-fact"],
      observation: {
        requestedUrl: "https://example.com/televisions/65t7g",
        observedAt: "2026-08-17T08:00:00.000Z",
        state: "rate_limited" as const,
        failureCode: "rate_limited" as const,
        httpValidation: { status: 429 },
      },
      parsing: { adapterId: "fixture-brand-adapter", adapterVersion: "1.0.0" },
      claimScopes: ["model_fact" as const],
      usagePermission: fixtureUsagePermission(),
      relations: [],
    };
    const failed = await workbench.sourceDatasets.commitSnapshot(unavailable);
    const retried = await workbench.sourceDatasets.commitSnapshot(unavailable);
    expect(retried.snapshot.id).toBe(failed.snapshot.id);
    await expect(workbench.sourceDatasets.commitSnapshot({
      ...unavailable,
      parsing: { ...unavailable.parsing, adapterVersion: "2.0.0" },
    })).rejects.toMatchObject({ code: "idempotency_conflict" });

    await workbench.sourceDatasets.commitSnapshot(orderedRecord({
      runId: run.id,
      idempotencyKey: "tcl-65t7g@attempt-2",
      externalKey: "65T7G",
      title: "TCL 65T7G",
      fieldName: "刷新率",
      fieldValue: "144",
      unit: "Hz",
      url: "https://example.com/televisions/65t7g",
    }));
    const view = await workbench.sourceDatasets.getRun(run.id);
    expect(view?.run).toMatchObject({
      snapshotCount: 2,
      accessibleCount: 1,
      failedCount: 1,
    });
    expect(view?.records).toHaveLength(2);
    expect(view?.records[0]?.object.id).toBe(view?.records[1]?.object.id);
    expect(view?.records.map((record) => record.snapshot.observation.state))
      .toEqual(["rate_limited", "accessible"]);
  });

  it("相同附件字节复用 CAS，但不同来源关系保持独立", async () => {
    evidenceRoot = await mkdtemp(path.join(tmpdir(), "source-dataset-assets-"));
    workbench = await openProductKnowledgeWorkbench({
      databaseUrl: databaseUrl!,
      evidenceRoot,
      productProjectModule: deterministicProjectOptions(),
      sourceDatasetModule: deterministicSourceOptions(),
    });
    const television = await createConfirmedProject(workbench, {
      categoryCode: "television",
      label: "电视",
      attributeCode: "display.panel",
      attributeLabel: "面板",
      unit: "kind",
      targetKey: "brand:tcl",
      targetLabel: "TCL",
    });
    const run = await workbench.sourceDatasets.startRun({
      projectId: television.project.id,
      collectionLaneId: laneId("television"),
      providerKey: "fixture-brand-site",
      accessPolicy: manualAccessPolicy(),
    });
    const firstInput = orderedRecord({
      runId: run.id,
      idempotencyKey: "panel-diagram@page-1",
      externalKey: "panel-document-1",
      title: "面板资料 1",
      fieldName: "版本",
      fieldValue: "1",
      unit: "版",
      url: "https://example.com/documents/panel-1",
    });
    firstInput.content.blocks.push({
      kind: "asset_ref",
      assetKey: "diagram-1",
      role: "technical_diagram",
      sourceUrl: "https://example.com/assets/panel-diagram.png",
    });
    const secondInput = orderedRecord({
      runId: run.id,
      idempotencyKey: "panel-diagram@page-2",
      externalKey: "panel-document-2",
      title: "面板资料 2",
      fieldName: "版本",
      fieldValue: "1",
      unit: "版",
      url: "https://example.com/documents/panel-2",
    });
    secondInput.content.blocks.push({
      kind: "asset_ref",
      assetKey: "diagram-2",
      role: "technical_diagram",
      sourceUrl: "https://example.com/assets/panel-diagram-copy.png",
    });
    const [firstSnapshot, secondSnapshot] = await Promise.all([
      workbench.sourceDatasets.commitSnapshot(firstInput),
      workbench.sourceDatasets.commitSnapshot(secondInput),
    ]);
    const bytes = new TextEncoder().encode("fixture-image-bytes");
    const firstAsset = await workbench.sourceDatasets.commitAsset({
      snapshotId: firstSnapshot.snapshot.id,
      assetKey: "diagram-1",
      sourceUrl: "https://example.com/assets/panel-diagram.png",
      mediaType: "image/png",
      purpose: "technical_diagram",
      blockIndex: 0,
      position: 1,
      privacyClass: "public",
    }, bytes);
    const secondAsset = await workbench.sourceDatasets.commitAsset({
      snapshotId: secondSnapshot.snapshot.id,
      assetKey: "diagram-2",
      sourceUrl: "https://example.com/assets/panel-diagram-copy.png",
      mediaType: "image/png",
      purpose: "technical_diagram",
      blockIndex: 0,
      position: 1,
      privacyClass: "public",
    }, bytes);

    expect(firstAsset.id).not.toBe(secondAsset.id);
    expect(firstAsset.casIntegrity).toBe(secondAsset.casIntegrity);
    expect(firstAsset.snapshotId).not.toBe(secondAsset.snapshotId);
    expect((await workbench.sourceDatasets.getRun(run.id))?.run.assetCount).toBe(2);
  });

});

async function collectExport(chunks: AsyncIterable<string>) {
  let output = "";
  for await (const chunk of chunks) output += chunk;
  return output;
}
