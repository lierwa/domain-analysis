import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, initializeDatabase } from "@domain-analysis/db";
import { buildServer } from "../server";

let tempDir: string;
let databaseUrl: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-api-"));
  databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
  await initializeDatabase(databaseUrl);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("analysis project routes", () => {
  it("creates, fetches, and lists projects", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-projects",
      payload: {
        name: "AI Search Study",
        goal: "Understand user pain points",
        language: "en",
        market: "US"
      }
    });

    expect(created.statusCode).toBe(201);
    const project = created.json().item;
    expect(project).toMatchObject({ name: "AI Search Study", status: "active" });

    const fetched = await app.inject({
      method: "GET",
      url: `/api/analysis-projects/${project.id}`
    });
    const listed = await app.inject({
      method: "GET",
      url: "/api/analysis-projects?page=1&pageSize=20"
    });

    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().item.id).toBe(project.id);
    expect(listed.json()).toMatchObject({ items: [{ id: project.id }] });

    await app.close();
  });

  it("returns 404 for missing project", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const response = await app.inject({
      method: "GET",
      url: "/api/analysis-projects/proj_missing"
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("analysis run routes", () => {
  it("creates a run with auto project creation", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: {
        goal: "Understand AI search frustrations",
        includeKeywords: ["ChatGPT", "Perplexity"],
        excludeKeywords: [],
        language: "en",
        market: "US",
        limit: 50
      }
    });

    expect(created.statusCode).toBe(201);
    const run = created.json().item;
    expect(run.status).toBe("draft");
    expect(run.includeKeywords).toEqual(["ChatGPT", "Perplexity"]);
    expect(run.projectId).toBeTruthy();

    await app.close();
  });

  it("returns run by id and lists runs", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: {
        goal: "Test run",
        includeKeywords: ["test"],
        language: "en",
        market: "US",
        limit: 10
      }
    });
    const runId: string = created.json().item.id;

    const fetched = await app.inject({ method: "GET", url: `/api/analysis-runs/${runId}` });
    const listed = await app.inject({ method: "GET", url: "/api/analysis-runs?page=1&pageSize=20" });

    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().item.id).toBe(runId);
    expect(listed.json()).toMatchObject({ items: [{ id: runId }] });

    await app.close();
  });

  it("validates create run body", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const response = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: { goal: "no keywords" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("validation_error");

    await app.close();
  });

  it("lists run crawl tasks and contents for a new run", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: {
        goal: "Empty run",
        includeKeywords: ["test"],
        language: "en",
        market: "US",
        limit: 10
      }
    });
    const runId: string = created.json().item.id;

    const tasks = await app.inject({ method: "GET", url: `/api/analysis-runs/${runId}/crawl-tasks` });
    const contents = await app.inject({
      method: "GET",
      url: `/api/analysis-runs/${runId}/contents?page=1&pageSize=20`
    });

    expect(tasks.statusCode).toBe(200);
    expect(tasks.json().items).toEqual([]);
    expect(contents.statusCode).toBe(200);
    expect(contents.json().items).toEqual([]);

    await app.close();
  });

  it("deletes a run", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/analysis-runs",
      payload: {
        goal: "Delete test",
        includeKeywords: ["test"],
        language: "en",
        market: "US",
        limit: 10
      }
    });
    const runId: string = created.json().item.id;

    const deleted = await app.inject({ method: "POST", url: `/api/analysis-runs/${runId}/delete` });
    const fetched = await app.inject({ method: "GET", url: `/api/analysis-runs/${runId}` });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().ok).toBe(true);
    expect(fetched.statusCode).toBe(404);

    await app.close();
  });
});

describe("reports routes", () => {
  it("lists reports and returns 404 for missing report", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const listed = await app.inject({ method: "GET", url: "/api/reports?page=1&pageSize=20" });
    const missing = await app.inject({ method: "GET", url: "/api/reports/report_missing" });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([]);
    expect(missing.statusCode).toBe(404);

    await app.close();
  });
});
