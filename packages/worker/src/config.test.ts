import { describe, expect, it } from "vitest";
import { getDefaultBrowserProfilePath, loadWorkerConfig } from "./config";

describe("loadWorkerConfig", () => {
  it("defaults to single concurrency for small servers", () => {
    const config = loadWorkerConfig({
      DATABASE_URL: "file:data/test.sqlite",
      REDIS_URL: "redis://127.0.0.1:6379"
    });

    expect(config.databaseUrl).toBe("file:data/test.sqlite");
    expect(config.redisUrl).toBe("redis://127.0.0.1:6379");
    expect(config.concurrency).toBe(1);
    expect(config.browserProfilePath).toBe(getDefaultBrowserProfilePath());
  });

  it("requires Redis for persistent crawl queue", () => {
    expect(() => loadWorkerConfig({ DATABASE_URL: "file:data/test.sqlite" })).toThrow(
      "missing_REDIS_URL"
    );
  });
});
