import { chmod, readFile, stat } from "node:fs/promises";

import { DuckDBInstance } from "@duckdb/node-api";
import { create, insertMultiple, load, save, search } from "@orama/orama";
import { stopwords } from "@orama/stopwords/mandarin";
import { createTokenizer } from "@orama/tokenizers/mandarin";
import writeFileAtomic from "write-file-atomic";

import { FULL_TEXT_LIMIT } from "./frozen-query.mjs";

export async function buildDuckdbOramaPackage(knowledgePackage, duckPath, oramaPath) {
  const startedAt = performance.now();
  const instance = await DuckDBInstance.create(duckPath);
  const connection = await instance.connect();
  try {
    await createDuckSchema(connection);
    await insertDuckPackage(connection, knowledgePackage);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
  const searchIndex = await createSearchIndex(knowledgePackage);
  // WHY：用 Orama 官方核心快照和成熟的原子写库，避免为持久化插件的 tokenizer 缺陷写兼容层。
  await writeFileAtomic(oramaPath, JSON.stringify(await save(searchIndex)), { fsync: true });
  await Promise.all([chmod(duckPath, 0o444), chmod(oramaPath, 0o444)]);
  return {
    duckPath,
    oramaPath,
    duckBytes: (await stat(duckPath)).size,
    oramaBytes: (await stat(oramaPath)).size,
    buildMs: round(performance.now() - startedAt),
  };
}

export async function queryDuckdbOramaPackage(duckPath, oramaPath) {
  const startedAt = performance.now();
  const instance = await DuckDBInstance.create(duckPath, { access_mode: "READ_ONLY" });
  const connection = await instance.connect();
  let exact;
  let numeric;
  let evidence;
  let exceptions;
  let writeBlocked = false;
  try {
    exact = await queryRows(connection, `SELECT product_id AS "productId", model FROM products WHERE model = ?`,
      ["MR-457WUSPZE"]);
    numeric = await queryRows(connection, `SELECT p.model, c.numeric_value AS "numericValue", c.unit FROM claims c
      JOIN products p ON p.product_id = c.product_id
      WHERE p.category_code = ? AND c.property_key = ? AND c.numeric_value >= ? AND c.state = 'published'`,
    ["refrigerator", "product.total_volume_l", 500]);
    evidence = await queryRows(connection, `SELECT c.claim_id AS "claimId", e.evidence_id AS "evidenceId", e.locator FROM claims c
      JOIN claim_evidence ce ON ce.claim_id = c.claim_id
      JOIN evidence e ON e.evidence_id = ce.evidence_id WHERE c.claim_id = ?`, ["claim:midea:purification"]);
    exceptions = await queryRows(connection,
      `SELECT claim_id AS "claimId", state FROM claims WHERE state IN ('conflict', 'unknown') ORDER BY state`);
    try {
      await connection.run("INSERT INTO products(product_id) VALUES ('forbidden')");
    } catch {
      writeBlocked = true;
    }
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
  // WHY：先建立 Mandarin 实例再加载核心快照，恢复后仍使用官方中文 tokenizer。
  const searchIndex = await createMandarinIndex();
  load(searchIndex, JSON.parse(await readFile(oramaPath, "utf8")));
  const [alias, chinese] = await Promise.all([
    searchDocuments(searchIndex, "436L十字门"),
    searchDocuments(searchIndex, "净味抗菌"),
  ]);
  return { exact, alias, chinese, numeric, evidence, exceptions, writeBlocked,
    queryMs: round(performance.now() - startedAt) };
}

async function createDuckSchema(connection) {
  await connection.run("CREATE TABLE package_meta(package_version VARCHAR PRIMARY KEY, schema_version VARCHAR NOT NULL)");
  await connection.run(`CREATE TABLE products(product_id VARCHAR PRIMARY KEY, category_code VARCHAR NOT NULL,
    manufacturer VARCHAR NOT NULL, model VARCHAR UNIQUE NOT NULL, aliases_json VARCHAR NOT NULL)`);
  await connection.run(`CREATE TABLE claims(claim_id VARCHAR PRIMARY KEY, product_id VARCHAR NOT NULL,
    property_key VARCHAR NOT NULL, numeric_value DOUBLE, unit VARCHAR, text_value VARCHAR NOT NULL,
    knowledge_layer VARCHAR NOT NULL, state VARCHAR NOT NULL)`);
  await connection.run("CREATE TABLE evidence(evidence_id VARCHAR PRIMARY KEY, source_kind VARCHAR NOT NULL, locator VARCHAR NOT NULL)");
  await connection.run("CREATE TABLE claim_evidence(claim_id VARCHAR NOT NULL, evidence_id VARCHAR NOT NULL, PRIMARY KEY(claim_id, evidence_id))");
}

async function insertDuckPackage(connection, knowledgePackage) {
  await connection.run("INSERT INTO package_meta VALUES (?, ?)",
    [knowledgePackage.packageVersion, knowledgePackage.schemaVersion]);
  for (const product of knowledgePackage.products) {
    await connection.run("INSERT INTO products VALUES (?, ?, ?, ?, ?)", [
      product.productId, product.categoryCode, product.manufacturer, product.model, JSON.stringify(product.aliases),
    ]);
  }
  for (const claim of knowledgePackage.claims) {
    await connection.run("INSERT INTO claims VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      claim.claimId, claim.productId, claim.propertyKey, claim.numericValue ?? null, claim.unit ?? null,
      claim.textValue, claim.knowledgeLayer, claim.state,
    ]);
  }
  for (const evidence of knowledgePackage.evidence) {
    await connection.run("INSERT INTO evidence VALUES (?, ?, ?)",
      [evidence.evidenceId, evidence.sourceKind, evidence.locator]);
  }
  for (const claim of knowledgePackage.claims) {
    for (const evidenceId of claim.evidenceRefs) {
      await connection.run("INSERT INTO claim_evidence VALUES (?, ?)", [claim.claimId, evidenceId]);
    }
  }
}

async function createSearchIndex(knowledgePackage) {
  const database = await createMandarinIndex();
  await insertMultiple(database, knowledgePackage.products.map((product) => {
    const claims = knowledgePackage.claims.filter(({ productId }) => productId === product.productId);
    return { ...product, content: claims.flatMap(({ propertyKey, textValue }) => [propertyKey, textValue]).join(" ") };
  }));
  return database;
}

async function createMandarinIndex() {
  return create({
    schema: { productId: "string", categoryCode: "enum", manufacturer: "string", model: "string",
      aliases: "string[]", content: "string" },
    components: { tokenizer: createTokenizer({ language: "mandarin", stopWords: stopwords }) },
  });
}

async function searchDocuments(database, term) {
  const result = await search(database, {
    term, properties: ["model", "aliases", "content"], threshold: 0, limit: FULL_TEXT_LIMIT,
  });
  return result.hits.map(({ document }) => ({ productId: document.productId }));
}

async function queryRows(connection, sql, args = []) {
  const reader = await connection.runAndReadAll(sql, args);
  return reader.getRowObjectsJson();
}

function round(value) {
  return Math.round(value * 100) / 100;
}
