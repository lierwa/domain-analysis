import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createProductKnowledgeDb, migrateProductKnowledgeDatabase } from "./productKnowledgeClient";
import { productKnowledgeProjects } from "./productKnowledgeSchema";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;
const clients: Array<ReturnType<typeof createProductKnowledgeDb>["$client"]> = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.end()));
});

describeWithPostgres("product knowledge PostgreSQL migration", () => {
  it("creates the new product database and can repeat safely", async () => {
    await Promise.all(Array.from(
      { length: 4 },
      () => migrateProductKnowledgeDatabase(databaseUrl!),
    ));
    await migrateProductKnowledgeDatabase(databaseUrl!);
    const db = createProductKnowledgeDb(databaseUrl!);
    clients.push(db.$client);
    const tables = await db.$client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'workbench' ORDER BY table_name",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "__drizzle_migrations",
      "category_definition_versions",
      "category_interview_decisions",
      "category_interview_messages",
      "category_interview_sessions",
      "category_interview_unresolved_items",
      "category_research_brief_versions",
      "collection_board_versions",
      "confirmed_scope_versions",
      "evidence_items",
      "evidence_requests",
      "knowledge_candidates",
      "knowledge_conflicts",
      "knowledge_factory_batches",
      "knowledge_review_decisions",
      "knowledge_unknowns",
      "market_universe_versions",
      "product_knowledge_projects",
      "source_assets",
      "source_collection_plans",
      "source_collection_runs",
      "source_objects",
      "source_observations",
      "source_snapshots",
    ]);
  });

  it("persists a product project through the typed Drizzle schema", async () => {
    await migrateProductKnowledgeDatabase(databaseUrl!);
    const db = createProductKnowledgeDb(databaseUrl!);
    clients.push(db.$client);
    const projectId = `database-test-${randomUUID()}`;
    await db.insert(productKnowledgeProjects).values({
      id: projectId,
      name: "中国电视知识项目",
      knowledgeTopic: "电视专业导购知识",
      market: "CN",
      status: "draft",
    });
    const project = await db.query.productKnowledgeProjects.findFirst({
      where: eq(productKnowledgeProjects.id, projectId),
    });
    expect(project?.revision).toBe(1);
    expect(project?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
