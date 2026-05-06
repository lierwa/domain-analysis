import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createQuery,
  createSource,
  createTopic,
  deleteQuery,
  deleteTopic,
  fetchCrawlTasks,
  fetchQueries,
  fetchRawContents,
  fetchSources,
  fetchTopics,
  runCrawl,
  updateQuery,
  updateTopic,
  updateSource
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web api client", () => {
  it("creates a topic through the API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ item: { id: "topic_1", name: "AI Search Trends" } })
    });
    vi.stubGlobal("fetch", fetchMock);

    const topic = await createTopic({
      name: "AI Search Trends",
      language: "en",
      market: "US"
    });

    expect(topic).toMatchObject({ id: "topic_1", name: "AI Search Trends" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/topics",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("loads topic queries from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [{ id: "query_1", includeKeywords: ["ai search"] }] })
      })
    );

    await expect(fetchQueries("topic_1")).resolves.toEqual([
      { id: "query_1", includeKeywords: ["ai search"] }
    ]);
  });

  it("toggles a source through the API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ item: { platform: "reddit", enabled: false } })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateSource("reddit", false)).resolves.toMatchObject({
      platform: "reddit",
      enabled: false
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sources/reddit/update",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("creates or updates a source through the API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ item: { platform: "web", name: "Web Search", enabled: true } })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createSource({
        platform: "web",
        name: "Web Search",
        enabled: true,
        requiresLogin: false,
        crawlerType: "cheerio",
        defaultLimit: 100
      })
    ).resolves.toMatchObject({ platform: "web", name: "Web Search" });
  });

  it("loads topics and sources from the API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: "topic_1", name: "AI Search Trends" }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ platform: "web", enabled: true }] })
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchTopics()).resolves.toEqual([{ id: "topic_1", name: "AI Search Trends" }]);
    await expect(fetchSources()).resolves.toEqual([{ platform: "web", enabled: true }]);
  });

  it("creates a query through the topic-scoped API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ item: { id: "query_1", topicId: "topic_1" } })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createQuery("topic_1", {
        name: "AI search",
        includeKeywords: ["ai search"],
        excludeKeywords: [],
        platforms: ["reddit"],
        language: "en",
        frequency: "manual",
        limitPerRun: 50
      })
    ).resolves.toMatchObject({ id: "query_1", topicId: "topic_1" });
  });

  it("updates and deletes topics", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ item: { id: "topic_1", status: "paused" } })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateTopic("topic_1", { status: "paused" })).resolves.toMatchObject({
      status: "paused"
    });
    await expect(deleteTopic("topic_1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/topics/topic_1/update",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/topics/topic_1/delete",
      expect.objectContaining({
        method: "POST",
        headers: {}
      })
    );
  });

  it("updates and deletes queries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ item: { id: "query_1", status: "paused" } })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateQuery("query_1", { status: "paused" })).resolves.toMatchObject({
      status: "paused"
    });
    await expect(deleteQuery("query_1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/queries/query_1/update",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/queries/query_1/delete",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("marks GET requests as no-store to avoid proxy cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] })
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchTopics();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/topics",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("runs crawl jobs and loads persisted crawl data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ item: { id: "task_1", status: "failed" } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: "task_1", status: "failed" }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: "raw_1", platform: "reddit" }] })
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(runCrawl("query_1", "reddit")).resolves.toMatchObject({ id: "task_1" });
    await expect(fetchCrawlTasks()).resolves.toEqual([{ id: "task_1", status: "failed" }]);
    await expect(fetchRawContents()).resolves.toEqual([{ id: "raw_1", platform: "reddit" }]);
  });
});
