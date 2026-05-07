import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archiveAnalysisProject,
  createAnalysisProject,
  createAnalysisRun,
  deleteAnalysisRun,
  fetchAnalysisProject,
  fetchAnalysisProjects,
  fetchAnalysisRun,
  fetchAnalysisRuns,
  fetchReport,
  fetchReports,
  fetchRunContents,
  fetchRunCrawlTasks,
  generateRunReport,
  retryAnalysisRun,
  startAnalysisRun
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analysis project API client", () => {
  it("creates an analysis project", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ item: { id: "proj_1", name: "AI Search", goal: "understand UX" } })
      })
    );

    const project = await createAnalysisProject({
      name: "AI Search",
      goal: "understand UX",
      language: "en",
      market: "US"
    });

    expect(project).toMatchObject({ id: "proj_1", name: "AI Search" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/analysis-projects",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("fetches analysis projects with pagination", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{ id: "proj_1" }],
          page: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }
        })
      })
    );

    const result = await fetchAnalysisProjects({ page: 1, pageSize: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.page.total).toBe(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/analysis-projects?page=1&pageSize=20",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("fetches a single project by id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ item: { id: "proj_1", goal: "test goal" } })
      })
    );

    const project = await fetchAnalysisProject("proj_1");
    expect(project).toMatchObject({ id: "proj_1" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/analysis-projects/proj_1",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("archives a project", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ item: { id: "proj_1", status: "archived" } })
      })
    );

    const project = await archiveAnalysisProject("proj_1");
    expect(project.status).toBe("archived");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/analysis-projects/proj_1/archive",
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("analysis run API client", () => {
  it("creates an analysis run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ item: { id: "run_1", status: "draft" } })
      })
    );

    const run = await createAnalysisRun({
      goal: "understand AI search UX",
      includeKeywords: ["AI search"],
      language: "en",
      market: "US"
    });

    expect(run).toMatchObject({ id: "run_1", status: "draft" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/analysis-runs",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("starts an analysis run and returns 202", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({ item: { id: "run_1", status: "collecting" } })
      })
    );

    const run = await startAnalysisRun("run_1");
    expect(run.status).toBe("collecting");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/analysis-runs/run_1/start",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("retries a failed run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ item: { id: "run_1", status: "collecting" } })
      })
    );

    const run = await retryAnalysisRun("run_1");
    expect(run.status).toBe("collecting");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/analysis-runs/run_1/retry",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("fetches run list with filters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{ id: "run_1" }],
          page: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }
        })
      })
    );

    const result = await fetchAnalysisRuns({ page: 1, pageSize: 20, status: "content_ready" });
    expect(result.items).toHaveLength(1);
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(url).toContain("status=content_ready");
  });

  it("fetches a single run by id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ item: { id: "run_1", status: "content_ready" } })
      })
    );

    const run = await fetchAnalysisRun("run_1");
    expect(run.id).toBe("run_1");
  });

  it("deletes a run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    );

    await expect(deleteAnalysisRun("run_1")).resolves.toBeUndefined();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/analysis-runs/run_1/delete",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("GET requests use no-store cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [],
          page: { page: 1, pageSize: 20, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false }
        })
      })
    );

    await fetchAnalysisRuns({ page: 1, pageSize: 20 });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cache: "no-store" })
    );
  });
});

describe("run contents API client", () => {
  it("fetches run contents scoped to a run id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{ id: "raw_1", analysisRunId: "run_1", text: "hello world" }],
          page: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }
        })
      })
    );

    const result = await fetchRunContents("run_1", { page: 1, pageSize: 20 });
    expect(result.items[0]).toMatchObject({ analysisRunId: "run_1" });
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(url).toContain("/api/analysis-runs/run_1/contents");
    expect(url).toContain("page=1");
  });

  it("passes search filter to content query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [], page: { page: 1, pageSize: 20, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false } })
      })
    );

    await fetchRunContents("run_1", { page: 1, pageSize: 20, search: "AI search" });
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(url).toContain("search=AI+search");
  });

  it("fetches run crawl tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [{ id: "task_1", status: "success" }] })
      })
    );

    const tasks = await fetchRunCrawlTasks("run_1");
    expect(tasks[0]).toMatchObject({ id: "task_1" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/analysis-runs/run_1/crawl-tasks",
      expect.any(Object)
    );
  });
});

describe("reports API client", () => {
  it("generates a report for a run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ item: { id: "report_1", status: "ready", contentMarkdown: "# Report" } })
      })
    );

    const report = await generateRunReport("run_1");
    expect(report).toMatchObject({ id: "report_1", status: "ready" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/analysis-runs/run_1/report",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("fetches reports with pagination", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{ id: "report_1", title: "My Report" }],
          page: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }
        })
      })
    );

    const result = await fetchReports({ page: 1, pageSize: 20 });
    expect(result.items).toHaveLength(1);
  });

  it("fetches a single report by id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ item: { id: "report_1", contentMarkdown: "# Title\n\ncontent" } })
      })
    );

    const report = await fetchReport("report_1");
    expect(report.id).toBe("report_1");
  });
});
