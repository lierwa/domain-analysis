export function createProductProjectionSchema(z) {
  const hash = z.string().regex(/^[a-f0-9]{64}$/);
  const fact = z.object({ value: z.string().min(1), selector: z.string().min(1) }).strict();
  const namedFact = fact.extend({ name: z.string().min(1) }).strict();
  return z
    .object({
      schemaVersion: z.literal("r001-product-projection-v1"),
      privacyClass: z.literal("sanitized"),
      source: z.literal("jd"),
      sampleId: z.string().min(1),
      state: z.enum(["loaded", "discontinued"]),
      sourceUrl: z.string().url(),
      capturedAt: z.string().datetime(),
      sourceSnapshot: z.object({ htmlSha256: hash, screenshotSha256: hash }).strict(),
      title: fact,
      description: fact.optional(),
      highlights: z.array(namedFact),
      attributes: z.array(namedFact).min(1),
    })
    .strict();
}
