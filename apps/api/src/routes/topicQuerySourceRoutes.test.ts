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

describe("topic, query, and source routes", () => {
  it("creates a topic and lists it", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/topics",
      payload: {
        name: "AI Search Trends",
        description: "Track questions",
        language: "en",
        market: "US"
      }
    });
    const listed = await app.inject({ method: "GET", url: "/api/topics" });

    expect(created.statusCode).toBe(201);
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(listed.json()).toMatchObject({
      items: [{ name: "AI Search Trends", status: "active" }]
    });

    await app.close();
  });

  it("creates a query under a topic", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });
    const topicResponse = await app.inject({
      method: "POST",
      url: "/api/topics",
      payload: { name: "Creator Economy", language: "en", market: "US" }
    });
    const topicId = topicResponse.json().item.id as string;

    const created = await app.inject({
      method: "POST",
      url: `/api/topics/${topicId}/queries`,
      payload: {
        name: "Creator tools",
        includeKeywords: ["creator tools"],
        excludeKeywords: ["jobs"],
        platforms: ["reddit", "web"],
        language: "en",
        frequency: "manual",
        limitPerRun: 50
      }
    });
    const listed = await app.inject({ method: "GET", url: `/api/topics/${topicId}/queries` });

    expect(created.statusCode).toBe(201);
    expect(listed.json()).toMatchObject({
      items: [{ topicId, includeKeywords: ["creator tools"], platforms: ["reddit", "web"] }]
    });

    await app.close();
  });

  it("updates and deletes a topic through POST actions", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });
    const topicResponse = await app.inject({
      method: "POST",
      url: "/api/topics",
      payload: { name: "Creator Economy", language: "en", market: "US" }
    });
    const topicId = topicResponse.json().item.id as string;
    await app.inject({
      method: "POST",
      url: `/api/topics/${topicId}/queries`,
      payload: {
        name: "Creator tools",
        includeKeywords: ["creator tools"],
        excludeKeywords: [],
        platforms: ["web"],
        language: "en",
        frequency: "manual",
        limitPerRun: 50
      }
    });

    const updated = await app.inject({
      method: "POST",
      url: `/api/topics/${topicId}/update`,
      payload: { status: "paused" }
    });
    const deleted = await app.inject({
      method: "POST",
      url: `/api/topics/${topicId}/delete`
    });
    const listed = await app.inject({ method: "GET", url: "/api/topics" });

    expect(updated.json()).toMatchObject({ item: { id: topicId, status: "paused" } });
    expect(deleted.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ items: [] });

    await app.close();
  });

  it("updates and deletes a query through POST actions", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });
    const topicResponse = await app.inject({
      method: "POST",
      url: "/api/topics",
      payload: { name: "Creator Economy", language: "en", market: "US" }
    });
    const topicId = topicResponse.json().item.id as string;
    const queryResponse = await app.inject({
      method: "POST",
      url: `/api/topics/${topicId}/queries`,
      payload: {
        name: "Creator tools",
        includeKeywords: ["creator tools"],
        excludeKeywords: [],
        platforms: ["web"],
        language: "en",
        frequency: "manual",
        limitPerRun: 50
      }
    });
    const queryId = queryResponse.json().item.id as string;

    const updated = await app.inject({
      method: "POST",
      url: `/api/queries/${queryId}/update`,
      payload: { status: "paused" }
    });
    const deleted = await app.inject({
      method: "POST",
      url: `/api/queries/${queryId}/delete`
    });
    const listed = await app.inject({ method: "GET", url: `/api/topics/${topicId}/queries` });

    expect(updated.json()).toMatchObject({ item: { id: queryId, status: "paused" } });
    expect(deleted.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ items: [] });

    await app.close();
  });

  it("lists default sources and toggles one source", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const listed = await app.inject({ method: "GET", url: "/api/sources" });
    const updated = await app.inject({
      method: "POST",
      url: "/api/sources/reddit/update",
      payload: { enabled: false }
    });

    expect(listed.json().items).toHaveLength(5);
    expect(listed.json().items[0]).toMatchObject({ platform: "reddit", defaultLimit: 100 });
    expect(updated.json()).toMatchObject({
      item: { platform: "reddit", enabled: false }
    });

    await app.close();
  });

  it("creates a custom source", async () => {
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });

    const created = await app.inject({
      method: "POST",
      url: "/api/sources",
      payload: {
        platform: "web",
        name: "Custom Web Source",
        enabled: true,
        requiresLogin: false,
        crawlerType: "cheerio",
        defaultLimit: 80
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      item: { platform: "web", name: "Custom Web Source", enabled: true, defaultLimit: 80 }
    });

    await app.close();
  });

  it("creates a failed crawl task when reddit credentials are missing", async () => {
    const previousRedditClientId = process.env.REDDIT_CLIENT_ID;
    const previousRedditClientSecret = process.env.REDDIT_CLIENT_SECRET;
    const previousRedditUserAgent = process.env.REDDIT_USER_AGENT;
    const previousRedditCollectionMode = process.env.REDDIT_COLLECTION_MODE;
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USER_AGENT;
    process.env.REDDIT_COLLECTION_MODE = "official_api";
    const app = await buildServer({ logger: false, db: createDb(databaseUrl) });
    const topicResponse = await app.inject({
      method: "POST",
      url: "/api/topics",
      payload: { name: "AI Search", language: "en", market: "US" }
    });
    const topicId = topicResponse.json().item.id as string;
    const queryResponse = await app.inject({
      method: "POST",
      url: `/api/topics/${topicId}/queries`,
      payload: {
        name: "AI search",
        includeKeywords: ["ai search"],
        excludeKeywords: [],
        platforms: ["reddit"],
        language: "en",
        frequency: "manual",
        limitPerRun: 10
      }
    });
    const queryId = queryResponse.json().item.id as string;

    const crawl = await app.inject({
      method: "POST",
      url: `/api/queries/${queryId}/crawl`,
      payload: { platform: "reddit" }
    });
    const listed = await waitForTaskStatus(app, "failed");

    expect(crawl.statusCode).toBe(202);
    expect(crawl.json()).toMatchObject({
      item: { queryId, status: "running" }
    });
    expect(listed).toMatchObject({
      items: [{ queryId, status: "failed", errorMessage: "missing_REDDIT_CLIENT_ID" }]
    });

    await app.close();
    restoreEnv("REDDIT_CLIENT_ID", previousRedditClientId);
    restoreEnv("REDDIT_CLIENT_SECRET", previousRedditClientSecret);
    restoreEnv("REDDIT_USER_AGENT", previousRedditUserAgent);
    restoreEnv("REDDIT_COLLECTION_MODE", previousRedditCollectionMode);
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function waitForTaskStatus(app: Awaited<ReturnType<typeof buildServer>>, status: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const listed = await app.inject({ method: "GET", url: "/api/crawl-tasks" });
    const payload = listed.json();
    if (payload.items?.some((item: { status: string }) => item.status === status)) {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return (await app.inject({ method: "GET", url: "/api/crawl-tasks" })).json();
}
