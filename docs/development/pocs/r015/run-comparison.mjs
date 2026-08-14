import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256, writeImmutableJson } from "../lib/poc-artifact.mjs";
import { amplifyKnowledgePackage } from "./amplified-fixture.mjs";
import { buildDuckdbOramaPackage, queryDuckdbOramaPackage } from "./duckdb-orama-candidate.mjs";
import { assertFrozenQueries } from "./frozen-query.mjs";
import { loadKnowledgePackage } from "./package-fixture.mjs";
import { rollbackPackage, switchPackage } from "./package-pointer.mjs";
import { buildSqlitePackage, querySqlitePackage } from "./sqlite-candidate.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const attemptId = new Date().toISOString().replaceAll(":", "-");
const attemptDirectory = path.join(repositoryRoot, "data/pocs/r015/attempts", attemptId);
await mkdir(attemptDirectory, { recursive: true });

const knowledgePackage = await loadKnowledgePackage();
const sqlitePath = path.join(attemptDirectory, "knowledge.sqlite");
const duckPath = path.join(attemptDirectory, "knowledge.duckdb");
const oramaPath = path.join(attemptDirectory, "search.json");
const sqliteBuild = await buildSqlitePackage(knowledgePackage, sqlitePath);
const duckdbOramaBuild = await buildDuckdbOramaPackage(knowledgePackage, duckPath, oramaPath);

// WHY：复制到新的目录后再查询，验证知识包没有依赖构建机上的绝对路径或隐藏状态。
const copiedDirectory = path.join(attemptDirectory, "copied");
await mkdir(copiedDirectory);
const copiedSqlitePath = path.join(copiedDirectory, "knowledge.sqlite");
await copyFile(sqlitePath, copiedSqlitePath);
const sqliteMeasurement = await measureQuery(() => querySqlitePackage(copiedSqlitePath));
const duckdbOramaMeasurement = await measureQuery(() => queryDuckdbOramaPackage(duckPath, oramaPath));
const sqliteQuery = sqliteMeasurement.result;
const duckdbOramaQuery = duckdbOramaMeasurement.result;
assertFrozenQueries(sqliteQuery);
assertFrozenQueries(duckdbOramaQuery);

const switchEvidence = await verifyAtomicSwitch(attemptDirectory, sqlitePath);
const amplified = await runAmplifiedComparison(attemptDirectory, knowledgePackage, 1000);
const comparison = {
  schemaVersion: "r015-storage-comparison-v1",
  attemptId,
  fixture: true,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  frozenQueries: { count: 9, sqlitePassed: true, duckdbOramaPassed: true },
  candidates: {
    sqlite: { ...sqliteBuild, filePath: path.relative(repositoryRoot, sqliteBuild.filePath),
      query: sqliteQuery, queryResources: sqliteMeasurement.resources },
    duckdbOrama: {
      ...duckdbOramaBuild,
      duckPath: path.relative(repositoryRoot, duckdbOramaBuild.duckPath),
      oramaPath: path.relative(repositoryRoot, duckdbOramaBuild.oramaPath),
      totalBytes: duckdbOramaBuild.duckBytes + duckdbOramaBuild.oramaBytes,
      query: duckdbOramaQuery,
      queryResources: duckdbOramaMeasurement.resources,
    },
  },
  amplified,
  packageSwitch: switchEvidence,
  externalCallsDuringQuery: { network: 0, model: 0, embedding: 0 },
};
const outputPath = path.join(attemptDirectory, "comparison.json");
const artifact = await writeImmutableJson(outputPath, comparison);
console.log(JSON.stringify({ outputPath, ...artifact, comparison }, null, 2));

async function verifyAtomicSwitch(directory, sourcePath) {
  const v1Path = path.join(directory, "knowledge-v1.sqlite");
  const v2Path = path.join(directory, "knowledge-v2.sqlite");
  await Promise.all([copyFile(sourcePath, v1Path), copyFile(sourcePath, v2Path)]);
  const [v1Hash, v2Hash] = await Promise.all([fileHash(v1Path), fileHash(v2Path)]);
  const pointerPath = path.join(directory, "current.json");
  const previousPath = path.join(directory, "previous.json");
  await switchPackage(pointerPath, previousPath, { version: "v1", filePath: v1Path, sha256: v1Hash });
  await switchPackage(pointerPath, previousPath, { version: "v2", filePath: v2Path, sha256: v2Hash });
  const switched = JSON.parse(await readFile(pointerPath, "utf8"));
  const rolledBack = await rollbackPackage(pointerPath, previousPath);
  return { validationBeforeSwitch: true, switchedTo: switched.version, rolledBackTo: rolledBack.version };
}

async function runAmplifiedComparison(directory, source, productCount) {
  const scaledDirectory = path.join(directory, `scaled-${productCount}`);
  await mkdir(scaledDirectory);
  const scaled = amplifyKnowledgePackage(source, productCount);
  const sqlite = await buildSqlitePackage(scaled, path.join(scaledDirectory, "knowledge.sqlite"));
  const duckdbOrama = await buildDuckdbOramaPackage(scaled,
    path.join(scaledDirectory, "knowledge.duckdb"), path.join(scaledDirectory, "search.json"));
  const sqliteMeasurement = await measureQuery(() => querySqlitePackage(sqlite.filePath));
  const duckdbOramaMeasurement = await measureQuery(() =>
    queryDuckdbOramaPackage(duckdbOrama.duckPath, duckdbOrama.oramaPath));
  assertScaledQuery(sqliteMeasurement.result);
  assertScaledQuery(duckdbOramaMeasurement.result);
  return {
    fixture: true,
    productCount,
    claimCount: scaled.claims.length,
    sqlite: { bytes: sqlite.bytes, buildMs: sqlite.buildMs,
      query: summarizeQuery(sqliteMeasurement.result), queryResources: sqliteMeasurement.resources },
    duckdbOrama: { totalBytes: duckdbOrama.duckBytes + duckdbOrama.oramaBytes,
      buildMs: duckdbOrama.buildMs, query: summarizeQuery(duckdbOramaMeasurement.result),
      queryResources: duckdbOramaMeasurement.resources },
  };
}

async function measureQuery(query) {
  const before = process.resourceUsage();
  const result = await query();
  const after = process.resourceUsage();
  return { result, resources: {
    userCpuMs: roundMicroseconds(after.userCPUTime - before.userCPUTime),
    systemCpuMs: roundMicroseconds(after.systemCPUTime - before.systemCPUTime),
    minorPageFaults: after.minorPageFault - before.minorPageFault,
    majorPageFaults: after.majorPageFault - before.majorPageFault,
  } };
}

function assertScaledQuery(result) {
  if (result.exact[0]?.model !== "MR-457WUSPZE" || result.evidence.length !== 1 || !result.writeBlocked) {
    throw new Error("放大样本未保持冻结查询语义");
  }
}

function summarizeQuery(result) {
  return {
    queryMs: result.queryMs,
    resultCounts: Object.fromEntries(["exact", "alias", "chinese", "numeric", "evidence", "exceptions"]
      .map((key) => [key, result[key].length])),
    writeBlocked: result.writeBlocked,
  };
}

function roundMicroseconds(value) {
  return Math.round(value) / 1000;
}

async function fileHash(filePath) {
  return sha256(await readFile(filePath));
}
