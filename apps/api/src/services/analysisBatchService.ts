import {
  createAnalysisBatchRepository,
  createAnalysisProjectRepository,
  createAnalysisRunRepository,
  createRawContentRepository,
  createRunReportRepository,
  type AppDb
} from "@domain-analysis/db";
import type { AnalysisBatchPlatform } from "@domain-analysis/shared";
import { createAnalysisRunService, deriveBatchStatus, refreshBatchFromRuns } from "./analysisRunService";

export { deriveBatchStatus };

export function createAnalysisBatchService(db: AppDb) {
  const batchRepo = createAnalysisBatchRepository(db);
  const projectRepo = createAnalysisProjectRepository(db);
  const runRepo = createAnalysisRunRepository(db);
  const contentRepo = createRawContentRepository(db);
  const reportRepo = createRunReportRepository(db);
  const runService = createAnalysisRunService(db);

  return {
    async createBatch(input: {
      projectId?: string;
      projectName?: string;
      goal: string;
      includeKeywords: string[];
      excludeKeywords: string[];
      language: string;
      market: string;
      platformLimits: Array<{ platform: AnalysisBatchPlatform; limit: number }>;
    }) {
      let projectId = input.projectId;
      if (!projectId) {
        const project = await projectRepo.create({
          name: input.projectName ?? input.goal.slice(0, 60),
          goal: input.goal,
          language: input.language,
          market: input.market,
          defaultLimit: Math.max(...input.platformLimits.map((item) => item.limit))
        });
        projectId = project.id;
      }

      const batch = await batchRepo.create({
        projectId,
        name: createBatchName(input.includeKeywords),
        goal: input.goal,
        includeKeywords: input.includeKeywords,
        excludeKeywords: input.excludeKeywords,
        language: input.language,
        market: input.market
      });

      // WHY: batch 表示同一业务问题；每个平台仍是独立 run，便于复用现有采集/状态/报告链路。
      // TRADE-OFF: 当前先顺序创建子 run，不额外引入 workflow engine；后续任务量上来再升级编排层。
      const runs = [];
      for (const platformLimit of input.platformLimits) {
        const run = await runRepo.create({
          projectId,
          analysisBatchId: batch.id,
          name: `${batch.name} - ${platformLimit.platform}`,
          goal: input.goal,
          platform: platformLimit.platform,
          includeKeywords: input.includeKeywords,
          excludeKeywords: input.excludeKeywords,
          language: input.language,
          market: input.market,
          limit: platformLimit.limit,
          runTrigger: "manual"
        });
        runs.push(run);
      }

      return withRuns(batch, runs);
    },

    async getBatch(id: string) {
      const batch = await batchRepo.getById(id);
      if (!batch) return null;
      const runs = await runRepo.listByBatch(id);
      return withRuns(batch, runs);
    },

    async listBatches(page: number, pageSize: number) {
      const result = await batchRepo.listPage({ page, pageSize });
      const items = [];
      for (const batch of result.items) {
        const runs = await runRepo.listByBatch(batch.id);
        items.push(withRuns(batch, runs));
      }
      return { items, page: result.page };
    },

    async startBatch(id: string) {
      const batch = await batchRepo.getById(id);
      if (!batch) throw Object.assign(new Error("batch_not_found"), { statusCode: 404 });

      const runs = await runRepo.listByBatch(id);
      if (runs.some((run) => run.status === "collecting")) {
        return withRuns(batch, runs);
      }

      await batchRepo.update(id, {
        status: "collecting",
        startedAt: new Date().toISOString(),
        errorMessage: null
      });

      for (const run of runs) {
        if (run.status === "draft" || run.status === "collection_failed") {
          await runService.startRun(run.id);
        }
      }
      await refreshBatchFromRuns(id, { batchRepo, runRepo });

      const updated = await batchRepo.getById(id);
      return withRuns(updated ?? batch, await runRepo.listByBatch(id));
    },

    async deleteBatch(id: string) {
      const batch = await batchRepo.getById(id);
      if (!batch) return null;
      const runs = await runRepo.listByBatch(id);
      if (runs.some((run) => run.status === "collecting")) {
        throw Object.assign(new Error("Cannot delete a batch while a child run is collecting"), { statusCode: 400 });
      }
      await batchRepo.remove(id);
      return batch;
    },

    async generateReport(id: string) {
      const batch = await batchRepo.getById(id);
      if (!batch) throw Object.assign(new Error("batch_not_found"), { statusCode: 404 });
      if (!["content_ready", "partial_ready"].includes(batch.status)) {
        throw Object.assign(new Error("Batch report can only be generated after content is ready"), {
          statusCode: 400
        });
      }

      const runs = await runRepo.listByBatch(id);
      const reportRun = runs.find((run) => run.validCount > 0) ?? runs[0];
      if (!reportRun) throw Object.assign(new Error("batch_has_no_runs"), { statusCode: 400 });

      const contents = [];
      for (const run of runs) {
        const page = await contentRepo.listByRunPage(run.id, { page: 1, pageSize: 500 });
        contents.push(...page.items);
      }

      const platformStats = runs.map((run) => ({
        platform: run.platform,
        target: run.limit,
        collected: run.collectedCount,
        valid: run.validCount,
        duplicates: run.duplicateCount,
        status: run.status
      }));

      const report = await reportRepo.create({
        projectId: batch.projectId,
        // WHY: 当前 reports schema 仍要求 analysisRunId；先挂到首个有效 child run，contentJson 保留 batchId。
        // TRADE-OFF: 这样避免一次迁移改动报告历史结构，后续再把 reports 升级为可直接绑定 batch。
        analysisRunId: reportRun.id,
        title: `${batch.name} - Batch Report`,
        type: "run_summary",
        contentMarkdown: buildBatchReport(batch, platformStats, contents),
        contentJson: {
          batchId: id,
          runIds: runs.map((run) => run.id),
          platformStats,
          totalContents: contents.length,
          generatedAt: new Date().toISOString()
        }
      });

      await batchRepo.update(id, { status: "report_ready", reportId: report.id });
      return report;
    }
  };
}

function createBatchName(includeKeywords: string[]) {
  return `${includeKeywords.slice(0, 2).join(", ")} - ${new Date().toLocaleDateString("en", {
    month: "short",
    day: "numeric"
  })}`;
}

function withRuns<TBatch extends { id: string }>(
  batch: TBatch,
  runs: Array<{
    id: string;
    platform: string;
    status: string;
    limit: number;
    collectedCount: number;
    validCount: number;
    duplicateCount: number;
    errorMessage?: string;
  }>
) {
  return {
    ...batch,
    runCount: runs.length,
    runs
  };
}

function buildBatchReport(
  batch: {
    name: string;
    goal: string;
    includeKeywords: string[];
    excludeKeywords: string[];
    collectedCount: number;
    validCount: number;
    duplicateCount: number;
  },
  platformStats: Array<{
    platform: string;
    target: number;
    collected: number;
    valid: number;
    duplicates: number;
    status: string;
  }>,
  contents: Array<{ platform: string; authorName?: string; authorHandle?: string; url: string; text: string }>
) {
  const samples = contents.slice(0, 10);
  return `# ${batch.name} - Batch Report

## Goal

${batch.goal}

## Overview

| Metric | Value |
|--------|-------|
| Collected | ${batch.collectedCount} |
| Valid | ${batch.validCount} |
| Duplicates | ${batch.duplicateCount} |
| Include keywords | ${batch.includeKeywords.join(", ")} |
| Exclude keywords | ${batch.excludeKeywords.join(", ") || "-"} |

## Platform Stats

| Platform | Target | Collected | Valid | Duplicates | Status |
|----------|--------|-----------|-------|------------|--------|
${platformStats
  .map((item) => `| ${item.platform} | ${item.target} | ${item.collected} | ${item.valid} | ${item.duplicates} | ${item.status} |`)
  .join("\n")}

## Sample Content

${samples
  .map((item, index) => {
    const author = item.authorName ?? item.authorHandle ?? "unknown";
    return `${index + 1}. [${item.platform}] ${author}: ${item.text.slice(0, 240).replace(/\s+/g, " ")}\n   ${item.url}`;
  })
  .join("\n\n") || "No sample content available."}
`;
}
