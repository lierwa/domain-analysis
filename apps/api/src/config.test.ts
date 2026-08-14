import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("api config", () => {
  it("defaults SQLite to the repository data directory when run from apps/api", () => {
    expect(loadConfig({})).toMatchObject({
      databaseUrl: "file:../../data/domain-analysis.sqlite",
      productKnowledgeDatabaseUrl: "file:../../data/product-knowledge-workbench.sqlite",
    });
  });

  it("allows the new product database path to be configured independently", () => {
    expect(loadConfig({ PRODUCT_KNOWLEDGE_DATABASE_URL: "file:/tmp/product.sqlite" })
      .productKnowledgeDatabaseUrl).toBe("file:/tmp/product.sqlite");
  });
});
