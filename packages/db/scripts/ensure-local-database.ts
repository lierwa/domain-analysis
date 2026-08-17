import { Client } from "pg";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
if (!databaseUrl) throw new Error("POSTGRES_DATABASE_URL 未配置");

const target = new URL(databaseUrl);
const databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
  throw new Error(`本地数据库名不合法：${databaseName}`);
}

if (await canConnect(databaseUrl)) {
  console.log(`本地 PostgreSQL 数据库已存在：${databaseName}`);
  process.exit(0);
}

const maintenanceUrl = new URL(databaseUrl);
maintenanceUrl.pathname = "/postgres";
const maintenance = new Client({ connectionString: maintenanceUrl.toString() });

try {
  await maintenance.connect();
  const existing = await maintenance.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
    [databaseName],
  );
  if (!existing.rows[0]?.exists) {
    // WHY：数据库只属于当前开发机；这里只创建已校验的空库，不复制或覆盖另一台电脑的数据。
    await maintenance.query(`CREATE DATABASE "${databaseName}"`);
  }
} finally {
  await maintenance.end();
}

if (!await canConnect(databaseUrl)) {
  throw new Error(`本地 PostgreSQL 数据库创建后仍无法连接：${databaseName}`);
}
console.log(`本地 PostgreSQL 数据库已准备：${databaseName}`);

async function canConnect(connectionString: string) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch (error) {
    if (databaseErrorCode(error) === "3D000") return false;
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}
