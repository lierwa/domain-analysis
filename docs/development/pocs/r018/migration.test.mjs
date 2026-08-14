import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const migrationsFolder = new URL("./generated", import.meta.url).pathname;

test("空库 migration 可重复执行并与 schema.ts 一致", async () => {
  const databasePath = await temporaryDatabasePath("empty");
  const client = createClient({ url: `file:${databasePath}` });
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder });
    await migrate(db, { migrationsFolder });
    assert.equal(await migrationCount(client), 1);
    assert.deepEqual(await applicationTables(client), expectedTables);
    assert.equal((await client.execute("PRAGMA foreign_key_list('raw_contents')")).rows.length, 4);
    assert.deepEqual(await applicationIndexes(client), expectedIndexes);

    // WHY：schema.ts 没有 platform 唯一约束；多来源同平台必须可表达，不能继承手写 DDL 漂移。
    await client.batch([
      sourceInsert("source-a", "official_web"),
      sourceInsert("source-b", "official_web"),
    ]);
  } finally {
    client.close();
  }
});

test("失败 migration 整批回滚且不写入 migration log", async () => {
  const databasePath = await temporaryDatabasePath("failed");
  const client = createClient({ url: `file:${databasePath}` });
  const db = drizzle(client);
  const badFolder = await createFailingMigrationFolder();
  try {
    await migrate(db, { migrationsFolder });
    await assert.rejects(migrate(db, { migrationsFolder: badFolder }));
    assert.equal(await migrationCount(client), 1);
    assert.equal(await tableExists(client, "r018_partial"), false);
  } finally {
    client.close();
  }
});

test("官方 migrator 对旧手写 DDL 库失败关闭，不擅自 baseline", async () => {
  const databasePath = await temporaryDatabasePath("legacy");
  await createLegacyDatabase(databasePath);
  const client = createClient({ url: `file:${databasePath}` });
  const db = drizzle(client);
  try {
    await assert.rejects(migrate(db, { migrationsFolder }), /already exists/i);
    assert.deepEqual(await applicationTables(client), expectedTables);
    assert.equal(await migrationCount(client), 0);
  } finally {
    client.close();
  }
});

async function createFailingMigrationFolder() {
  const directory = await mkdtemp(path.join(tmpdir(), "r018-bad-migrations-"));
  await cp(migrationsFolder, directory, { recursive: true });
  const journalPath = path.join(directory, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  journal.entries.push({ idx: 1, version: "6", when: journal.entries[0].when + 1, tag: "0001_failure", breakpoints: true });
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  await writeFile(path.join(directory, "0001_failure.sql"),
    "CREATE TABLE r018_partial(id text);--> statement-breakpoint\nBROKEN SQL;");
  return directory;
}

async function createLegacyDatabase(databasePath) {
  const tsxPath = new URL("../../../../node_modules/.bin/tsx", import.meta.url).pathname;
  const helperPath = new URL("./legacy-database.ts", import.meta.url).pathname;
  await new Promise((resolve, reject) => {
    const child = spawn(tsxPath, [helperPath, `file:${databasePath}`], { stdio: "pipe" });
    const output = [];
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(output.join(""))));
  });
}

async function temporaryDatabasePath(label) {
  const directory = await mkdtemp(path.join(tmpdir(), `r018-${label}-`));
  return path.join(directory, "database.sqlite");
}

async function applicationTables(client) {
  const result = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name");
  return result.rows.map((row) => row.name);
}

async function applicationIndexes(client) {
  const result = await client.execute("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return result.rows.map((row) => row.name);
}

async function migrationCount(client) {
  if (!await tableExists(client, "__drizzle_migrations")) return 0;
  return Number((await client.execute("SELECT COUNT(*) AS count FROM __drizzle_migrations")).rows[0].count);
}

async function tableExists(client, tableName) {
  const result = await client.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
    args: [tableName],
  });
  return result.rows.length === 1;
}

function sourceInsert(id, platform) {
  return {
    sql: "INSERT INTO sources (id, platform, name) VALUES (?, ?, ?)",
    args: [id, platform, id],
  };
}

const expectedTables = [
  "analysis_projects", "analysis_runs", "analyzed_contents", "cleaned_contents",
  "collection_plans", "crawl_tasks", "raw_contents", "reports", "sources",
];

const expectedIndexes = [
  "analysis_runs_project_idx", "analysis_runs_status_idx", "collection_plans_project_idx",
  "collection_plans_status_next_run_idx", "crawl_tasks_run_idx", "crawl_tasks_status_idx",
  "raw_contents_external_idx", "raw_contents_run_idx", "reports_run_idx",
];
