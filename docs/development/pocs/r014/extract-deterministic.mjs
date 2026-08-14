import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as cheerio from "cheerio";
import { unit } from "mathjs";
import { readSheet } from "read-excel-file/node";
import { extractText } from "unpdf";
import { z } from "zod";

import { sha256, writeImmutableJson } from "../lib/poc-artifact.mjs";
import { createProductProjectionSchema } from "../lib/product-projection-schema.mjs";
import { sampleInputs, unitHints } from "./sample-inputs.mjs";

const primaryModelKey = "MIDEA:MR-457WUSPZE";
const productProjectionSchema = createProductProjectionSchema(z);
const normalizedValueSchema = z
  .object({ value: z.number(), unit: z.string().min(1) })
  .strict();
const evidenceSchema = z
  .object({
    sourceObjectId: z.string().min(1),
    sourceKind: z.enum(["brand_web", "brand_manual", "regulator_table"]),
    snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
    locator: z.string().min(1),
    property: z.string().min(1),
    rawValue: z.string().min(1),
    normalizedValue: normalizedValueSchema.optional(),
  })
  .strict();
const outputSchema = z
  .object({
    schemaVersion: z.literal("r014-deterministic-extraction-v3"),
    createdAt: z.string().datetime(),
    modelKey: z.literal(primaryModelKey),
    variants: z.array(z.object({ sourceObjectId: z.string(), color: z.string(), fields: z.number() })),
    evidence: z.array(evidenceSchema).min(1),
    comparison: z.object({
      equalProperties: z.array(z.string()),
      differentProperties: z.array(z.string()),
      onlyInFirst: z.array(z.string()),
      onlyInSecond: z.array(z.string()),
    }),
    marketplaceSubjects: z.array(
      z
        .object({
          sourceObjectId: z.string().min(1),
          modelKey: z.string().min(1),
          state: z.enum(["loaded", "discontinued"]),
          sourceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
          attributeCount: z.number().int().positive(),
          missingFields: z.array(z.literal("description")),
          relationToPrimary: z.enum(["same_subject", "separate_subject"]),
        })
        .strict(),
    ),
  })
  .strict();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

async function main() {
  const variants = await Promise.all(sampleInputs.variants.map(extractVariant));
  const [manualEvidence, registryEvidence, marketplaceSubjects] = await Promise.all([
    extractManual(sampleInputs.manual),
    extractRegistry(sampleInputs.registry),
    Promise.all(sampleInputs.marketplace.map(extractMarketplaceSubject)),
  ]);
  assertSameModel(variants, registryEvidence);
  const output = outputSchema.parse({
    schemaVersion: "r014-deterministic-extraction-v3",
    createdAt: new Date().toISOString(),
    modelKey: primaryModelKey,
    variants: variants.map(({ sourceObjectId, color, evidence }) => ({
      sourceObjectId,
      color,
      fields: evidence.length,
    })),
    evidence: [...variants.flatMap(({ evidence }) => evidence), ...manualEvidence, registryEvidence],
    comparison: compareVariantFields(variants[0], variants[1]),
    marketplaceSubjects,
  });

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const attemptId = new Date().toISOString().replaceAll(":", "-");
  const outputRoot = path.join(projectRoot, "data/pocs/r014/deterministic", attemptId);
  await mkdir(outputRoot, { recursive: true });
  const artifact = await writeImmutableJson(path.join(outputRoot, "extraction.json"), output);
  console.log(JSON.stringify({ attemptId, evidence: output.evidence.length, artifact }, null, 2));
}

export async function extractMarketplaceSubject(input) {
  const projection = productProjectionSchema.parse(JSON.parse(await readFile(input.path, "utf8")));
  return summarizeMarketplaceProjection(input, projection);
}

export function summarizeMarketplaceProjection(input, projection) {
  const brand = requiredAttribute(projection, "品牌");
  const model = requiredAttribute(projection, "能效网规格型号");
  if (!brand.includes(input.brand) || model !== input.model) {
    throw new Error(`${input.id} 京东投影身份不匹配`);
  }
  return {
    sourceObjectId: input.sourceObjectId,
    modelKey: input.modelKey,
    state: projection.state,
    sourceSnapshotSha256: projection.sourceSnapshot.htmlSha256,
    attributeCount: projection.attributes.length,
    missingFields: projection.description ? [] : ["description"],
    relationToPrimary: input.modelKey === primaryModelKey ? "same_subject" : "separate_subject",
  };
}

export async function extractVariant(input) {
  const [html, metadataText] = await Promise.all([
    readFile(input.htmlPath, "utf8"),
    readFile(input.metadataPath, "utf8"),
  ]);
  const metadata = JSON.parse(metadataText);
  if (sha256(html) !== metadata.files?.html) throw new Error(`${input.id} HTML 哈希不一致`);
  const doc = cheerio.load(html);
  const evidence = [];
  doc(".spec_wrap .spec_table tr").each((index, row) => {
    const cells = doc(row).find("td");
    const property = normalize(cells.eq(0).text());
    const rawValue = normalize(cells.eq(1).text());
    if (!property || !rawValue) return;
    evidence.push({
      sourceObjectId: input.sourceObjectId,
      sourceKind: "brand_web",
      snapshotSha256: metadata.files.html,
      locator: `css:.spec_wrap .spec_table tr:nth-of-type(${index + 1})`,
      property,
      rawValue,
      normalizedValue: normalizeUnit(property, rawValue),
    });
  });
  const color = doc('[spec="颜色"] .option_selected').first().attr("name");
  if (!color || !evidence.length) throw new Error(`${input.id} 规格或颜色缺失`);
  return { sourceObjectId: input.sourceObjectId, color, evidence };
}

async function extractManual(input) {
  const [buffer, metadataText] = await Promise.all([
    readFile(input.path),
    readFile(input.metadataPath, "utf8"),
  ]);
  const metadata = JSON.parse(metadataText);
  if (sha256(buffer) !== metadata.sha256) throw new Error(`${input.id} PDF 哈希不一致`);
  const { totalPages, text } = await extractText(new Uint8Array(buffer), { mergePages: false });
  if (totalPages !== 16) throw new Error(`说明书页数异常：${totalPages}`);
  return text.flatMap((pageText, index) => {
    if (!pageText.includes("MR-457WUSPZE")) return [];
    return [{
      sourceObjectId: input.sourceObjectId,
      sourceKind: "brand_manual",
      snapshotSha256: metadata.sha256,
      locator: `pdf:page=${index + 1}`,
      property: "型号提及",
      rawValue: excerpt(pageText, "MR-457WUSPZE"),
    }];
  });
}

async function extractRegistry(input) {
  const buffer = await readFile(input.path);
  const rows = await readSheet(input.path, input.sheet);
  const row = rows[input.row - 1];
  if (!row || String(row[4]) !== input.model) throw new Error(`${input.id} 监管行不匹配`);
  const rawValue = row.map((value) => String(value ?? "")).join(" | ");
  return {
    sourceObjectId: input.sourceObjectId,
    sourceKind: "regulator_table",
    snapshotSha256: sha256(buffer),
    locator: `xlsx:${input.sheet}!A${input.row}:G${input.row}`,
    property: "能效备案",
    rawValue,
  };
}

export function compareVariantFields(first, second) {
  const a = new Map(first.evidence.map((item) => [item.property, item.rawValue]));
  const b = new Map(second.evidence.map((item) => [item.property, item.rawValue]));
  const shared = [...a.keys()].filter((key) => b.has(key));
  return {
    equalProperties: shared.filter((key) => a.get(key) === b.get(key)).sort(),
    differentProperties: shared.filter((key) => a.get(key) !== b.get(key)).sort(),
    onlyInFirst: [...a.keys()].filter((key) => !b.has(key)).sort(),
    onlyInSecond: [...b.keys()].filter((key) => !a.has(key)).sort(),
  };
}

function normalizeUnit(property, rawValue) {
  const hint = unitHints[property];
  if (!hint) return undefined;
  const numeric = Number(rawValue.replaceAll(hint.source, "").trim());
  if (!Number.isFinite(numeric)) return undefined;
  return { value: unit(numeric, hint.source).toNumber(hint.canonical), unit: hint.canonical };
}

function assertSameModel(variants, registryEvidence) {
  const models = variants.map(({ evidence }) =>
    evidence.find(({ property }) => property === "产品型号")?.rawValue,
  );
  if (models.some((model) => model !== "MR-457WUSPZE") || !registryEvidence.rawValue.includes("MR-457WUSPZE")) {
    throw new Error("官网变体与监管型号不能形成强键");
  }
}

function requiredAttribute(projection, name) {
  const value = projection.attributes.find((attribute) => attribute.name === name)?.value;
  if (!value) throw new Error(`${projection.sampleId} 缺少身份字段：${name}`);
  return value;
}

function excerpt(text, term) {
  const normalized = normalize(text);
  const index = normalized.indexOf(term);
  return normalized.slice(Math.max(0, index - 120), index + term.length + 600);
}

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
