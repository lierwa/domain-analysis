import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupDatabaseTempDir,
  createAnalysisProjectRepository,
  createAnalysisRunRepository,
  createDb,
  initializeDatabase
} from "@domain-analysis/db";
import {
  deriveBatchStatus,
  determineCollectionCompletion,
  determineCollectionFailureCompletion,
  determineTaskTargetCount
} from "./analysisRunService";
import { createAnalysisRunService } from "./analysisRunService";

describe("analysis run collection policy", () => {
  it("keeps the user requested limit as the task target", () => {
    expect(determineTaskTargetCount({ runLimit: 200, sourceDefaultLimit: 100 })).toBe(200);
  });

  it("marks duplicate-only collection as no content instead of success", () => {
    const completion = determineCollectionCompletion({
      collectedCount: 12,
      validCount: 0,
      duplicateCount: 12
    });

    expect(completion.taskStatus).toBe("no_content");
    expect(completion.runStatus).toBe("no_content");
    expect(completion.errorMessage).toContain("duplicate");
  });

  it("keeps login-required collection resumable instead of failed", () => {
    const completion = determineCollectionFailureCompletion({
      taskStatus: "login_required",
      message: "X login is required"
    });

    expect(completion.taskStatus).toBe("login_required");
    expect(completion.runStatus).toBe("login_required");
    expect(completion.finishedAt).toBeNull();
    expect(completion.errorMessage).toContain("Complete login");
  });

  it("aggregates all login-required child runs as login required", () => {
    expect(deriveBatchStatus([{ status: "login_required", validCount: 0 }])).toBe("login_required");
  });

  it("keeps a batch partial ready when some content exists and another run needs login", () => {
    expect(deriveBatchStatus([
      { status: "content_ready", validCount: 3 },
      { status: "login_required", validCount: 0 }
    ])).toBe("partial_ready");
  });

  it("allows regenerating a report for report-ready runs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-run-service-"));
    const databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
    await initializeDatabase(databaseUrl);
    const db = createDb(databaseUrl);

    try {
      const projects = createAnalysisProjectRepository(db);
      const runs = createAnalysisRunRepository(db);
      const service = createAnalysisRunService(db);
      const project = await projects.create({
        name: "Tattoo Study",
        goal: "Read report",
        language: "en",
        market: "US"
      });
      const run = await runs.create({
        projectId: project.id,
        name: "tattoo design – May 13",
        goal: "Read report",
        includeKeywords: ["tattoo design"],
        excludeKeywords: [],
        language: "en",
        market: "US",
        limit: 200
      });
      await runs.update(run.id, { status: "report_ready", reportId: "report_old" });

      const report = await service.generateReport(run.id);

      expect(report.contentMarkdown).toContain("中文分析报告");
      expect(report.title).toContain("中文分析报告");
      expect(report.analysisRunId).toBe(run.id);
    } finally {
      await cleanupDatabaseTempDir(tempDir);
    }
  });
});
