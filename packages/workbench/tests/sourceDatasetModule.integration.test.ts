import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  captureTasks,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  sourceCollectionPlans,
  sourceCollectionBatches,
  sourceAssets,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceObjects,
  sourceSnapshots,
  type WorkbenchDb,
} from "@domain-analysis/db";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSourceDatasetModule, createSourceExecutionModule,
  type CrawlPlanExecutionReader, type SourceProvider } from "../src";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("Source Dataset 资源引用", () => {
  let db: WorkbenchDb | undefined;
  let taskId: string | undefined;
  let child: ChildProcess | undefined;

  afterEach(async () => {
    if (child?.exitCode === null) child.kill("SIGKILL");
    if (db && taskId) await clearTask(db, taskId);
    await db?.$client.end();
    db = undefined;
    taskId = undefined;
    child = undefined;
  });

  it("公共产品页 Snapshot 原子保存 25 条图片 URL 且不生成 Asset", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-resource-reference-${randomUUID()}`;
    const at = "2026-08-21T00:00:00.000Z";
    await db.insert(captureTasks).values({ id: taskId, name: "图片 URL 测试",
      originalRequest: "抓取品牌官网产品图片 URL", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-1", taskId, taskRevision: 1,
      version: 1, status: "confirmed", contentHash: "0".repeat(64), confirmedAt: at,
      content: { taskId, taskRevision: 1, sources: [{ key: "brand", providerKey: "public.web-resource",
        entryUrl: "https://brand.example/products/model-1", expectedContents: ["产品图片 URL"],
        accessPolicy: { kind: "manual", version: "fixture" } }] } });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("URL-only 捕获不应写入 Asset Store"); },
      open() { return Readable.from([]); },
    } });
    const run = await datasets.startRun({ taskId, planId: "plan-1", planVersion: 1,
      sourceKey: "brand", providerKey: "public.web-resource", providerVersion: "1.0.0",
      requestBudget: 1,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 1, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 1, maximumRunMs: 1_000 }, targetKeys: ["product-detail"] });
    await datasets.startTarget({ runId: run.id, targetKey: "product-detail" });
    const html = "<html>product</html>";
    await datasets.commitSnapshot({ runId: run.id, targetKey: "product-detail",
      idempotencyKey: "model-1", object: { sourceIdentity: "brand.example", kind: "product", externalKey: "model-1" },
      observation: { requestedUrl: "https://brand.example/products/model-1", observedAt: at,
        state: "accessible", responseHeaders: {} }, payload: { kind: "inline_text", mediaType: "text/html",
        charset: "utf-8", text: html, bytes: Buffer.byteLength(html), contentHash: hash(html) },
      assets: [], resourceReferences: references(25) });

    const view = (await datasets.getRun(run.id))!;
    const record = view.records[0]!;
    expect(record.assets).toEqual([]);
    expect(record.resourceReferences).toHaveLength(25);
    expect(record.resourceReferences[24]).toMatchObject({
      sourceUrl: "https://img.example.com/24.webp", role: "detail", section: "description", ordinal: 24,
      observedValue: "//img.example.com/24.webp", locator: "#description img:nth-of-type(25)@data-src",
    });
    let jsonl = "";
    for await (const chunk of datasets.exportRun({ runId: run.id, format: "jsonl" })) jsonl += chunk;
    expect(jsonl).toContain("https://img.example.com/24.webp");
  });

  it("任务地图只返回记录组汇总，展开后才分页读取 Snapshot 摘要", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-source-lineage-${randomUUID()}`;
    const at = "2026-08-26T00:00:00.000Z";
    await db.insert(captureTasks).values({ id: taskId, name: "电视原始数据地图",
      originalRequest: "抓取电视公开目录", marketScope: "中国大陆", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-source-lineage", taskId, taskRevision: 1,
      version: 4, status: "confirmed", contentHash: "f".repeat(64), confirmedAt: at,
      content: currentPlanContent(taskId, at) });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const run = await datasets.startRun({ taskId, planId: "plan-source-lineage", planVersion: 4,
      sourceKey: "zol.catalog", providerKey: "public.web-resource", providerVersion: "2.0.0",
      requestBudget: 10, accessPolicy: { kind: "paced_http", version: "fixture",
        maxRequestsPerMinute: 2, minimumIntervalMs: 1, jitterMs: { min: 0, max: 0 }, batchSize: 2,
        batchCooldownMs: 1, maximumRunMs: 10_000 }, targetKeys: ["market.catalog"] });
    await datasets.startTarget({ runId: run.id, targetKey: "market.catalog" });
    await datasets.ensureCaptureWorkItem({ runId: run.id, targetKey: "market.catalog",
      workKey: "page:sony", captureUnit: "公开目录页", expectedUnitCount: 1 });
    await datasets.startCaptureWorkItem({ runId: run.id, workKey: "page:sony" });
    const html = "<html>索尼电视产品目录</html>";
    await datasets.commitSnapshot({ runId: run.id, targetKey: "market.catalog",
      idempotencyKey: "sony-page", object: { sourceIdentity: "zol.catalog", kind: "web_resource",
        externalKey: "https://detail.zol.com.cn/digital_tv/sony/" },
      lineage: { workKey: "page:sony", discoveryKind: "html_link", depth: 1,
        parentUrl: "https://detail.zol.com.cn/digital_tv/" },
      observation: { requestedUrl: "https://detail.zol.com.cn/digital_tv/sony/", observedAt: at,
        state: "accessible", responseHeaders: {}, contentAssessment: { status: "accepted",
          ruleVersion: "public-content-v1", matchedSignals: ["电视"], reason: "命中电视产品目录" } },
      payload: { kind: "inline_text", mediaType: "text/html", charset: "gbk", text: html,
        bytes: Buffer.byteLength(html), contentHash: hash(html) } });

    const view = (await datasets.getRun(run.id))!;
    expect(view.records[0]?.snapshot.lineage).toEqual({ workKey: "page:sony",
      discoveryKind: "html_link", depth: 1, parentUrl: "https://detail.zol.com.cn/digital_tv/" });
    await expect(datasets.listTask(taskId)).resolves.toMatchObject({
      sources: [{ planId: "plan-source-lineage", planVersion: 4, sourceKey: "zol.catalog",
        name: "ZOL 电视产品库", targets: [{ targetKey: "market.catalog", name: "电视门类与产品页",
          recordGroups: [{ groupKey: "html_link:1", totalCount: 1,
            outcomes: { accepted: 1, supporting: 0, rejected: 0, failed: 0 },
            formats: [{ format: "html", count: 1 }] }] }] }],
    });
    await expect(datasets.listTaskRecords({ taskId, sourceKey: "zol.catalog",
      targetKey: "market.catalog", groupKey: "html_link:1", limit: 30 })).resolves.toMatchObject({
      totalCount: 1,
      items: [{ snapshotId: expect.any(String), runId: run.id, targetKey: "market.catalog",
        lineage: { workKey: "page:sony", discoveryKind: "html_link", depth: 1,
          parentUrl: "https://detail.zol.com.cn/digital_tv/" }, payload: {
            kind: "inline_text", mediaType: "text/html", bytes: Buffer.byteLength(html),
          }, resourceFormat: "html" }],
    });
  });

  it("保存内容不合格的原文，但不把它计入 target 内容通过数", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-content-assessment-${randomUUID()}`;
    const at = "2026-08-26T00:00:00.000Z";
    await db.insert(captureTasks).values({ id: taskId, name: "内容验收计数",
      originalRequest: "抓官网目录", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-content-assessment", taskId,
      taskRevision: 1, version: 4, status: "confirmed", contentHash: "a".repeat(64), confirmedAt: at,
      content: { taskId, taskRevision: 1, sources: [{ key: "brand", providerKey: "public.web-resource",
        entryUrl: "https://brand.example/about", expectedContents: ["产品目录"],
        accessPolicy: { kind: "manual", version: "fixture" } }] } });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const run = await datasets.startRun({ taskId, planId: "plan-content-assessment", planVersion: 4,
      sourceKey: "brand", providerKey: "public.web-resource", providerVersion: "2.0.0", requestBudget: 10,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 1, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 1, maximumRunMs: 1_000 }, targetKeys: ["catalog"] });
    await datasets.startTarget({ runId: run.id, targetKey: "catalog" });
    const html = "<html>公司介绍</html>";
    await datasets.commitSnapshot({ runId: run.id, targetKey: "catalog",
      idempotencyKey: "about", object: { sourceIdentity: "brand.example", kind: "web_resource",
        externalKey: "https://brand.example/about" },
      observation: { requestedUrl: "https://brand.example/about", observedAt: at,
        state: "accessible", responseHeaders: {}, contentAssessment: { status: "rejected",
          ruleVersion: "public-content-v1", matchedSignals: ["品牌"], reason: "没有产品目录或型号" } },
      payload: { kind: "inline_text", mediaType: "text/html", charset: "utf-8", text: html,
        bytes: Buffer.byteLength(html), contentHash: hash(html) }, assets: [], resourceReferences: [] });
    const sitemap = "<urlset></urlset>";
    const updatedRun = await datasets.commitSnapshot({ runId: run.id, targetKey: "catalog",
      idempotencyKey: "sitemap", object: { sourceIdentity: "brand.example", kind: "web_resource",
        externalKey: "https://brand.example/sitemap.xml" },
      observation: { requestedUrl: "https://brand.example/sitemap.xml", observedAt: at,
        state: "accessible", responseHeaders: {}, contentAssessment: { status: "supporting",
          ruleVersion: "public-content-v1", matchedSignals: ["sitemap_raw"], reason: "只支撑 URL 分母" } },
      payload: { kind: "inline_text", mediaType: "application/xml", charset: "utf-8", text: sitemap,
        bytes: Buffer.byteLength(sitemap), contentHash: hash(sitemap) }, assets: [], resourceReferences: [] });

    const view = (await datasets.getRun(run.id))!;
    expect(updatedRun).toMatchObject({ snapshotCount: 2, accessibleCount: 0, failedCount: 1 });
    expect(view.targets[0]).toMatchObject({ snapshotCount: 2, accessibleCount: 0, failedCount: 1 });
    expect(view.records.map((record) => record.snapshot.observation.contentAssessment?.status))
      .toEqual(["rejected", "supporting"]);
  });

  it("仍有未结束捕获工作时不得把 target 记为 completed", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-target-work-gate-${randomUUID()}`;
    const at = "2026-08-21T00:00:00.000Z";
    await db.insert(captureTasks).values({ id: taskId, name: "target 完成门测试",
      originalRequest: "本地 fixture", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-target-work-gate", taskId, taskRevision: 1,
      version: 1, status: "confirmed", contentHash: "2".repeat(64), confirmedAt: at,
      content: { taskId, taskRevision: 1, sources: [{ key: "brand", providerKey: "public.web-resource",
        entryUrl: "https://brand.example/products/model-1", expectedContents: ["产品详情"],
        accessPolicy: { kind: "manual", version: "fixture" } }] } });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const run = await datasets.startRun({ taskId, planId: "plan-target-work-gate", planVersion: 1,
      sourceKey: "brand", providerKey: "public.web-resource", providerVersion: "1.0.0", requestBudget: 1,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 60_000, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 120_000 }, targetKeys: ["product-detail"] });
    await datasets.startTarget({ runId: run.id, targetKey: "product-detail" });
    await datasets.ensureCaptureWorkItem({ runId: run.id, targetKey: "product-detail",
      workKey: "product:model-1", captureUnit: "exact_page", expectedUnitCount: 1 });
    await datasets.startCaptureWorkItem({ runId: run.id, workKey: "product:model-1" });

    await expect(datasets.finishTarget({ runId: run.id, targetKey: "product-detail",
      status: "completed", observedUnitCount: 1, terminationReason: "target_scope_completed" }))
      .rejects.toThrow("仍有未完成捕获工作");

    child = spawn(process.execPath, ["--import=tsx", runLeaseChildScript(), databaseUrl!, run.id], {
      cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForLine(child, `LEASED:${run.id}`);
    await expect(datasets.prepareRunForResume(run.id)).rejects.toThrow("仍由活动执行进程持有");
    child.kill("SIGKILL");
    await waitForExit(child);
    await expect(datasets.prepareRunForResume(run.id)).resolves.toMatchObject({
      id: run.id, status: "stopped", terminationReason: "execution_process_lost",
    });
    await expect(datasets.getRun(run.id)).resolves.toMatchObject({
      targets: [expect.objectContaining({ status: "stopped" })],
      workItems: [expect.objectContaining({ status: "stopped" })],
    });
    const resumed = await datasets.startRun({ taskId, planId: "plan-target-work-gate", planVersion: 1,
      sourceKey: "brand", providerKey: "public.web-resource", providerVersion: "1.0.0", requestBudget: 1,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 60_000, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 120_000 }, targetKeys: ["product-detail"],
      resumedFromRunId: run.id });
    expect(resumed).toMatchObject({ resumedFromRunId: run.id, status: "running" });
    await datasets.startTarget({ runId: resumed.id, targetKey: "product-detail" });
    await datasets.ensureCaptureWorkItem({ runId: resumed.id, targetKey: "product-detail",
      workKey: "product:model-2", captureUnit: "exact_page", expectedUnitCount: 1 });
    await datasets.startCaptureWorkItem({ runId: resumed.id, workKey: "product:model-2" });
    await datasets.finishTarget({ runId: resumed.id, targetKey: "product-detail", status: "failed",
      terminationReason: "fixture_failure" });
    await expect(datasets.getRun(resumed.id)).resolves.toMatchObject({
      targets: [expect.objectContaining({ status: "failed" })],
      workItems: [expect.objectContaining({ status: "failed", terminationReason: "fixture_failure" })],
    });
  }, 15_000);

  it("启动恢复把无活动执行进程的 running 批次和运行收口为 stopped", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-interrupted-batch-${randomUUID()}`;
    const at = "2026-08-21T00:00:00.000Z";
    await db.insert(captureTasks).values({ id: taskId, name: "失联批次恢复测试",
      originalRequest: "本地 fixture", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-interrupted-batch", taskId,
      taskRevision: 1, version: 3, status: "confirmed", contentHash: "3".repeat(64), confirmedAt: at,
      content: { taskId, taskRevision: 1, sources: [{ key: "brand",
        providerKey: "public.web-resource", entryUrl: "https://brand.example/products/model-1",
        expectedContents: ["产品详情"], accessPolicy: { kind: "manual", version: "fixture" } }] } });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const batch = await datasets.startBatch({ taskId, planId: "plan-interrupted-batch",
      planVersion: 3, taskRevision: 1, plannedSourceCount: 1 });
    const run = await datasets.startRun({ taskId, planId: "plan-interrupted-batch", planVersion: 3,
      batchId: batch.id, sourceKey: "brand", providerKey: "public.web-resource",
      providerVersion: "1.0.0", requestBudget: 1,
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 60_000, jitterMs: { min: 0, max: 0 }, batchSize: 1,
        batchCooldownMs: 60_000, maximumRunMs: 120_000 }, targetKeys: ["product-detail"] });
    await datasets.startTarget({ runId: run.id, targetKey: "product-detail" });
    await datasets.ensureCaptureWorkItem({ runId: run.id, targetKey: "product-detail",
      workKey: "product:model-1", captureUnit: "exact_page", expectedUnitCount: 1 });
    await datasets.startCaptureWorkItem({ runId: run.id, workKey: "product:model-1" });

    const lease = await datasets.acquireBatchLease(batch.id);
    await expect(datasets.recoverInterruptedBatches({ taskId })).resolves.toEqual([]);
    await expect(datasets.listTask(taskId)).resolves.toMatchObject({
      batches: [expect.objectContaining({ id: batch.id, status: "running" })],
      runs: [expect.objectContaining({ id: run.id, status: "running" })],
    });
    await lease.release();
    await expect(datasets.recoverInterruptedBatches({ taskId })).resolves.toEqual([batch.id]);
    await expect(datasets.listTask(taskId)).resolves.toMatchObject({
      batches: [expect.objectContaining({ id: batch.id, status: "stopped",
        terminationReason: "execution_process_lost" })],
      runs: [expect.objectContaining({ id: run.id, status: "stopped",
        terminationReason: "execution_process_lost" })],
    });
    await expect(datasets.getRun(run.id)).resolves.toMatchObject({
      targets: [expect.objectContaining({ status: "stopped" })],
      workItems: [expect.objectContaining({ status: "stopped" })],
    });

    const resumed = await datasets.startRun({ taskId, planId: "plan-interrupted-batch", planVersion: 3,
      batchId: batch.id, sourceKey: "brand", providerKey: "public.web-resource",
      providerVersion: "1.0.0", requestBudget: 1, accessPolicy: fixtureAccessPolicy(),
      targetKeys: ["product-detail"], resumedFromRunId: run.id });
    await datasets.startTarget({ runId: resumed.id, targetKey: "product-detail" });
    await expect(datasets.recoverInterruptedBatches({ taskId })).resolves.toEqual([batch.id]);
    await expect(datasets.getRun(resumed.id)).resolves.toMatchObject({
      run: expect.objectContaining({ status: "stopped", failureCategory: "execution_process_lost" }),
      targets: [expect.objectContaining({ status: "stopped" })],
    });
  });

  it("批次最新投影以每个来源的恢复链末端汇总且保留历史运行", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-latest-source-projection-${randomUUID()}`;
    const at = "2026-08-28T00:00:00.000Z";
    await db.insert(captureTasks).values({ id: taskId, name: "最新来源结果投影",
      originalRequest: "抓取公开产品目录", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-latest-projection", taskId,
      taskRevision: 1, version: 1, status: "confirmed", contentHash: "4".repeat(64), confirmedAt: at,
      content: { taskId, taskRevision: 1, sources: [{ key: "brand",
        providerKey: "public.web-resource", entryUrl: "https://brand.example/products",
        expectedContents: ["产品目录"], accessPolicy: { kind: "manual", version: "fixture" } }] } });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const batch = await datasets.startBatch({ taskId, planId: "plan-latest-projection",
      planVersion: 1, taskRevision: 1, plannedSourceCount: 1 });
    const first = await datasets.startRun({ taskId, planId: "plan-latest-projection", planVersion: 1,
      batchId: batch.id, sourceKey: "brand", providerKey: "public.web-resource",
      providerVersion: "2.0.0", requestBudget: 2, accessPolicy: fixtureAccessPolicy(),
      targetKeys: ["catalog"] });
    await datasets.startTarget({ runId: first.id, targetKey: "catalog" });
    await datasets.ensureCaptureWorkItem({ runId: first.id, targetKey: "catalog",
      workKey: "model:haier:1001", captureUnit: "zol_model_bundle", expectedUnitCount: 1 });
    await datasets.startCaptureWorkItem({ runId: first.id, workKey: "model:haier:1001" });
    await datasets.finishCaptureWorkItem({ runId: first.id, workKey: "model:haier:1001",
      status: "completed", observedUnitCount: 1 });
    await datasets.finishTarget({ runId: first.id, targetKey: "catalog", status: "failed",
      terminationReason: "temporary TLS failure" });
    await datasets.finishRun({ runId: first.id, status: "failed",
      terminationReason: "temporary TLS failure" });
    await datasets.prepareRunForResume(first.id);
    const latest = await datasets.startRun({ taskId, planId: "plan-latest-projection", planVersion: 1,
      batchId: batch.id, sourceKey: "brand", providerKey: "public.web-resource",
      providerVersion: "2.0.0", requestBudget: 2, accessPolicy: fixtureAccessPolicy(),
      targetKeys: ["catalog"], resumedFromRunId: first.id });
    await datasets.startTarget({ runId: latest.id, targetKey: "catalog" });
    await expect(datasets.listCompletedCaptureWorkKeys({ runId: latest.id,
      captureUnit: "zol_model_bundle" })).resolves.toEqual(["model:haier:1001"]);
    await datasets.finishTarget({ runId: latest.id, targetKey: "catalog", status: "completed",
      observedUnitCount: 0, terminationReason: "target_scope_completed" });
    await datasets.finishRun({ runId: latest.id, status: "completed",
      terminationReason: "plan_scope_completed" });
    await expect(datasets.getRun(latest.id)).resolves.toMatchObject({
      targets: [expect.objectContaining({ observedUnitCount: 0 })],
    });
    await datasets.finishBatch({ batchId: batch.id, status: "partial",
      terminationReason: "历史批次摘要尚未包含恢复运行" });

    await expect(datasets.listTask(taskId)).resolves.toMatchObject({
      runs: expect.arrayContaining([
        expect.objectContaining({ id: first.id, status: "failed" }),
        expect.objectContaining({ id: latest.id, status: "completed", resumedFromRunId: first.id }),
      ]),
      executions: [{ batchId: batch.id, status: "completed", plannedSourceCount: 1,
        latestRuns: [expect.objectContaining({ id: latest.id, sourceCollectionPlanSourceKey: "brand" })],
        counts: { running: 0, completed: 1, failed: 0, stopped: 0, missing: 0 } }],
    });
  });

  it("恢复 pending 批次时只执行尚无 Run 的计划来源并完成恢复生命周期", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-automatic-source-recovery-${randomUUID()}`;
    const at = "2026-08-28T01:00:00.000Z";
    const providerVersion = `test-${randomUUID()}`;
    const content = currentPlanContent(taskId, at, providerVersion);
    await db.insert(captureTasks).values({ id: taskId, name: "自动来源恢复",
      originalRequest: "抓取公开产品目录", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-automatic-recovery", taskId,
      taskRevision: 1, version: 4, status: "confirmed", contentHash: "5".repeat(64), confirmedAt: at,
      content });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const batch = await datasets.startBatch({ taskId, planId: "plan-automatic-recovery",
      planVersion: 4, taskRevision: 1, plannedSourceCount: 1 });
    await datasets.finishBatch({ batchId: batch.id, status: "stopped",
      terminationReason: "execution_process_lost" });
    await datasets.setBatchRecoveryState(batch.id, "pending");
    const plan = { id: "plan-automatic-recovery", taskId, taskRevision: 1, version: 4,
      status: "confirmed", content } as never;
    const planning = { requireExecutablePlan: async () => plan } satisfies CrawlPlanExecutionReader;
    const collectCalls: string[] = [];
    const provider = { key: "public.web-resource", version: providerVersion, validate() {},
      async preflightEnvironment() {}, async preflight() {}, async *collect(source) {
        collectCalls.push(source.key);
        yield { type: "target.completed" as const, targetKey: source.targets[0]!.key };
      } } satisfies SourceProvider;
    const execution = createSourceExecutionModule(planning, datasets,
      new Map([[provider.key, provider]]));

    await execution.recoverBatch({ batchId: batch.id });

    expect(collectCalls).toEqual(["zol.catalog"]);
    await expect(datasets.getBatch(batch.id)).resolves.toMatchObject({ recoveryState: "completed" });
    await expect(datasets.listTask(taskId)).resolves.toMatchObject({
      executions: [expect.objectContaining({ status: "completed", counts: {
        running: 0, completed: 1, failed: 0, stopped: 0, missing: 0,
      } })],
    });
  });

  it("completed Attempt 尚无 Snapshot 时在原批次预算内创建一次恢复 Run", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-safe-attempt-recovery-${randomUUID()}`;
    const at = "2026-08-28T02:00:00.000Z";
    const providerVersion = `test-${randomUUID()}`;
    const content = currentPlanContent(taskId, at, providerVersion);
    await db.insert(captureTasks).values({ id: taskId, name: "安全 Attempt 恢复",
      originalRequest: "抓取公开产品目录", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-safe-attempt-recovery", taskId,
      taskRevision: 1, version: 4, status: "confirmed", contentHash: "6".repeat(64), confirmedAt: at,
      content });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const batch = await datasets.startBatch({ taskId, planId: "plan-safe-attempt-recovery",
      planVersion: 4, taskRevision: 1, plannedSourceCount: 1 });
    const previous = await datasets.startRun({ taskId, planId: "plan-safe-attempt-recovery",
      planVersion: 4, batchId: batch.id, sourceKey: "zol.catalog",
      providerKey: "public.web-resource", providerVersion, requestBudget: 10,
      accessPolicy: fixtureAccessPolicy(), targetKeys: ["market.catalog"] });
    await datasets.startTarget({ runId: previous.id, targetKey: "market.catalog" });
    await datasets.ensureCaptureWorkItem({ runId: previous.id, targetKey: "market.catalog",
      workKey: "page:entry", captureUnit: "公开目录页", expectedUnitCount: 1 });
    await datasets.startCaptureWorkItem({ runId: previous.id, workKey: "page:entry" });
    const admission = await datasets.reserveRequest({ runId: previous.id, targetKey: "market.catalog",
      workKey: "page:entry", gateKey: `fixture-safe:${taskId}`,
      providerKey: "public.web-resource", providerVersion, policyVersion: "fixture",
      requestedUrl: "https://detail.zol.com.cn/digital_tv/", minimumIntervalMs: 1,
      maxRequestsPerMinute: 1 });
    if (admission.status !== "admitted") throw new Error("fixture 请求没有获得准入");
    await datasets.finishRequest({ attemptId: admission.attempt.id, state: "completed",
      finalUrl: "https://detail.zol.com.cn/digital_tv/", httpStatus: 200, bytes: 100 });
    await datasets.finishTarget({ runId: previous.id, targetKey: "market.catalog", status: "stopped",
      terminationReason: "execution_process_lost" });
    await datasets.finishRun({ runId: previous.id, status: "stopped",
      terminationReason: "execution_process_lost", failureCategory: "execution_process_lost" });
    await datasets.finishBatch({ batchId: batch.id, status: "stopped",
      terminationReason: "execution_process_lost" });
    await datasets.setBatchRecoveryState(batch.id, "pending");
    const plan = { id: "plan-safe-attempt-recovery", taskId, taskRevision: 1, version: 4,
      status: "confirmed", content } as never;
    const planning = { requireExecutablePlan: async () => plan } satisfies CrawlPlanExecutionReader;
    const provider = completingProvider(providerVersion);
    const execution = createSourceExecutionModule(planning, datasets,
      new Map([[provider.key, provider]]));

    await execution.recoverBatch({ batchId: batch.id });

    const runs = await datasets.listBatchRuns(batch.id);
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({ status: "completed", resumedFromRunId: previous.id });
    expect(runs[1]?.requestBudget).toBe(previous.requestBudget);
  });

  it("outcome unknown Attempt 保持终态且自动恢复不重发", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-unknown-attempt-recovery-${randomUUID()}`;
    const at = "2026-08-28T03:00:00.000Z";
    const providerVersion = `test-${randomUUID()}`;
    const content = currentPlanContent(taskId, at, providerVersion);
    await db.insert(captureTasks).values({ id: taskId, name: "未知结果恢复",
      originalRequest: "抓取公开产品目录", marketScope: "本地 fixture", status: "ready",
      revision: 1, createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(sourceCollectionPlans).values({ id: "plan-unknown-attempt-recovery", taskId,
      taskRevision: 1, version: 4, status: "confirmed", contentHash: "7".repeat(64), confirmedAt: at,
      content });
    const datasets = createSourceDatasetModule(db, { assetStore: {
      async put() { throw new Error("不应写附件"); }, open() { return Readable.from([]); },
    } });
    const batch = await datasets.startBatch({ taskId, planId: "plan-unknown-attempt-recovery",
      planVersion: 4, taskRevision: 1, plannedSourceCount: 1 });
    const previous = await datasets.startRun({ taskId, planId: "plan-unknown-attempt-recovery",
      planVersion: 4, batchId: batch.id, sourceKey: "zol.catalog",
      providerKey: "public.web-resource", providerVersion, requestBudget: 10,
      accessPolicy: fixtureAccessPolicy(), targetKeys: ["market.catalog"] });
    await datasets.startTarget({ runId: previous.id, targetKey: "market.catalog" });
    await datasets.ensureCaptureWorkItem({ runId: previous.id, targetKey: "market.catalog",
      workKey: "page:entry", captureUnit: "公开目录页", expectedUnitCount: 1 });
    await datasets.startCaptureWorkItem({ runId: previous.id, workKey: "page:entry" });
    await datasets.reserveRequest({ runId: previous.id, targetKey: "market.catalog",
      workKey: "page:entry", gateKey: `fixture-unknown:${taskId}`,
      providerKey: "public.web-resource", providerVersion, policyVersion: "fixture",
      requestedUrl: "https://detail.zol.com.cn/digital_tv/", minimumIntervalMs: 1,
      maxRequestsPerMinute: 1 });
    await datasets.prepareRunForResume(previous.id);
    await datasets.finishBatch({ batchId: batch.id, status: "stopped",
      terminationReason: "execution_process_lost" });
    await datasets.setBatchRecoveryState(batch.id, "pending");
    await expect(datasets.getRun(previous.id)).resolves.toMatchObject({
      run: expect.objectContaining({ failureCategory: "execution_process_lost" }),
      requestAttempts: [expect.objectContaining({ state: "cancelled",
        restrictionReason: "request_outcome_unknown" })],
    });
    const plan = { id: "plan-unknown-attempt-recovery", taskId, taskRevision: 1, version: 4,
      status: "confirmed", content } as never;
    const planning = { requireExecutablePlan: async () => plan } satisfies CrawlPlanExecutionReader;
    const provider = completingProvider(providerVersion);
    const execution = createSourceExecutionModule(planning, datasets,
      new Map([[provider.key, provider]]));

    await execution.recoverBatch({ batchId: batch.id });

    expect(await datasets.listBatchRuns(batch.id)).toHaveLength(1);
    expect(provider.collect).not.toHaveBeenCalled();
    await expect(datasets.getBatch(batch.id)).resolves.toMatchObject({ recoveryState: "completed" });
  });

});

function references(count: number) {
  return Array.from({ length: count }, (_, ordinal) => ({
    kind: "image" as const,
    sourceUrl: `https://img.example.com/${ordinal}.webp`,
    observedValue: `//img.example.com/${ordinal}.webp`,
    locator: `#description img:nth-of-type(${ordinal + 1})@data-src`,
    role: ordinal === 0 ? "primary" as const : "detail" as const,
    section: ordinal === 0 ? "gallery" : "description",
    ordinal,
  }));
}

function runLeaseChildScript() {
  return fileURLToPath(new URL("./fixtures/sourceRunLeaseChild.ts", import.meta.url));
}

function waitForLine(child: ChildProcess, expected: string) {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    // WHY：全套 Vitest 并发时，Node/tsx 子进程的冷启动会竞争 CPU；20 秒只放宽进程启动门，
    // 子进程提前退出仍立即失败，不会掩盖租约协议错误或业务等待。
    const timeout = setTimeout(() => reject(new Error(`租约子进程未输出 ${expected}：${output}`)), 20_000);
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes(expected)) { clearTimeout(timeout); resolve(); }
    });
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => {
      if (!output.includes(expected)) {
        clearTimeout(timeout);
        reject(new Error(`租约子进程提前退出 ${code}：${output}`));
      }
    });
  });
}

function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function fixtureAccessPolicy() {
  return { kind: "paced_http" as const, version: "fixture", maxRequestsPerMinute: 1,
    minimumIntervalMs: 1, jitterMs: { min: 0, max: 0 }, batchSize: 1,
    batchCooldownMs: 1, maximumRunMs: 1_000 };
}

function completingProvider(version: string) {
  const collect = vi.fn(async function* (source: Parameters<SourceProvider["collect"]>[0]) {
    yield { type: "target.completed" as const, targetKey: source.targets[0]!.key };
  });
  return { key: "public.web-resource", version, validate() {},
    async preflightEnvironment() {}, async preflight() {}, collect } satisfies SourceProvider;
}

function currentPlanContent(taskId: string, observedAt: string, providerVersion = "2.0.0") {
  return {
    taskId, taskRevision: 1, summary: "抓取跨品牌市场目录", excludedContent: [], planningBlockers: [],
    executionChecklistVersion: 5 as const,
    sources: [{ key: "zol.catalog", name: "ZOL 电视产品库", publisher: "中关村在线",
      sourceKind: "other" as const, role: "跨品牌市场目录", sourceCandidateIds: [],
      entryUrls: ["https://detail.zol.com.cn/digital_tv/"],
      provider: { key: "public.web-resource", version: providerVersion, configuration: [
        { key: "mode", value: "planned_routes" }, { key: "maximum_bytes", value: 100_000 },
        { key: "maximum_pages_per_target", value: 10 },
      ] },
      accessPolicy: { kind: "paced_http" as const, version: "fixture", maxRequestsPerMinute: 2,
        minimumIntervalMs: 1, maximumRunMs: 10_000 },
      stopPolicy: { requestBudget: 10, noNewUniqueKeysLimit: 10, stopOnAccessRestriction: true as const },
      rawOutputPolicy: { formats: ["html" as const], retainAssets: false },
      observationLevel: "search_discovered" as const, accessState: "unknown" as const, observedAt,
      executionBlockers: [], targets: [{ key: "market.catalog", name: "电视门类与产品页",
        taskTopics: ["品牌", "型号"], captureUnit: "公开目录页", rawFormats: ["HTML"],
        quantity: { mode: "all_available" as const, unit: "页", denominator: "计划内公开页面",
          rationale: "按内容验收统计" }, uniqueKey: "URL", traversal: "有界站内发现",
        stopCondition: "达到计划页数或无新增页面", providerConfiguration: [
          { key: "route", value: "site" }, { key: "url", value: "https://detail.zol.com.cn/digital_tv/" },
          { key: "required_terms", value: ["电视", "型号"] }, { key: "maximum_depth", value: 2 },
          { key: "minimum_accepted_pages", value: 1 },
        ] }],
    }],
  };
}

async function clearTask(db: WorkbenchDb, taskId: string) {
  const runs = await db.select({ id: sourceCollectionRuns.id }).from(sourceCollectionRuns)
    .where(eq(sourceCollectionRuns.taskId, taskId));
  for (const run of runs) {
    const snapshots = await db.select({ id: sourceSnapshots.id }).from(sourceSnapshots)
      .where(eq(sourceSnapshots.runId, run.id));
    if (snapshots.length > 0) {
      await db.delete(sourceAssets).where(inArray(sourceAssets.snapshotId, snapshots.map((item) => item.id)));
    }
    await db.delete(sourceSnapshots).where(eq(sourceSnapshots.runId, run.id));
    await db.delete(sourceCollectionTargetRuns).where(eq(sourceCollectionTargetRuns.runId, run.id));
  }
  await db.delete(sourceCollectionRuns).where(eq(sourceCollectionRuns.taskId, taskId));
  await db.delete(sourceCollectionBatches).where(eq(sourceCollectionBatches.taskId, taskId));
  await db.delete(sourceObjects).where(eq(sourceObjects.taskId, taskId));
  await db.delete(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, taskId));
  await db.delete(captureTasks).where(eq(captureTasks.id, taskId));
}
