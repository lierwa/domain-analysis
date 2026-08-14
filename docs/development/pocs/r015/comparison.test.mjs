import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../lib/poc-artifact.mjs";
import { buildDuckdbOramaPackage, queryDuckdbOramaPackage } from "./duckdb-orama-candidate.mjs";
import { assertFrozenQueries } from "./frozen-query.mjs";
import { loadKnowledgePackage } from "./package-fixture.mjs";
import { rollbackPackage, switchPackage } from "./package-pointer.mjs";
import { buildSqlitePackage, querySqlitePackage } from "./sqlite-candidate.mjs";

test("SQLite 单文件覆盖冻结查询并在复制后保持只读", async () => {
  const directory = await workspace("sqlite");
  const source = path.join(directory, "knowledge.sqlite");
  await buildSqlitePackage(await loadKnowledgePackage(), source);
  const copiedDirectory = path.join(directory, "copied");
  await mkdir(copiedDirectory);
  const copied = path.join(copiedDirectory, "knowledge.sqlite");
  await copyFile(source, copied);
  const result = await querySqlitePackage(copied);
  assertFrozenQueries(result);
});

test("DuckDB 和 Orama 双产物覆盖相同冻结查询", async () => {
  const directory = await workspace("duckdb-orama");
  const duckPath = path.join(directory, "knowledge.duckdb");
  const oramaPath = path.join(directory, "search.json");
  await buildDuckdbOramaPackage(await loadKnowledgePackage(), duckPath, oramaPath);
  assertFrozenQueries(await queryDuckdbOramaPackage(duckPath, oramaPath));
});

test("校验通过后原子切换并可回滚旧包", async () => {
  const directory = await workspace("pointer");
  const first = path.join(directory, "first.sqlite");
  const second = path.join(directory, "second.sqlite");
  await buildSqlitePackage(await loadKnowledgePackage(), first);
  await copyFile(first, second);
  const firstHash = sha256(await readFile(first));
  const secondHash = sha256(await readFile(second));
  const pointer = path.join(directory, "current.json");
  const previous = path.join(directory, "previous.json");
  await switchPackage(pointer, previous, { version: "v1", filePath: first, sha256: firstHash });
  await switchPackage(pointer, previous, { version: "v2", filePath: second, sha256: secondHash });
  assert.equal(JSON.parse(await readFile(pointer, "utf8")).version, "v2");
  assert.equal((await rollbackPackage(pointer, previous)).version, "v1");
  assert.equal(JSON.parse(await readFile(pointer, "utf8")).version, "v1");
});

async function workspace(label) {
  return mkdtemp(path.join(tmpdir(), `r015-${label}-`));
}
