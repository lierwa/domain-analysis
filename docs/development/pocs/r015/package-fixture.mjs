import { readFile } from "node:fs/promises";

import { z } from "zod";

const productSchema = z.object({
  productId: z.string().min(1),
  categoryCode: z.string().min(1),
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  aliases: z.array(z.string().min(1)),
}).strict();
const claimSchema = z.object({
  claimId: z.string().min(1),
  productId: z.string().min(1),
  propertyKey: z.string().min(1),
  numericValue: z.number().optional(),
  unit: z.string().min(1).optional(),
  textValue: z.string().min(1),
  knowledgeLayer: z.string().min(1),
  state: z.enum(["published", "conflict", "unknown"]),
  evidenceRefs: z.array(z.string().min(1)).min(1),
}).strict();
const evidenceSchema = z.object({
  evidenceId: z.string().min(1),
  sourceKind: z.string().min(1),
  locator: z.string().min(1),
}).strict();

export const knowledgePackageSchema = z.object({
  schemaVersion: z.literal("r015-controlled-knowledge-package-v1"),
  fixture: z.literal(true),
  packageVersion: z.string().min(1),
  products: z.array(productSchema).min(1),
  claims: z.array(claimSchema).min(1),
  evidence: z.array(evidenceSchema).min(1),
}).strict().superRefine((value, context) => {
  const products = new Set(value.products.map(({ productId }) => productId));
  const evidence = new Set(value.evidence.map(({ evidenceId }) => evidenceId));
  for (const claim of value.claims) {
    if (!products.has(claim.productId)) {
      context.addIssue({ code: "custom", message: `claim 引用未知商品：${claim.productId}` });
    }
    for (const reference of claim.evidenceRefs) {
      if (!evidence.has(reference)) {
        context.addIssue({ code: "custom", message: `claim 引用未知证据：${reference}` });
      }
    }
  }
});

export async function loadKnowledgePackage(file = new URL("./knowledge-package-fixture.json", import.meta.url)) {
  return knowledgePackageSchema.parse(JSON.parse(await readFile(file, "utf8")));
}
