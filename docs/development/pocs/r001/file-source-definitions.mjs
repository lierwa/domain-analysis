import { z } from "zod";

const fileSourceSchema = z
  .object({
    id: z.string().regex(/^F\d{2}$/),
    sourceKind: z.enum(["brand_manual", "regulatory_registry"]),
    url: z.string().url(),
    filename: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
    expectedType: z.object({ ext: z.string().min(1), mime: z.string().min(1) }).strict(),
    maxBytes: z.number().int().positive(),
    privacyClass: z.literal("public"),
    usagePolicy: z.enum(["research_source", "lookup_only"]),
    discovery: z
      .object({
        url: z.string().url(),
        locator: z.string().min(1),
        label: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const fileSourceDefinitions = z.array(fileSourceSchema).parse([
  {
    id: "F01",
    sourceKind: "brand_manual",
    url: "https://dsdcp.smartmidea.net/mcsp/prod/20230803/6b0f37e5343a4abfba8c4a5274565d70.pdf",
    filename: "midea-mr-457wuspze-manual.pdf",
    expectedType: { ext: "pdf", mime: "application/pdf" },
    maxBytes: 20 * 1024 * 1024,
    privacyClass: "public",
    usagePolicy: "research_source",
    discovery: {
      url: "https://www.midea.cn/1/1000000000400692547081.html",
      locator: ".doc_download_table a.default_btn_download",
      label: "MR-457WUSPZE冰箱 说明书",
    },
  },
  {
    id: "F02",
    sourceKind: "regulatory_registry",
    url: "https://www.cnis.ac.cn/tzgg/202412/P020241231788865667216.rar",
    filename: "cnis-refrigerator-energy-records-2016-08-2024-12.rar",
    expectedType: { ext: "rar", mime: "application/x-rar-compressed" },
    maxBytes: 100 * 1024 * 1024,
    privacyClass: "public",
    usagePolicy: "lookup_only",
    discovery: {
      url: "https://www.cnis.ac.cn/tzgg/202412/t20241231_59316.html",
      locator: "附件 1",
      label: "家用电冰箱电冰箱（2016.08-2024.12）",
    },
  },
]);
