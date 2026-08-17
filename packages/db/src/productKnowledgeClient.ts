import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";

import * as schema from "./productKnowledgeSchema";

export const defaultProductKnowledgeDatabaseUrl =
  "postgresql://guojunxi@127.0.0.1:5432/domain_analysis";

export function createProductKnowledgeDb(
  databaseUrl = process.env.POSTGRES_DATABASE_URL ?? defaultProductKnowledgeDatabaseUrl,
) {
  return drizzle(new Pool({ connectionString: databaseUrl }), { schema });
}

export type ProductKnowledgeDb = ReturnType<typeof createProductKnowledgeDb>;

export async function migrateProductKnowledgeDatabase(
  databaseUrl = process.env.POSTGRES_DATABASE_URL ?? defaultProductKnowledgeDatabaseUrl,
  migrationsFolder = new URL("../../../drizzle/product-knowledge-postgres", import.meta.url).pathname,
) {
  const db = createProductKnowledgeDb(databaseUrl);
  let lockClient: PoolClient | undefined;
  try {
    lockClient = await db.$client.connect();
    const migrationDb = drizzle(lockClient, { schema });
    // WHY：多个 Workbench 同时启动时 Drizzle 不会替我们串行化首次建表；PostgreSQL session lock
    // 只包住官方 migrator，进程异常断连时数据库会自动释放，不另造锁表或迁移器。
    await lockClient.query(
      "SELECT pg_advisory_lock(hashtext($1), hashtext($2))",
      ["domain-analysis", `${schema.productKnowledgeSchemaName}:migration`],
    );
    await migrate(migrationDb, {
      migrationsFolder,
      migrationsSchema: schema.productKnowledgeSchemaName,
      migrationsTable: "__drizzle_migrations",
    });
  } finally {
    // WHY：销毁持锁 session 让 PostgreSQL 自动释放锁，避免 unlock 失败掩盖原始 migration 错误。
    lockClient?.release(true);
    await db.$client.end();
  }
}
