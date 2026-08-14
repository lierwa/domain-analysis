import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import * as schema from "./productKnowledgeSchema";

export const defaultProductKnowledgeDatabaseUrl = "file:data/product-knowledge-workbench.sqlite";

export function createProductKnowledgeDb(
  databaseUrl = process.env.PRODUCT_KNOWLEDGE_DATABASE_URL ?? defaultProductKnowledgeDatabaseUrl,
) {
  return drizzle(createClient({ url: databaseUrl }), { schema });
}

export type ProductKnowledgeDb = ReturnType<typeof createProductKnowledgeDb>;

export async function migrateProductKnowledgeDatabase(
  databaseUrl = process.env.PRODUCT_KNOWLEDGE_DATABASE_URL ?? defaultProductKnowledgeDatabaseUrl,
  migrationsFolder = new URL("../../../drizzle/product-knowledge", import.meta.url).pathname,
) {
  await ensureSqliteDirectory(databaseUrl);
  const client = createClient({ url: databaseUrl });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    client.close();
  }
}

async function ensureSqliteDirectory(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) return;
  const sqlitePath = databaseUrl.slice("file:".length);
  if (!sqlitePath || sqlitePath === ":memory:") return;
  await mkdir(dirname(sqlitePath), { recursive: true });
}
