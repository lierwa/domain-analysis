import { chmod, readFile, stat } from "node:fs/promises";

import { createClient } from "@libsql/client";

import { sha256 } from "../lib/poc-artifact.mjs";
import { FULL_TEXT_LIMIT } from "./frozen-query.mjs";

export async function buildSqlitePackage(knowledgePackage, filePath) {
  const startedAt = performance.now();
  const db = createClient({ url: `file:${filePath}` });
  try {
    await createSchema(db);
    await insertPackage(db, knowledgePackage);
    await db.execute("PRAGMA optimize");
  } finally {
    db.close();
  }
  await chmod(filePath, 0o444);
  const buffer = await readFile(filePath);
  return {
    filePath,
    bytes: (await stat(filePath)).size,
    sha256: sha256(buffer),
    buildMs: round(performance.now() - startedAt),
  };
}

export async function querySqlitePackage(filePath) {
  const startedAt = performance.now();
  const result = await withSqliteRuntime(filePath, async (runtime) => {
    const [exact, alias, chinese, numeric, evidence, exceptions, writeBlocked] = await Promise.all([
      runtime.findProductByModel("MR-457WUSPZE"),
      runtime.search("436L十字门"),
      runtime.search("净味抗菌"),
      runtime.filterNumericClaims({ categoryCode: "refrigerator", propertyKey: "product.total_volume_l",
        minNumericValue: 500, state: "published" }),
      runtime.getClaimEvidence("claim:midea:purification"),
      runtime.listClaimsByStates(["conflict", "unknown"]),
      runtime.verifyReadOnly(),
    ]);
    return { exact, alias, chinese, numeric, evidence, exceptions, writeBlocked };
  });
  return { ...result, queryMs: round(performance.now() - startedAt) };
}

export async function withSqliteRuntime(filePath, operation) {
  const db = createClient({ url: `file:${filePath}` });
  try {
    // WHY：文件权限提供操作系统边界，query_only 再提供连接级边界，避免调用方误写离线知识包。
    await db.execute("PRAGMA query_only=ON");
    return await operation(createRuntime(db));
  } finally {
    db.close();
  }
}

function createRuntime(db) {
  return Object.freeze({
    findProductByModel: (model) =>
      rows(db, "SELECT product_id AS productId, model FROM products WHERE model = ?", [model]),
    search: (term) => searchRows(db, term),
    filterNumericClaims: ({ categoryCode, propertyKey, minNumericValue, state }) =>
      rows(db, `SELECT p.model, c.numeric_value AS numericValue, c.unit FROM claims c
        JOIN products p ON p.product_id = c.product_id
        WHERE p.category_code = ? AND c.property_key = ? AND c.numeric_value >= ? AND c.state = ?`,
      [categoryCode, propertyKey, minNumericValue, state]),
    getClaimEvidence: (claimId) => rows(db, `SELECT c.claim_id AS claimId,
        e.evidence_id AS evidenceId, e.locator FROM claims c
        JOIN claim_evidence ce ON ce.claim_id = c.claim_id
        JOIN evidence e ON e.evidence_id = ce.evidence_id WHERE c.claim_id = ?`, [claimId]),
    getProductClaims: (productId) => rows(db, `SELECT claim_id AS claimId, property_key AS propertyKey,
        numeric_value AS numericValue, unit, text_value AS textValue,
        knowledge_layer AS knowledgeLayer, state FROM claims WHERE product_id = ? ORDER BY claim_id`, [productId]),
    listClaimsByStates: (states) => rows(db,
      `SELECT claim_id AS claimId, state FROM claims WHERE state IN (${placeholders(states)}) ORDER BY state`, states),
    verifyReadOnly: () => verifyReadOnly(db),
  });
}

async function verifyReadOnly(db) {
  try {
    await db.execute("INSERT INTO products(product_id) VALUES ('forbidden')");
    return false;
  } catch (error) {
    return error?.code === "SQLITE_READONLY";
  }
}

function placeholders(values) {
  if (!values.length) throw new Error("查询列表不能为空");
  return values.map(() => "?").join(", ");
}

async function createSchema(db) {
  await db.execute("PRAGMA journal_mode=DELETE");
  await db.execute(`CREATE TABLE package_meta(package_version TEXT PRIMARY KEY, schema_version TEXT NOT NULL)`);
  await db.execute(`CREATE TABLE products(
    product_id TEXT PRIMARY KEY, category_code TEXT NOT NULL, manufacturer TEXT NOT NULL,
    model TEXT NOT NULL UNIQUE, aliases_json TEXT NOT NULL)`);
  await db.execute(`CREATE TABLE claims(
    claim_id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(product_id),
    property_key TEXT NOT NULL, numeric_value REAL, unit TEXT, text_value TEXT NOT NULL,
    knowledge_layer TEXT NOT NULL, state TEXT NOT NULL)`);
  await db.execute(`CREATE TABLE evidence(
    evidence_id TEXT PRIMARY KEY, source_kind TEXT NOT NULL, locator TEXT NOT NULL)`);
  await db.execute(`CREATE TABLE claim_evidence(
    claim_id TEXT NOT NULL REFERENCES claims(claim_id), evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id),
    PRIMARY KEY(claim_id, evidence_id))`);
  await db.execute(`CREATE VIRTUAL TABLE search_documents USING fts5(
    product_id UNINDEXED, content, tokenize='trigram')`);
}

async function insertPackage(db, knowledgePackage) {
  await db.execute({ sql: "INSERT INTO package_meta VALUES (?, ?)",
    args: [knowledgePackage.packageVersion, knowledgePackage.schemaVersion] });
  for (const product of knowledgePackage.products) {
    await db.execute({ sql: "INSERT INTO products VALUES (?, ?, ?, ?, ?)", args: [
      product.productId, product.categoryCode, product.manufacturer, product.model, JSON.stringify(product.aliases),
    ] });
  }
  for (const claim of knowledgePackage.claims) {
    await db.execute({ sql: "INSERT INTO claims VALUES (?, ?, ?, ?, ?, ?, ?, ?)", args: [
      claim.claimId, claim.productId, claim.propertyKey, claim.numericValue ?? null, claim.unit ?? null,
      claim.textValue, claim.knowledgeLayer, claim.state,
    ] });
  }
  for (const evidence of knowledgePackage.evidence) {
    await db.execute({ sql: "INSERT INTO evidence VALUES (?, ?, ?)",
      args: [evidence.evidenceId, evidence.sourceKind, evidence.locator] });
  }
  for (const claim of knowledgePackage.claims) {
    for (const evidenceId of claim.evidenceRefs) {
      await db.execute({ sql: "INSERT INTO claim_evidence VALUES (?, ?)", args: [claim.claimId, evidenceId] });
    }
  }
  for (const product of knowledgePackage.products) {
    const claims = knowledgePackage.claims.filter(({ productId }) => productId === product.productId);
    const content = [product.manufacturer, product.model, ...product.aliases,
      ...claims.flatMap(({ propertyKey, textValue }) => [propertyKey, textValue])].join(" ");
    await db.execute({ sql: "INSERT INTO search_documents(product_id, content) VALUES (?, ?)",
      args: [product.productId, content] });
  }
}

async function searchRows(db, term) {
  return rows(db, `SELECT product_id AS productId FROM search_documents
    WHERE search_documents MATCH ? ORDER BY rank LIMIT ?`, [ftsPhrase(term), FULL_TEXT_LIMIT]);
}

async function rows(db, sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows.map(normalizeRow);
}

function ftsPhrase(value) {
  // WHY：型号包含连字符，直接传给 FTS5 会被解析成查询语法；官方短语语法可保留字面含义。
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, typeof value === "bigint" ? Number(value) : value]));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
