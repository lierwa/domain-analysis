import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("api config", () => {
  it("defaults SQLite to the repository data directory when run from apps/api", () => {
    expect(loadConfig({}).databaseUrl).toBe("file:../../data/domain-analysis.sqlite");
  });
});
