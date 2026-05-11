import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupDatabaseTempDir, createDb, initializeDatabase } from "@domain-analysis/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAnalysisRunService } from "./analysisRunService";
import { createCollectionPlanService } from "./collectionPlanService";

let tempDir: string;
let databaseUrl: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-api-"));
  databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
  await initializeDatabase(databaseUrl);
});

afterEach(async () => {
  await cleanupDatabaseTempDir(tempDir);
});

describe("collection plan scheduled runs", () => {
  it("creates a scheduled analysis run from a due plan", async () => {
    const db = createDb(databaseUrl);
    const runService = createAnalysisRunService(db);
    const planService = createCollectionPlanService(db);

    const run = await runService.createRun({
      projectName: "AI search",
      platform: "reddit",
      goal: "Track AI search product pain points",
      includeKeywords: ["AI search"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      limit: 100
    });

    const plan = await planService.createPlan({
      projectId: run.projectId,
      name: "Daily Reddit monitor",
      platform: "reddit",
      includeKeywords: ["AI search"],
      excludeKeywords: [],
      language: "en",
      market: "US",
      cadence: "daily",
      batchLimit: 100,
      maxRunsPerDay: 4
    });

    const scheduled = await planService.createScheduledRun(plan.id);

    expect(scheduled.collectionPlanId).toBe(plan.id);
    expect(scheduled.runTrigger).toBe("scheduled");
    expect(scheduled.includeKeywords).toEqual(["AI search"]);
  });
});
