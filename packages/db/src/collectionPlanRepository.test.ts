import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAnalysisProjectRepository,
  createCollectionPlanRepository,
  createDb,
  initializeDatabase
} from "./index";

let tempDir: string;
let databaseUrl: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-db-"));
  databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
  await initializeDatabase(databaseUrl);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("collection plan repository", () => {
  it("creates and lists due active plans", async () => {
    const db = createDb(databaseUrl);
    const projectRepo = createAnalysisProjectRepository(db);
    const planRepo = createCollectionPlanRepository(db);

    const project = await projectRepo.create({
      name: "AI search",
      goal: "Track user pain points around AI search tools",
      language: "en",
      market: "US",
      defaultLimit: 100
    });

    const plan = await planRepo.create({
      projectId: project.id,
      name: "Daily Reddit monitor",
      platform: "reddit",
      includeKeywords: ["AI search"],
      excludeKeywords: ["jobs"],
      language: "en",
      market: "US",
      cadence: "daily",
      batchLimit: 120,
      maxRunsPerDay: 4
    });

    expect(plan.status).toBe("active");
    expect(plan.nextRunAt).toBeTruthy();

    const due = await planRepo.listDue(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), 10);
    expect(due.map((item) => item.id)).toContain(plan.id);
  });
});
