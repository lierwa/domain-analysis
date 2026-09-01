import {
  sourceCaptureSubjects,
  sourceCaptureWorkItems,
  sourceCollectionBatches,
  sourceCollectionPlans,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceRequestAttempts,
  sourceSnapshots,
  type WorkbenchDb,
} from "@domain-analysis/db";
import { crawlPlanContentSchema } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import { createSourceCoverageModule } from "../src/sourceCoverageModule";

const at = "2026-09-01T00:00:00.000Z";

describe("Source Coverage 执行边界", () => {
  it("只排除已经进入执行的 URL，并把终态与恢复中 Batch 分开", async () => {
    const executedUrl = "https://technical.example.org/executed";
    const draftUrl = "https://technical.example.org/draft";
    const plans = [
      plan("plan-confirmed", 1, "confirmed", "public.executed", executedUrl),
      plan("plan-draft", 2, "draft", "public.draft", draftUrl),
    ];
    const batches = [{ id: "batch-stopped", taskId: "task-1", status: "stopped",
      recoveryState: "none", plannedSourceCount: 2, startedAt: at, finishedAt: at }];
    const runs = [{ id: "run-executed", taskId: "task-1", executionBatchId: "batch-stopped",
      sourceCollectionPlanId: "plan-confirmed", sourceCollectionPlanVersion: 1,
      sourceCollectionPlanSourceKey: "public.executed", providerKey: "public.web-resource",
      status: "failed", startedAt: at, finishedAt: at }];
    const rows = new Map<unknown, unknown[]>([
      [sourceCollectionPlans, plans],
      [sourceCollectionBatches, batches],
      [sourceCollectionRuns, runs],
      [sourceSnapshots, []],
      [sourceCaptureSubjects, []],
      [sourceCaptureWorkItems, []],
      [sourceCollectionTargetRuns, []],
      [sourceRequestAttempts, []],
    ]);
    const coverage = createSourceCoverageModule(fakeDb(rows), () => new Date(at));

    const stopped = await coverage.assessTask("task-1");
    expect(stopped.status).toBe("gaps");
    expect(stopped.attemptedUrls).toEqual([executedUrl]);
    expect(stopped.unfinishedExecutionIds).not.toContain("batch-stopped");

    batches[0]!.recoveryState = "pending";
    const recovering = await coverage.assessTask("task-1");
    expect(recovering.status).toBe("in_progress");
    expect(recovering.unfinishedExecutionIds).toContain("batch-stopped");
  });
});

function plan(id: string, version: number, status: "draft" | "confirmed",
  sourceKey: string, url: string) {
  return { id, taskId: "task-1", taskRevision: 1, version, status,
    contentHash: String(version).repeat(64), content: crawlPlanContentSchema.parse({
      taskId: "task-1", taskRevision: 1, summary: "覆盖测试计划", excludedContent: [],
      planningBlockers: [], sources: [{ key: sourceKey, name: sourceKey,
        publisher: "Fixture", sourceKind: "technical_publisher", sourceCandidateIds: [],
        role: "验证公开来源执行边界", entryUrls: [url],
        provider: { key: "public.web-resource", version: "2.0.0", configuration: [] },
        accessPolicy: { kind: "paced_http", version: "fixture", maxRequestsPerMinute: 1,
          minimumIntervalMs: 1, maximumRunMs: 1_000 },
        stopPolicy: { requestBudget: 1, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
        rawOutputPolicy: { formats: ["html"], retainAssets: false },
        observationLevel: "search_discovered", accessState: "public", observedAt: at,
        targets: [{ key: `${sourceKey}.resource`, name: sourceKey, taskTopics: ["专业技术"],
          captureUnit: "公开网页", rawFormats: ["HTML"],
          quantity: { mode: "target_count", targetCount: 1, unit: "入口", denominator: "1",
            rationale: "验证来源执行边界" }, uniqueKey: "URL", traversal: "exact URL",
          stopCondition: "一次完成", providerConfiguration: [] }], executionBlockers: [] }] }),
    createdAt: at, ...(status === "confirmed" ? { confirmedAt: at } : {}) };
}

function fakeDb(rows: Map<unknown, unknown[]>) {
  return ({
    select: () => ({ from: (table: unknown) => query(rows.get(table) ?? []) }),
  }) as unknown as WorkbenchDb;
}

function query(rows: unknown[]) {
  const result = Promise.resolve(rows);
  const builder = {
    innerJoin: () => builder,
    where: () => builder,
    orderBy: () => result,
    then: result.then.bind(result),
  };
  return builder;
}
