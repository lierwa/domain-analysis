import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeDb,
  createDb,
  createQueryRepository,
  createRawContentRepository,
  createSourceRepository,
  createTopicRepository,
  initializeDatabase,
  type AppDb
} from "@domain-analysis/db";
import { buildServer } from "../server";

let tempDir: string;
let databaseUrl: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-api-"));
  databaseUrl = `file:${join(tempDir, "test.sqlite")}`;
  await initializeDatabase(databaseUrl);
});

afterEach(async () => {
  await safeRemoveTempDir(tempDir);
}, 30_000);

async function stopApiTestServer(app: Awaited<ReturnType<typeof buildServer>>, db: AppDb) {
  await app.close();
  closeDb(db);
}

async function safeRemoveTempDir(dir: string) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : undefined;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

describe("topic, query, and source routes", () => {
  it("creates a topic and lists it", async () => {
    const db = createDb(databaseUrl);
    const app = await buildServer({ logger: false, db });
    try {
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
    } finally {
      await stopApiTestServer(app, db);
    }
  });

  it("creates a query under a topic", async () => {
    const db = createDb(databaseUrl);
    const app = await buildServer({ logger: false, db });
    try {
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
    } finally {
      await stopApiTestServer(app, db);
    }
  });

  it("updates and deletes a topic through POST actions", async () => {
    const db = createDb(databaseUrl);
    const app = await buildServer({ logger: false, db });
    try {
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
    } finally {
      await stopApiTestServer(app, db);
    }
  });

  it("updates and deletes a query through POST actions", async () => {
    const db = createDb(databaseUrl);
    const app = await buildServer({ logger: false, db });
    try {
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
    } finally {
      await stopApiTestServer(app, db);
    }
  });

  it("lists default sources and toggles one source", async () => {
    const db = createDb(databaseUrl);
    const app = await buildServer({ logger: false, db });
    try {
      const listed = await app.inject({ method: "GET", url: "/api/sources" });
      const updated = await app.inject({
        method: "POST",
        url: "/api/sources/reddit/update",
        payload: { enabled: false }
      });

      expect(listed.json().items).toHaveLength(5);
      expect(listed.json().items[0]).toMatchObject({
        platform: "reddit",
        defaultLimit: 100,
        crawlerType: "playwright"
      });
      expect(updated.json()).toMatchObject({
        item: { platform: "reddit", enabled: false }
      });
    } finally {
      await stopApiTestServer(app, db);
    }
  });

  it("creates a custom source", async () => {
    const db = createDb(databaseUrl);
    const app = await buildServer({ logger: false, db });
    try {
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
    } finally {
      await stopApiTestServer(app, db);
    }
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
    const db = createDb(databaseUrl);
    const app = await buildServer({ logger: false, db });
    try {
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
    } finally {
      await stopApiTestServer(app, db);
      restoreEnv("REDDIT_CLIENT_ID", previousRedditClientId);
      restoreEnv("REDDIT_CLIENT_SECRET", previousRedditClientSecret);
      restoreEnv("REDDIT_USER_AGENT", previousRedditUserAgent);
      restoreEnv("REDDIT_COLLECTION_MODE", previousRedditCollectionMode);
    }
  });

  it("returns 404 when listing raw contents for a missing topic", async () => {
    const db = createDb(databaseUrl);
    const app = await buildServer({ logger: false, db });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/topics/topic_00000000-0000-4000-8000-000000000001/raw-contents"
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: "topic_not_found" });
    } finally {
      await stopApiTestServer(app, db);
    }
  });

  it("lists raw contents for a single topic in recency order (published_at, else captured_at)", async () => {
    const db = createDb(databaseUrl);
    const topics = createTopicRepository(db);
    const queries = createQueryRepository(db);
    const sources = createSourceRepository(db);
    const rawContents = createRawContentRepository(db);

    const topicA = await topics.create({ name: "Perfume", language: "en", market: "US" });
    const topicB = await topics.create({ name: "Other", language: "en", market: "US" });
    const queryA = await queries.create({
      topicId: topicA.id,
      name: "q-a",
      includeKeywords: ["perfume"],
      excludeKeywords: [],
      platforms: ["reddit"],
      language: "en",
      frequency: "manual",
      limitPerRun: 50
    });
    const queryB = await queries.create({
      topicId: topicB.id,
      name: "q-b",
      includeKeywords: ["other"],
      excludeKeywords: [],
      platforms: ["reddit"],
      language: "en",
      frequency: "manual",
      limitPerRun: 50
    });
    await sources.seedDefaults();
    const reddit = await sources.getByPlatform("reddit");
    if (!reddit) throw new Error("expected reddit source");

    await rawContents.createMany([
      {
        platform: "reddit",
        topicId: topicA.id,
        queryId: queryA.id,
        sourceId: reddit.id,
        externalId: "t3_old",
        url: "https://reddit.com/r/x/comments/old",
        text: "older",
        publishedAt: "2020-01-01T00:00:00.000Z"
      },
      {
        platform: "reddit",
        topicId: topicA.id,
        queryId: queryA.id,
        sourceId: reddit.id,
        externalId: "t3_new",
        url: "https://reddit.com/r/x/comments/new",
        text: "newer",
        publishedAt: "2025-01-01T00:00:00.000Z"
      },
      {
        platform: "reddit",
        topicId: topicB.id,
        queryId: queryB.id,
        sourceId: reddit.id,
        externalId: "t3_b",
        url: "https://reddit.com/r/y/comments/b",
        text: "other-topic",
        publishedAt: "2026-01-01T00:00:00.000Z"
      }
    ]);

    const app = await buildServer({ logger: false, db });
    try {
      const forA = await app.inject({ method: "GET", url: `/api/topics/${topicA.id}/raw-contents` });
      const forB = await app.inject({ method: "GET", url: `/api/topics/${topicB.id}/raw-contents` });

      expect(forA.statusCode).toBe(200);
      expect(forB.statusCode).toBe(200);
      expect(forA.headers["cache-control"]).toBe("no-store");

      const itemsA = forA.json().items as { text: string; topicId: string }[];
      const itemsB = forB.json().items as { text: string; topicId: string }[];

      expect(itemsA.map((row) => row.text)).toEqual(["newer", "older"]);
      expect(itemsA.every((row) => row.topicId === topicA.id)).toBe(true);
      expect(itemsB.map((row) => row.text)).toEqual(["other-topic"]);
    } finally {
      await stopApiTestServer(app, db);
    }
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
