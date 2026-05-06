import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, initializeDatabase } from "./client";
import {
  createCrawlTaskRepository,
  createQueryRepository,
  createRawContentRepository,
  createSourceRepository,
  createTopicRepository
} from "./repositories";

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

describe("topic repository", () => {
  it("initializes SQLite when the parent directory does not exist", async () => {
    const nestedUrl = `file:${join(tempDir, "nested", "runtime.sqlite")}`;

    await expect(initializeDatabase(nestedUrl)).resolves.toBeUndefined();
  });

  it("creates, lists, and updates topics", async () => {
    const db = createDb(databaseUrl);
    const topics = createTopicRepository(db);

    const created = await topics.create({
      name: "AI Search Trends",
      description: "Track user questions",
      language: "en",
      market: "US"
    });
    const updated = await topics.update(created.id, { status: "paused" });

    expect(updated?.status).toBe("paused");
    expect(await topics.list()).toMatchObject([
      {
        id: created.id,
        name: "AI Search Trends",
        status: "paused"
      }
    ]);
  });
});

describe("query repository", () => {
  it("creates and lists queries under a topic", async () => {
    const db = createDb(databaseUrl);
    const topics = createTopicRepository(db);
    const queries = createQueryRepository(db);
    const topic = await topics.create({
      name: "Creator Economy",
      language: "en",
      market: "US"
    });

    const created = await queries.create({
      topicId: topic.id,
      name: "Creator tools",
      includeKeywords: ["creator tools", "ugc platform"],
      excludeKeywords: ["jobs"],
      platforms: ["reddit", "web"],
      language: "en",
      frequency: "manual",
      limitPerRun: 50
    });

    expect(await queries.listByTopic(topic.id)).toMatchObject([
      {
        id: created.id,
        topicId: topic.id,
        includeKeywords: ["creator tools", "ugc platform"],
        platforms: ["reddit", "web"]
      }
    ]);
  });
});

describe("source repository", () => {
  it("seeds default sources and toggles enabled state", async () => {
    const db = createDb(databaseUrl);
    const sources = createSourceRepository(db);

    await sources.seedDefaults();
    const reddit = await sources.updateEnabled("reddit", false);

    expect(reddit?.enabled).toBe(false);
    expect(reddit?.defaultLimit).toBe(100);
    expect((await sources.list()).map((source) => source.platform)).toEqual([
      "reddit",
      "x",
      "youtube",
      "pinterest",
      "web"
    ]);
  });
});

describe("crawl task and raw content repositories", () => {
  it("creates crawl tasks and deduplicates raw content by platform external id", async () => {
    const db = createDb(databaseUrl);
    const topics = createTopicRepository(db);
    const queries = createQueryRepository(db);
    const sources = createSourceRepository(db);
    const tasks = createCrawlTaskRepository(db);
    const rawContents = createRawContentRepository(db);
    const topic = await topics.create({ name: "AI Search", language: "en", market: "US" });
    const query = await queries.create({
      topicId: topic.id,
      name: "AI search",
      includeKeywords: ["ai search"],
      excludeKeywords: [],
      platforms: ["reddit"],
      language: "en",
      frequency: "manual",
      limitPerRun: 20
    });
    await sources.seedDefaults();
    const reddit = await sources.getByPlatform("reddit");

    const task = await tasks.create({
      topicId: topic.id,
      queryId: query.id,
      sourceId: reddit!.id,
      targetCount: 20
    });
    const inserted = await rawContents.createMany([
      {
        platform: "reddit",
        topicId: topic.id,
        queryId: query.id,
        sourceId: reddit!.id,
        externalId: "reddit_1",
        url: "https://reddit.com/r/search/comments/1",
        text: "AI search discussion"
      },
      {
        platform: "reddit",
        topicId: topic.id,
        queryId: query.id,
        sourceId: reddit!.id,
        externalId: "reddit_1",
        url: "https://reddit.com/r/search/comments/1",
        text: "AI search discussion"
      }
    ]);
    const updated = await tasks.update(task.id, {
      status: "success",
      collectedCount: 1,
      validCount: inserted.items.length,
      duplicateCount: inserted.duplicates,
      finishedAt: "2026-05-06T00:00:00.000Z"
    });

    expect(updated?.status).toBe("success");
    expect(inserted.duplicates).toBe(1);
    expect(await rawContents.list()).toMatchObject([{ externalId: "reddit_1" }]);
  });
});
