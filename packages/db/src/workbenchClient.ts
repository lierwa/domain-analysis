import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";

import * as schema from "./workbenchSchema";

export const defaultWorkbenchDatabaseUrl =
  "postgresql://guojunxi@127.0.0.1:5432/domain_analysis";

// WHY：Drizzle 需要操作系统文件路径；URL.pathname 在 Windows 会保留 /C:/ 前缀和 URL 编码。
const defaultWorkbenchMigrationsFolder = fileURLToPath(
  new URL("../../../drizzle/product-knowledge-postgres", import.meta.url),
);

export function createWorkbenchDb(
  databaseUrl = process.env.POSTGRES_DATABASE_URL ?? defaultWorkbenchDatabaseUrl,
) {
  return drizzle(new Pool({ connectionString: databaseUrl }), { schema });
}

export type WorkbenchDb = ReturnType<typeof createWorkbenchDb>;

export async function migrateWorkbenchDatabase(
  databaseUrl = process.env.POSTGRES_DATABASE_URL ?? defaultWorkbenchDatabaseUrl,
  migrationsFolder = defaultWorkbenchMigrationsFolder,
) {
  const db = createWorkbenchDb(databaseUrl);
  let lockClient: PoolClient | undefined;
  try {
    lockClient = await db.$client.connect();
    const migrationDb = drizzle(lockClient, { schema });
    // WHY：多个 Workbench 同时启动时 Drizzle 不会替我们串行化首次建表；PostgreSQL session lock
    // 只包住官方 migrator，进程异常断连时数据库会自动释放，不另造锁表或迁移器。
    await lockClient.query(
      "SELECT pg_advisory_lock(hashtext($1), hashtext($2))",
      ["domain-analysis", `${schema.workbenchSchemaName}:migration`],
    );
    await migrate(migrationDb, {
      migrationsFolder,
      migrationsSchema: schema.workbenchSchemaName,
      migrationsTable: "__drizzle_migrations",
    });
  } finally {
    // WHY：销毁持锁 session 让 PostgreSQL 自动释放锁，避免 unlock 失败掩盖原始 migration 错误。
    lockClient?.release(true);
    await db.$client.end();
  }
}
