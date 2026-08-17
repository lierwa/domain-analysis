import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
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
  startAnalysisRun,
  buildQueryString,
  cancelRegulatoryReconciliation,
  confirmMarketUniverse,
  confirmProductProject,
  fetchProductProject,
  fetchProductProjects,
  fetchProjectEvidence,
  fetchSourceCollectionRun,
  fetchSourceCollectionRuns,
  fetchMarketUniverse,
  fetchLatestRegulatoryReconciliation,
  fetchRegulatoryReconciliation,
  refreshMarketUniverse,
  saveProductProjectDraft,
  startRegulatoryReconciliation,
  streamCategoryInterviewTurn,
  sourceRunExportUrl,
} from "./api";
import { marketUniverse, regulatoryRun, sourceRun } from "../../tests/apiTestFixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collection plan api helpers", () => {
  it("keeps empty query strings empty", () => {
    expect(buildQueryString({})).toBe("");
  });
});

describe("product project API client", () => {
  it("lists and reads product projects", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: "project-1" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ item: { project: { id: "project-1" } } }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProductProjects()).resolves.toEqual([{ id: "project-1" }]);
    await expect(fetchProductProject("project-1")).resolves.toMatchObject({ project: { id: "project-1" } });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/product-projects", expect.objectContaining({ cache: "no-store" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/product-projects/project-1", expect.any(Object));
  });

  it("saves a draft and confirms it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ item: { project: { id: "project-1" } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ item: { project: { id: "project-1", status: "ready" } } }) });
    vi.stubGlobal("fetch", fetchMock);

    await saveProductProjectDraft({ name: "test" } as never);
    await confirmProductProject("project-1", 2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/product-projects/draft", expect.objectContaining({ method: "PUT" }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/product-projects/project-1/confirm",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedRevision: 2 }) })
    );
  });

  it("keeps the server error code for conflict recovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "revision_conflict", message: "项目已被更新" })
    }));

    const error = await fetchProductProject("project-1").catch((cause) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "revision_conflict", message: "项目已被更新" });
  });

  it("reads the typed raw evidence projection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    }));
    await expect(fetchProjectEvidence("project-1")).resolves.toEqual([]);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/product-projects/project-1/evidence",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reads typed source runs and builds a same-project export URL", async () => {
    const run = sourceRun();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [run] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ item: { run, records: [] } }) }));

    await expect(fetchSourceCollectionRuns("project-1"))
      .resolves.toEqual([expect.objectContaining({ categoryCode: "television" })]);
    await expect(fetchSourceCollectionRun("project-1", "run-1"))
      .resolves.toMatchObject({ run: { id: "run-1" }, records: [] });
    expect(sourceRunExportUrl("project-1", "run-1", "csv"))
      .toBe("/api/product-projects/project-1/source-runs/run-1/export?format=csv");
  });

  it("reads, refreshes and confirms the typed market universe", async () => {
    const item = marketUniverse();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ item }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ item }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ item: { ...item, status: "confirmed", confirmedAt: "2026-08-16T12:05:00.000Z" } }) }));
    await expect(fetchMarketUniverse("project-1")).resolves.toMatchObject({ models: [{ manufacturerModel: "BCD-500" }] });
    await expect(refreshMarketUniverse("project-1")).resolves.toMatchObject({ status: "candidate" });
    await expect(confirmMarketUniverse("project-1", 1, "a".repeat(64))).resolves.toMatchObject({ status: "confirmed" });
    expect(vi.mocked(fetch)).toHaveBeenNthCalledWith(
      2,
      "/api/product-projects/project-1/market-universe/refresh",
      expect.objectContaining({ method: "POST" }),
    );
    expect(vi.mocked(fetch)).toHaveBeenNthCalledWith(
      3,
      "/api/product-projects/project-1/market-universe/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, expectedContentHash: "a".repeat(64) }),
      }),
    );
  });

  it("starts, restores, reads and cancels a typed regulatory reconciliation", async () => {
    const item = regulatoryRun();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ item }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ item }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ item }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ item: { ...item, lifecycleStatus: "cancelled" } }) }));

    await expect(startRegulatoryReconciliation("project-1")).resolves.toMatchObject({ totalModels: 1 });
    await expect(fetchLatestRegulatoryReconciliation("project-1")).resolves.toMatchObject({ id: "run-1" });
    await expect(fetchRegulatoryReconciliation("project-1", "run-1")).resolves.toMatchObject({ id: "run-1" });
    await expect(cancelRegulatoryReconciliation("project-1", "run-1")).resolves.toMatchObject({ lifecycleStatus: "cancelled" });
    expect(vi.mocked(fetch)).toHaveBeenNthCalledWith(
      4,
      "/api/product-projects/project-1/market-universe/regulatory-reconciliations/run-1/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("category interview API client", () => {
  it("parses a POST SSE stream into validated timeline events", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: turn.started\ndata: {\"type\":\"turn.started\",\"sessionId\":\"session-1\",\"turnId\":\"turn-1\"}\n\n"));
        controller.enqueue(encoder.encode("event: assistant.delta\ndata: {\"type\":\"assistant.delta\",\"sessionId\":\"session-1\",\"turnId\":\"turn-1\",\"delta\":\"冰箱\"}\n\n"));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body,
      headers: new Headers({ "content-type": "text/event-stream" }),
    }));
    const events: string[] = [];

    await streamCategoryInterviewTurn(
      "session-1",
      { trigger: "user_message", expectedRevision: 1, text: "开启冰箱品类" },
      (event) => events.push(event.type),
    );

    expect(events).toEqual(["turn.started", "assistant.delta"]);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/category-interviews/session-1/turns",
      expect.objectContaining({ method: "POST" }),
    );
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
