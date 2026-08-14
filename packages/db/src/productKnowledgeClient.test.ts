import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createProductKnowledgeDb, migrateProductKnowledgeDatabase } from "./productKnowledgeClient";
import { productKnowledgeProjects } from "./productKnowledgeSchema";

const clients: Array<ReturnType<typeof createClient>> = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

describe("product knowledge database migration", () => {
  it("creates the new product database and can repeat safely", async () => {
    const databaseUrl = await temporaryDatabaseUrl();
    await migrateProductKnowledgeDatabase(databaseUrl);
    await migrateProductKnowledgeDatabase(databaseUrl);
    const client = createClient({ url: databaseUrl });
    clients.push(client);
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(tables.rows.map((row) => row.name)).toEqual([
      "__drizzle_migrations",
      "category_definition_versions",
      "collection_board_versions",
      "confirmed_scope_versions",
      "product_knowledge_projects",
    ]);
  });

  it("persists a product project through the typed Drizzle schema", async () => {
    const databaseUrl = await temporaryDatabaseUrl();
    await migrateProductKnowledgeDatabase(databaseUrl);
    const db = createProductKnowledgeDb(databaseUrl);
    await db.insert(productKnowledgeProjects).values({
      id: "project-1",
      name: "中国电视知识项目",
      knowledgeTopic: "电视专业导购知识",
      market: "CN",
      status: "draft",
    });
    const project = await db.query.productKnowledgeProjects.findFirst({
      where: eq(productKnowledgeProjects.id, "project-1"),
    });
    expect(project?.revision).toBe(1);
  });
});

async function temporaryDatabaseUrl() {
  const directory = await mkdtemp(path.join(tmpdir(), "product-knowledge-db-"));
  return `file:${path.join(directory, "database.sqlite")}`;
}
