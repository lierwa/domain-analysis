import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as cheerio from "cheerio";
import { z } from "zod";

import { sha256, writeImmutableJson } from "../lib/poc-artifact.mjs";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const sourceMetadataSchema = z
  .object({
    id: z.string().min(1),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url(),
    status: z.number().int().nullable(),
    title: z.string(),
    state: z.enum(["loaded", "discontinued"]),
    expectedTextPresent: z.literal(true),
    privacyClass: z.literal("restricted"),
    capturedAt: z.string().datetime(),
    files: z
      .object({
        html: hashSchema,
        text: hashSchema,
        screenshot: hashSchema,
        resources: hashSchema,
      })
      .strict(),
    resourceCount: z.number().int().nonnegative(),
  })
  .strict();

const factSchema = z.object({ value: z.string().min(1), selector: z.string().min(1) }).strict();
const namedFactSchema = factSchema.extend({ name: z.string().min(1) }).strict();
const projectionSchema = z
  .object({
    schemaVersion: z.literal("r001-product-projection-v1"),
    privacyClass: z.literal("sanitized"),
    source: z.literal("jd"),
    sampleId: z.string().min(1),
    state: z.enum(["loaded", "discontinued"]),
    sourceUrl: z.string().url(),
    capturedAt: z.string().datetime(),
    sourceSnapshot: z.object({ htmlSha256: hashSchema, screenshotSha256: hashSchema }).strict(),
    title: factSchema,
    description: factSchema.optional(),
    highlights: z.array(namedFactSchema),
    attributes: z.array(namedFactSchema).min(1),
  })
  .strict();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

async function main() {
  const attemptId = requireSafeArgument(process.argv[2], "attemptId");
  const sampleId = requireSafeArgument(process.argv[3], "sampleId");
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const localRoot = path.join(projectRoot, "data/pocs/r001");
  const restrictedRoot = await realpath(path.join(localRoot, "restricted-attempts-patchright"));
  const inputDirectory = await realpath(path.join(restrictedRoot, attemptId, sampleId));
  assertInside(restrictedRoot, inputDirectory);

  const [html, metadataText] = await Promise.all([
    readFile(path.join(inputDirectory, "page.html"), "utf8"),
    readFile(path.join(inputDirectory, "metadata.json"), "utf8"),
  ]);
  const metadata = sourceMetadataSchema.parse(JSON.parse(metadataText));
  if (metadata.id !== sampleId || sha256(html) !== metadata.files.html) {
    throw new Error("受限快照身份或 HTML 哈希不一致");
  }

  // WHY：不对整页做“尽量脱敏”，只从稳定商品容器投影明确允许的字段。
  const doc = cheerio.load(html);
  const projection = projectionSchema.parse({
    schemaVersion: "r001-product-projection-v1",
    privacyClass: "sanitized",
    source: "jd",
    sampleId,
    state: metadata.state,
    sourceUrl: metadata.finalUrl,
    capturedAt: metadata.capturedAt,
    sourceSnapshot: {
      htmlSha256: metadata.files.html,
      screenshotSha256: metadata.files.screenshot,
    },
    title: requiredFact(doc, ".sku-title-name"),
    description: optionalFact(doc, ".product-desc"),
    highlights: extractNamedFacts(doc, ".highlight-attrs > .item", ".desc .text", ".title"),
    attributes: extractNamedFacts(
      doc,
      "#spec-n1 .attribute .list > .item",
      ":scope > .label .text",
      ":scope > .value",
    ),
  });

  const serialized = `${JSON.stringify(projection, null, 2)}\n`;
  assertRestrictedValuesExcluded(doc, serialized);
  const outputDirectory = path.join(localRoot, "sanitized-attempts-patchright", attemptId, sampleId);
  await mkdir(outputDirectory, { recursive: true });
  const artifact = await writeImmutableJson(path.join(outputDirectory, "projection.json"), projection);
  console.log(
    JSON.stringify({
      sampleId,
      state: projection.state,
      attributeCount: projection.attributes.length,
      highlightCount: projection.highlights.length,
      projectionSha256: artifact.sha256,
    }),
  );
}

function extractNamedFacts(doc, itemSelector, nameSelector, valueSelector) {
  const facts = [];
  doc(itemSelector).each((index, element) => {
    const item = doc(element);
    const name = normalize(item.find(nameSelector).first().attr("title") ?? item.find(nameSelector).text());
    const value = normalize(
      item.find(valueSelector).first().attr("title") ?? item.find(valueSelector).first().text(),
    );
    if (name && value) {
      facts.push({ name, value, selector: `${itemSelector}:nth-of-type(${index + 1})` });
    }
  });
  return facts;
}

function requiredFact(doc, selector) {
  const fact = optionalFact(doc, selector);
  if (!fact) throw new Error(`必需商品字段缺失：${selector}`);
  return fact;
}

function optionalFact(doc, selector) {
  const value = normalize(doc(selector).first().attr("title") ?? doc(selector).first().text());
  return value ? { value, selector } : undefined;
}

export function assertRestrictedValuesExcluded(doc, serialized) {
  // WHY：主门是白名单投影；已知账户/地址容器只用作失败关闭的二次漏洞检查。
  const restrictedSelectors = [
    ".logistics-address",
    "#area-2026",
    ".ui-areamini-text",
    "#ttbar-mycity-2024",
    ".nickname",
  ];
  for (const selector of restrictedSelectors) {
    const value = normalize(doc(selector).text());
    if (value.length >= 2 && serialized.includes(value)) {
      throw new Error(`受限容器内容泄漏到投影：${selector}`);
    }
  }
}

function requireSafeArgument(value, name) {
  if (!value || !/^[A-Za-z0-9._:-]+$/.test(value)) throw new Error(`无效 ${name}`);
  return value;
}

function assertInside(root, target) {
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("受限快照路径越界");
  }
}

function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
