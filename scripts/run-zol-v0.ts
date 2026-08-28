import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import {
  captureTasks,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  sourceCollectionPlans,
} from "@domain-analysis/db";
import type {
  CaptureTaskContent,
  CrawlPlan,
  CrawlPlanContent,
  RawSourcePayload,
  SourceDatasetRunView,
  SourceDatasetTaskView,
  SourceSnapshotRecord,
} from "@domain-analysis/shared";
import { crawlPlanSchema } from "@domain-analysis/shared";
import { createSourceDatasetModule, createSourceExecutionModule,
  type CrawlPlanExecutionReader } from "@domain-analysis/workbench";
import { eq } from "drizzle-orm";

import {
  calculateP1,
  createZolCategoryProvider,
  parseZolCatalogPage,
  parseZolCategoryPage,
  parseZolParameterPage,
  parseZolRankingPage,
} from "../packages/worker/src/zolCategoryProvider";
import type { RawPublicResponse } from "../packages/worker/src/publicResourceTransport";

const categoryUrl = "https://detail.zol.com.cn/icebox/";
const rankingUrl = "https://top.zol.com.cn/compositor/359/manu_attention.html";
const sourceKey = "zol.icebox.v0";
const targetKey = "zol.v0.pages";

async function main() {
  const databaseUrl = process.env.POSTGRES_DATABASE_URL;
  await migrateWorkbenchDatabase(databaseUrl);
  const db = createWorkbenchDb(databaseUrl);
  const token = randomUUID();
  const taskId = `task-zol-v0-${token}`;
  const planId = `plan-zol-v0-${token}`;
  const commandId = `command-zol-v0-${token}`;
  const now = new Date().toISOString();
  try {
    const taskContent = createTaskContent(now);
    const plan = createPlan(taskId, planId, now);
    await db.insert(captureTasks).values({ id: taskId, name: "ZOL 冰箱 V0 单品牌验证",
      originalRequest: taskContent.originalRequest, marketScope: taskContent.marketScope, status: "ready",
      revision: 1, content: taskContent, createdAt: now, updatedAt: now, confirmedAt: now });
    await db.insert(sourceCollectionPlans).values({ id: plan.id, taskId, taskRevision: plan.taskRevision,
      version: plan.version, status: "confirmed", contentHash: plan.contentHash,
      content: plan.content, createdAt: now, confirmedAt: now });

    const datasets = createSourceDatasetModule(db, { assetCachePath: "/private/tmp/domain-analysis-zol-v0-assets" });
    const planning: CrawlPlanExecutionReader = {
      async requireExecutablePlan(input) {
        if (input.taskId !== taskId || input.planId !== plan.id
          || input.expectedTaskRevision !== plan.taskRevision || input.expectedPlanVersion !== plan.version) {
          throw new Error("ZOL V0 运行器的任务或计划版本不一致");
        }
        return plan;
      },
    };
    const provider = createZolCategoryProvider();
    const execution = createSourceExecutionModule(planning, datasets, new Map([[provider.key, provider]]));
    let executionError: unknown;
    try {
      for await (const _event of execution.start({ taskId, planId: plan.id,
        expectedTaskRevision: plan.taskRevision, expectedPlanVersion: plan.version, commandId })) { /* evidence is read back from DB */ }
    } catch (error) {
      executionError = error;
    }

    const batch = await datasets.getBatchByCommandId(commandId);
    if (!batch) {
      printStopReport({ taskId, planId, commandId, error: executionError ?? new Error("运行未创建正式 Batch") });
      process.exitCode = 1;
      return;
    }
    const [run] = await datasets.listBatchRuns(batch.id);
    const runView = run ? await datasets.getRun(run.id) : null;
    const taskView = await datasets.listTask(taskId);
    if (!run || !runView) {
      printStopReport({ taskId, planId, commandId, batchId: batch.id,
        error: executionError ?? new Error("正式 Batch 缺少 Source Run") });
      process.exitCode = 1;
      return;
    }
    const rawExportPath = `/private/tmp/${taskId}.jsonl`;
    await exportRawRun(datasets, run.id, rawExportPath);
    const evidence = buildEvidence({ taskId, planId, commandId, batch, runView, taskView, rawExportPath });
    console.log(JSON.stringify(evidence, null, 2));
    if (executionError || !evidence.passed) process.exitCode = 1;
  } finally {
    await db.$client.end();
  }
}

function createTaskContent(observedAt: string): CaptureTaskContent {
  return {
    originalRequest: "验证 ZOL 冰箱公开 HTML 链：门类品牌发现、品牌关注度 P1、首个 P1 品牌两页型号目录和三个型号参数页。",
    category: { code: "icebox", label: "冰箱" }, marketScope: "中国大陆公开网页",
    generalTopics: ["品牌覆盖", "型号目录", "原始参数"],
    categoryTopics: ["品牌关注度", "型号 ID", "基本参数", "技术参数", "功能特点"],
    sourceCandidates: [{ id: "zol-icebox-public", name: "ZOL 冰箱公开页面", publisher: "ZOL 中关村在线",
      entryUrl: categoryUrl, sourceKind: "other", expectedContents: ["门类品牌入口", "品牌榜", "型号目录", "型号参数"],
      observedFormats: ["HTML", "TEXT"], accessState: "public", observedAt }],
    excludedContent: ["图片附件", "评论", "电商交易", "论坛", "登录后内容", "其他来源"],
    unresolvedItems: [], decisionIds: [],
  };
}

function createPlan(taskId: string, planId: string, observedAt: string): CrawlPlan {
  const content: CrawlPlanContent = {
    taskId, taskRevision: 1, summary: "ZOL 冰箱 V0：单品牌七页面原始 HTML 验证。",
    excludedContent: ["图片附件", "评论", "电商交易", "论坛", "登录后内容", "其他来源"],
    executionChecklistVersion: 1,
    sources: [{ key: sourceKey, name: "ZOL 冰箱 V0", publisher: "ZOL 中关村在线", sourceKind: "other",
      sourceCandidateIds: [], role: "门类品牌发现、P1、单品牌型号分页和参数原文",
      entryUrls: [categoryUrl, rankingUrl],
      provider: { key: "zol.category", version: "0.1.0", configuration: [
        { key: "mode", value: "zol_v0" }, { key: "category_id", value: "2115" },
        { key: "category_url", value: categoryUrl }, { key: "ranking_url", value: rankingUrl },
        { key: "parameter_pages", value: 3 }, { key: "maximum_bytes", value: 25_000_000 },
      ] },
      accessPolicy: { kind: "paced_http", version: "zol-v0-1", maxRequestsPerMinute: 2,
        minimumIntervalMs: 30_000, maximumRunMs: 600_000 },
      stopPolicy: { requestBudget: 18, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
      rawOutputPolicy: { formats: ["html", "text"], retainAssets: false }, observationLevel: "search_discovered",
      accessState: "public", observedAt, executionBlockers: [],
      targets: [{ key: targetKey, name: "ZOL V0 七页面原始响应", taskTopics: ["品牌", "型号", "参数"],
        captureUnit: "ZOL 原始 HTML/robots 响应", rawFormats: ["HTML", "TEXT"],
        quantity: { mode: "target_count", targetCount: 7, unit: "页面",
          denominator: "1 门类 + 1 品牌榜 + 2 品牌列表页 + 3 型号参数页", rationale: "ZOL V0 单品牌纵向验证" },
        uniqueKey: "ZOL URL 与型号 ID", traversal: "门类 → P1 → 首个 P1 品牌两页列表 → 三个型号参数页",
        stopCondition: "403/429/登录/CAPTCHA/风控/robots 拒绝/结构失败立即停止",
        providerConfiguration: [{ key: "route", value: "zol_v0" }] }],
    }],
  };
  return crawlPlanSchema.parse({ id: planId, taskId, taskRevision: 1,
    planningRunId: `planning-zol-v0-${randomUUID()}`, version: 1, status: "confirmed",
    contentHash: hash(JSON.stringify(content)), content, createdAt: observedAt, confirmedAt: observedAt });
}

async function exportRawRun(datasets: ReturnType<typeof createSourceDatasetModule>, runId: string, path: string) {
  const chunks: string[] = [];
  for await (const chunk of datasets.exportRun({ runId, format: "jsonl" })) chunks.push(chunk);
  await writeFile(path, chunks.join(""), "utf8");
}

function buildEvidence(input: { taskId: string; planId: string; commandId: string;
  batch: Awaited<ReturnType<ReturnType<typeof createSourceDatasetModule>["getBatchByCommandId"]>>;
  runView: SourceDatasetRunView; taskView: SourceDatasetTaskView; rawExportPath: string }) {
  const { batch, runView, taskView } = input;
  const records = runView.records;
  const robotsRecords = records.filter((record) => record.snapshot.observation.requestedUrl.endsWith("/robots.txt"));
  const pageRecords = records.filter((record) => !record.snapshot.observation.requestedUrl.endsWith("/robots.txt"));
  const attempts = runView.requestAttempts;
  const pageAttempts = attempts.filter((attempt) => !attempt.requestedUrl.endsWith("/robots.txt"));
  const categoryRecord = recordAt(pageRecords, categoryUrl);
  const rankingRecord = recordAt(pageRecords, rankingUrl);
  const facts = categoryRecord && rankingRecord ? identifyFacts(categoryRecord, rankingRecord, pageRecords) : undefined;
  const checks = [
    check("batch_completed", batch?.status === "completed"),
    check("run_completed", runView.run.status === "completed"),
    check("target_completed", runView.targets.length === 1 && runView.targets[0]?.status === "completed"),
    check("seven_page_snapshots", pageRecords.length === 7),
    check("seven_page_work_items", new Set(pageAttempts.map((attempt) => attempt.workKey)).size === 7),
    check("two_robots_supporting_snapshots", robotsRecords.length === 2
      && robotsRecords.every((record) => record.snapshot.observation.contentAssessment?.status === "supporting")),
    check("all_attempts_terminal", attempts.length <= (runView.run.requestBudget ?? 0)
      && attempts.every((attempt) => attempt.state !== "started")),
    check("thirty_second_origin_spacing", spacingViolations(attempts).length === 0),
    check("p1_and_parameter_facts", Boolean(facts?.p1.brands.length && facts.parameters.length === 3
      && facts.parameters.every((item) => item.sections.length > 0))),
    check("no_running_residual", !runView.targets.some((target) => ["pending", "running"].includes(target.status))
      && !runView.workItems.some((item) => ["pending", "running"].includes(item.status))),
    check("formal_dataset_read", taskView.sources.some((source) => source.sourceKey === sourceKey
      && source.targets.some((target) => target.targetKey === targetKey && target.recordGroups.length > 0))),
  ];
  return {
    passed: checks.every((item) => item.passed), taskId: input.taskId, planId: input.planId, commandId: input.commandId,
    batch: batch && { id: batch.id, status: batch.status, startedAt: batch.startedAt, finishedAt: batch.finishedAt },
    terminalState: { run: runView.run, targets: runView.targets, workItems: runView.workItems },
    checks, p1: facts?.p1, catalog: facts?.catalog, parameters: facts?.parameters,
    rawPages: pageRecords.map(rawPageEvidence), robots: robotsRecords.map(rawPageEvidence),
    requestLedger: attempts.map((attempt) => ({ id: attempt.id, workKey: attempt.workKey,
      requestedUrl: attempt.requestedUrl, origin: attempt.origin, gateKey: attempt.gateKey,
      startedAt: attempt.startedAt, finishedAt: attempt.finishedAt, state: attempt.state,
      httpStatus: attempt.httpStatus, bytes: attempt.bytes })),
    formalDataset: { sourceKeys: taskView.sources.map((source) => source.sourceKey),
      recordGroups: taskView.sources.flatMap((source) => source.targets.flatMap((target) =>
        target.recordGroups.map((group) => ({ sourceKey: source.sourceKey, targetKey: target.targetKey, ...group })))) },
    rawExportPath: input.rawExportPath,
  };
}

function identifyFacts(categoryRecord: SourceSnapshotRecord, rankingRecord: SourceSnapshotRecord,
  pageRecords: SourceSnapshotRecord[]) {
  const category = parseZolCategoryPage(asResponse(categoryRecord));
  const ranking = parseZolRankingPage(asResponse(rankingRecord));
  const p1 = calculateP1(category, ranking);
  const catalog = p1.brands[0] ? pageRecords
    .filter((record) => record.snapshot.observation.requestedUrl === p1.brands[0]!.url
      || record.snapshot.observation.requestedUrl === `${p1.brands[0]!.url}2.html`)
    .sort((left, right) => left.snapshot.observation.requestedUrl.localeCompare(right.snapshot.observation.requestedUrl))
    .map((record, index) => parseZolCatalogPage(asResponse(record), new URL(record.snapshot.observation.requestedUrl), index + 1)) : [];
  const models = [...new Map(catalog.flatMap((item) => item.models).map((model) => [model.id, model])).values()];
  const parameters = models.slice(0, 3).flatMap((model) => {
    const record = pageRecords.find((item) => item.snapshot.observation.requestedUrl
      === `https://detail.zol.com.cn/2115/${model.id}/param.shtml`);
    return record ? [parseZolParameterPage(asResponse(record), model.id)] : [];
  });
  return { p1: { coverage: p1.coverage, brands: p1.brands.map((brand) => ({ key: brand.key,
    name: brand.name, attentionPercent: brand.attentionPercent, productCount: brand.productCount })) },
    catalog: { brand: p1.brands[0]?.name, pages: catalog, uniqueModelIds: models.map((model) => model.id) }, parameters };
}

function asResponse(record: SourceSnapshotRecord): RawPublicResponse {
  const payload = record.snapshot.payload;
  if (!payload || payload.kind !== "inline_text") throw new Error("ZOL V0 原始页面缺少 inline_text payload");
  return { statusCode: record.snapshot.observation.httpStatus ?? 200,
    headers: { ...record.snapshot.observation.responseHeaders, "content-type": "text/html; charset=utf-8" },
    body: new TextEncoder().encode(payload.text), finalUrl: record.snapshot.observation.finalUrl
      ?? record.snapshot.observation.requestedUrl };
}

function rawPageEvidence(record: SourceSnapshotRecord) {
  const payload = record.snapshot.payload;
  return { requestedUrl: record.snapshot.observation.requestedUrl, finalUrl: record.snapshot.observation.finalUrl,
    state: record.snapshot.observation.state, httpStatus: record.snapshot.observation.httpStatus,
    assessment: record.snapshot.observation.contentAssessment, lineage: record.snapshot.lineage,
    payload: payloadSummary(payload), snapshotId: record.snapshot.id, contentHash: record.snapshot.contentHash };
}

function payloadSummary(payload: RawSourcePayload | undefined) {
  if (!payload) return undefined;
  if (payload.kind === "inline_text") return { kind: payload.kind, mediaType: payload.mediaType, bytes: payload.bytes,
    contentHash: payload.contentHash };
  return { kind: payload.kind };
}

function recordAt(records: SourceSnapshotRecord[], url: string) {
  return records.find((record) => record.snapshot.observation.requestedUrl === url);
}

function spacingViolations(attempts: SourceDatasetRunView["requestAttempts"]) {
  const violations: string[] = [];
  for (const origin of new Set(attempts.map((attempt) => attempt.origin))) {
    const sameOrigin = attempts.filter((attempt) => attempt.origin === origin)
      .sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());
    for (let index = 1; index < sameOrigin.length; index += 1) {
      const gap = new Date(sameOrigin[index]!.startedAt).getTime()
        - new Date(sameOrigin[index - 1]!.startedAt).getTime();
      if (gap < 30_000) violations.push(`${origin}:${gap}`);
    }
  }
  return violations;
}

function check(name: string, passed: boolean) { return { name, passed }; }

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

function printStopReport(input: { taskId: string; planId: string; commandId: string; batchId?: string; error: unknown }) {
  console.error(JSON.stringify({ passed: false, stopCondition: true, taskId: input.taskId, planId: input.planId,
    commandId: input.commandId, batchId: input.batchId,
    error: input.error instanceof Error ? input.error.message : String(input.error) }, null, 2));
}

await main();
