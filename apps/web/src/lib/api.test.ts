import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archiveAnalysisProject,
  createAnalysisBatch,
  createAnalysisProject,
  createAnalysisRun,
  deleteAnalysisBatch,
  deleteAnalysisRun,
  fetchAnalysisBatches,
  fetchAnalysisBatch,
  fetchAnalysisProject,
  fetchAnalysisProjects,
  fetchAnalysisRun,
  fetchAnalysisRuns,
  fetchReport,
  fetchReports,
  fetchRunInsights,
  fetchRunContents,
  fetchRunCrawlTasks,
  fetchAiProviderStatus,
  fetchInsightBatches,
  fetchInsightCandidates,
  fetchLatestInsightRun,
  generateBatchReport,
  generateRunReport,
  generateRunInsights,
  retryAnalysisRun,
  startAnalysisBatch,
  startAnalysisRun,
  buildQueryString
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collection plan api helpers", () => {
  it("keeps empty query strings empty", () => {
    expect(buildQueryString({})).toBe("");
  });
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
  it("creates a multi-platform analysis batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ item: { id: "batch_1", status: "draft", runs: [] } })
      })
    );

    const batch = await createAnalysisBatch({
      goal: "tattoo design demand",
      includeKeywords: ["tattoo design"],
      language: "en",
      market: "US",
      platformLimits: [
        { platform: "x", limit: 200 },
        { platform: "reddit", limit: 200 }
      ]
    });

    expect(batch).toMatchObject({ id: "batch_1", status: "draft" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/analysis-batches",
      expect.objectContaining({ method: "POST" })
    );
    expect(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).toContain("\"limit\":200");
  });

  it("starts and deletes an analysis batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 202,
          json: async () => ({ item: { id: "batch_1", status: "collecting" } })
        })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
    );

    const batch = await startAnalysisBatch("batch_1");
    await expect(deleteAnalysisBatch("batch_1")).resolves.toBeUndefined();

    expect(batch.status).toBe("collecting");
    expect(vi.mocked(fetch)).toHaveBeenNthCalledWith(
      1,
      "/api/analysis-batches/batch_1/start",
      expect.objectContaining({ method: "POST" })
    );
    expect(vi.mocked(fetch)).toHaveBeenNthCalledWith(
      2,
      "/api/analysis-batches/batch_1/delete",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("generates a batch report", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ item: { id: "report_1", status: "ready", contentMarkdown: "# Batch" } })
      })
    );

    const report = await generateBatchReport("batch_1");

    expect(report).toMatchObject({ id: "report_1", status: "ready" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/analysis-batches/batch_1/report",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("fetches batch list and detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [{ id: "batch_1" }],
            page: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ item: { id: "batch_1", runs: [{ id: "run_1", platform: "reddit" }] } })
        })
    );

    const list = await fetchAnalysisBatches({ page: 1, pageSize: 20 });
    const detail = await fetchAnalysisBatch("batch_1");

    expect(list.items).toHaveLength(1);
    expect(detail.runs?.[0]).toMatchObject({ platform: "reddit" });
  });

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
      platform: "reddit",
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

describe("run insights API client", () => {
  it("generates and fetches run insights", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            summary: { totalInsights: 1, themes: [{ themeName: "Placement confidence" }] },
            items: [{ id: "insight_1", needType: "placement decision", confidence: 0.8 }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            summary: { totalInsights: 1, themes: [{ themeName: "Placement confidence" }] },
            items: [{ id: "insight_1", needType: "placement decision", confidence: 0.8 }]
          })
        })
    );

    const generated = await generateRunInsights("run_1");
    const fetched = await fetchRunInsights("run_1", { page: 1, pageSize: 20 });

    expect(generated.summary.totalInsights).toBe(1);
    expect(fetched.items[0]).toMatchObject({ needType: "placement decision", confidence: 0.8 });
    expect(vi.mocked(fetch)).toHaveBeenNthCalledWith(
      1,
      "/api/analysis-runs/run_1/insights",
      expect.objectContaining({ method: "POST" })
    );
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain("/api/analysis-runs/run_1/insights?page=1&pageSize=20");
  });

  it("fetches insight diagnostics, candidates, and batches", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ item: { id: "airun_1", status: "completed", selectedCandidateCount: 4 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [{ id: "aicand_1", rawContentId: "raw_1", selected: true, batchIndex: 0 }],
            page: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [{ id: "aibatch_1", batchIndex: 0, status: "completed" }] })
        })
    );

    const latest = await fetchLatestInsightRun("run_1");
    const candidates = await fetchInsightCandidates("run_1", { page: 1, pageSize: 20, selected: true });
    const batches = await fetchInsightBatches("run_1");

    expect(latest).toMatchObject({ status: "completed", selectedCandidateCount: 4 });
    expect(candidates.items[0]).toMatchObject({ selected: true, batchIndex: 0 });
    expect(batches[0]).toMatchObject({ status: "completed" });
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain("selected=true");
  });
});

describe("settings API client", () => {
  it("fetches AI provider status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          item: { configured: true, provider: "openai-compatible", model: "qwen-plus" }
        })
      })
    );

    const status = await fetchAiProviderStatus();

    expect(status).toMatchObject({ configured: true, provider: "openai-compatible", model: "qwen-plus" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/settings/ai/status", expect.any(Object));
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
