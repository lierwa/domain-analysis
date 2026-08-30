import { randomUUID } from "node:crypto";

import { captureTasks, crawlPlanningRuns, createWorkbenchDb, migrateWorkbenchDatabase, sourceCollectionPlans,
  type WorkbenchDb } from "@domain-analysis/db";
import { captureTaskSchema, crawlPlanContentSchema } from "@domain-analysis/shared";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createCrawlPlanModule } from "../src/crawlPlanModule";
import type { CaptureTaskModule } from "../src/captureTaskModule";
import { createCrawlPlanningModule, type CrawlPlanningRuntime } from "../src/crawlPlanningModule";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("Crawl Plan 版本与确认", () => {
  let db: WorkbenchDb | undefined;
  let taskId: string | undefined;
  let planningRunId: string | undefined;

  afterEach(async () => {
    if (db && taskId) {
      await db.delete(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, taskId));
      await db.delete(crawlPlanningRuns).where(eq(crawlPlanningRuns.taskId, taskId));
      await db.delete(captureTasks).where(eq(captureTasks.id, taskId));
    }
    await db?.$client.end();
  });

  it("规划草稿独立确认，确定性计划仍可直接发布已确认版本", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-crawl-plan-${randomUUID()}`;
    const at = "2026-08-29T00:00:00.000Z";
    const task = captureTaskSchema.parse({ id: taskId, name: "冰箱计划", status: "ready", revision: 1,
      content: { originalRequest: "抓冰箱", category: { code: "icebox", label: "冰箱" },
        marketScope: "中国大陆", generalTopics: ["型号"], categoryTopics: ["参数", "图片"],
        sourceCandidates: [], excludedContent: [], unresolvedItems: [], decisionIds: [] },
      createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(captureTasks).values({ id: task.id, name: task.name,
      originalRequest: task.content.originalRequest, marketScope: task.content.marketScope,
      status: task.status, revision: task.revision, createdAt: at, updatedAt: at, confirmedAt: at });
    const tasks = { get: async (id: string) => id === task.id ? task : null } as unknown as CaptureTaskModule;
    const plans = createCrawlPlanModule(db, tasks, () => new Date(at));
    planningRunId = `planning-${randomUUID()}`;
    await db.insert(crawlPlanningRuns).values({ id: planningRunId, taskId: task.id,
      taskRevision: task.revision, status: "running", timelineParts: [], startedAt: at });

    const draft = await plans.publishDraft({ taskId: task.id, expectedTaskRevision: 1,
      planningRunId, content: planContent(task.id, "规划草稿") });
    expect(draft.status).toBe("draft");
    const confirmed = await plans.confirmDraft({ taskId: task.id, expectedTaskRevision: 1, planId: draft.id });
    expect(confirmed.status).toBe("confirmed");

    const direct = await plans.publishConfirmed({ taskId: task.id, expectedTaskRevision: 1,
      content: planContent(task.id, "确定性验收计划") });
    expect(direct.version).toBe(2);
    await expect(plans.requireExecutablePlan({ taskId: task.id, planId: draft.id,
      expectedTaskRevision: 1, expectedPlanVersion: 1 })).rejects.toThrow("只有当前已确认来源计划可以启动");
    await expect(plans.latestConfirmed(task.id)).resolves.toMatchObject({ id: direct.id, version: 2 });

    const legacyRunId = `planning-${randomUUID()}`;
    await db.insert(crawlPlanningRuns).values({ id: legacyRunId, taskId: task.id,
      taskRevision: task.revision, status: "running", timelineParts: [], startedAt: at });
    const legacyContent = { ...planContent(task.id, "旧规划协议草稿"), executionChecklistVersion: 4 };
    const legacy = await plans.publishDraft({ taskId: task.id, expectedTaskRevision: 1,
      planningRunId: legacyRunId, content: legacyContent });
    await expect(plans.confirmDraft({ taskId: task.id, expectedTaskRevision: 1, planId: legacy.id }))
      .rejects.toThrow("旧规划协议");

    const blockedRunId = `planning-${randomUUID()}`;
    await db.insert(crawlPlanningRuns).values({ id: blockedRunId, taskId: task.id,
      taskRevision: task.revision, status: "running", timelineParts: [], startedAt: at });
    const blocked = await plans.publishDraft({ taskId: task.id, expectedTaskRevision: 1,
      planningRunId: blockedRunId, content: crawlPlanContentSchema.parse({ taskId: task.id, taskRevision: 1,
        summary: "排行榜待核实", excludedContent: [], executionChecklistVersion: 5,
        researchAudit: unavailableAudit(), sources: [],
        planningBlockers: ["ZOL 门类品牌排行榜尚不可验证"] }) });
    await expect(plans.confirmDraft({ taskId: task.id, expectedTaskRevision: 1, planId: blocked.id }))
      .rejects.toThrow("计划仍有确认阻塞");

    const invalidRunId = `planning-${randomUUID()}`;
    await db.insert(crawlPlanningRuns).values({ id: invalidRunId, taskId: task.id,
      taskRevision: task.revision, status: "running", timelineParts: [], startedAt: at });
    const invalid = await plans.publishDraft({ taskId: task.id, expectedTaskRevision: 1,
      planningRunId: invalidRunId, content: { ...planContent(task.id, "缺少排行榜审计"),
        researchAudit: { kind: "brand_ranking_selection" } } });
    await expect(plans.confirmDraft({ taskId: task.id, expectedTaskRevision: 1, planId: invalid.id }))
      .rejects.toThrow("缺少当前协议的品牌排行榜审计");
  });

  it("Planning Run 持久化时间线和草稿，并保持计划确认与执行分离", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    taskId = `task-crawl-planning-${randomUUID()}`;
    const at = "2026-08-29T00:00:00.000Z";
    const task = captureTaskSchema.parse({ id: taskId, name: "冰箱规划", status: "ready", revision: 1,
      content: { originalRequest: "抓冰箱", category: { code: "icebox", label: "冰箱" },
        marketScope: "中国大陆", generalTopics: ["型号"], categoryTopics: ["参数", "图片"],
        sourceCandidates: [], excludedContent: [], unresolvedItems: [], decisionIds: [] },
      createdAt: at, updatedAt: at, confirmedAt: at });
    await db.insert(captureTasks).values({ id: task.id, name: task.name,
      originalRequest: task.content.originalRequest, marketScope: task.content.marketScope,
      status: task.status, revision: task.revision, createdAt: at, updatedAt: at, confirmedAt: at });
    const tasks = { get: async (id: string) => id === task.id ? task : null } as unknown as CaptureTaskModule;
    const plans = createCrawlPlanModule(db, tasks, () => new Date(at));
    const runtime: CrawlPlanningRuntime = { async *run() {
      yield { type: "activity", activity: { id: "ranking", kind: "analysis",
        label: "核对品牌排行榜", status: "completed" } };
      yield { type: "text_delta", delta: "计划草稿已形成。" };
      yield { type: "completed", assistantText: "等待负责人确认。",
        content: planContent(task.id, "正式 Planning Run 草稿") };
    } };
    const planning = createCrawlPlanningModule(db, tasks, plans, runtime);

    const events = [];
    for await (const event of planning.run({ taskId: task.id, expectedTaskRevision: 1 })) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      "run.started", "run.activity", "assistant.delta", "run.completed",
    ]);
    const draftView = await planning.get(task.id);
    expect(draftView?.runs[0]).toMatchObject({ status: "completed", planId: expect.any(String) });
    expect(draftView?.plans[0]).toMatchObject({ status: "draft" });
    expect(draftView?.plans[0]?.confirmedAt).toBeUndefined();
    const confirmedView = await planning.confirm({ taskId: task.id,
      planId: draftView!.plans[0]!.id, expectedTaskRevision: 1 });
    expect(confirmedView.plans[0]).toMatchObject({ status: "confirmed", confirmedAt: at });
  });
});

function planContent(taskId: string, summary: string) {
  return crawlPlanContentSchema.parse({ taskId, taskRevision: 1, summary, excludedContent: [],
    executionChecklistVersion: 5, researchAudit: verifiedAudit(), planningBlockers: [],
    sources: [{ key: "fixture", name: "fixture", publisher: "fixture",
      sourceKind: "other", sourceCandidateIds: [], role: "测试发布", entryUrls: ["https://example.com/"],
      provider: { key: "fixture", version: "1.0.0", configuration: [] },
      accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
        minimumIntervalMs: 1, maximumRunMs: 1_000 },
      stopPolicy: { requestBudget: 1, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
      rawOutputPolicy: { formats: ["html"], retainAssets: false }, observationLevel: "search_discovered",
      accessState: "public", observedAt: "2026-08-29T00:00:00.000Z", targets: [{ key: "page",
        name: "页面", taskTopics: ["型号"], captureUnit: "HTML", rawFormats: ["HTML"],
        quantity: { mode: "target_count", targetCount: 1, unit: "页", denominator: "fixture",
          rationale: "发布模块测试" }, uniqueKey: "URL", traversal: "单页",
      stopCondition: "一次完成", providerConfiguration: [] }], executionBlockers: [] }] });
}

function verifiedAudit() {
  const brand = { key: "haier", name: "海尔", catalogUrl: "https://detail.zol.com.cn/icebox/haier/" };
  return {
    kind: "brand_ranking_selection" as const,
    categoryUrl: "https://detail.zol.com.cn/icebox/",
    categorySlug: "icebox",
    evidenceUrls: ["https://detail.zol.com.cn/icebox/",
      "https://top.zol.com.cn/compositor/359/manu_attention.html"],
    observedAt: "2026-08-29T00:00:00.000Z",
    selectionPolicy: { scoreField: "comprehensive_score" as const,
      minimumScoreExclusive: 0, maxBrands: 20 },
    rankingStatus: "verified" as const,
    rankingUrl: "https://top.zol.com.cn/compositor/359/manu_attention.html",
    rankingRows: [{ rank: 1, name: brand.name, comprehensiveScore: 99.5,
      key: brand.key, catalogUrl: brand.catalogUrl }],
    executionBrands: [brand], blockedSelectedBrands: [],
    brandBatchSize: 3, modelsPerBrandPerRound: 10, maxModelsPerBrand: 20,
    estimatedModelCapacity: 20, requestBudget: 5_000, maximumRunMs: 43_200_000,
    budgetRationale: "一个榜单品牌最多二十个型号。",
  };
}

function unavailableAudit() {
  return {
    kind: "brand_ranking_selection" as const,
    categoryUrl: "https://detail.zol.com.cn/icebox/",
    categorySlug: "icebox",
    evidenceUrls: ["https://detail.zol.com.cn/icebox/",
      "https://top.zol.com.cn/compositor/359/manu_attention.html"],
    observedAt: "2026-08-29T00:00:00.000Z",
    selectionPolicy: { scoreField: "comprehensive_score" as const,
      minimumScoreExclusive: 0, maxBrands: 20 },
    rankingStatus: "unavailable" as const,
    rankingEvidenceUrls: ["https://top.zol.com.cn/compositor/359/manu_attention.html"],
    rankingReason: "当前页面无法验证综合评分。",
  };
}
