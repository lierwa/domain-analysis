import { z } from "zod";

const keySchema = z.string().regex(/^[a-z][a-z0-9_.-]+$/);
const urlListSchema = z.array(z.string().url().max(2_048)).min(1).max(30);

export const crawlPlanningResearchAreas = [
  "brand_landscape",
  "official_source_mapping",
  "parameters_and_manuals",
  "standards_and_principles",
] as const;

const brandDiscoveryLensesV2 = [
  "authoritative_directory",
  "broad_market_catalog",
  "mainstream_brands",
  "long_tail_and_niche",
  "regional_and_imported",
  "saturation_check",
] as const;

export const brandDiscoveryLenses = [
  ...brandDiscoveryLensesV2,
  "brand_families_and_subbrands",
] as const;

const planningResearchPassV1Schema = z.object({
  area: z.enum(crawlPlanningResearchAreas), query: z.string().trim().min(1).max(1_000),
  evidenceUrls: urlListSchema, finding: z.string().trim().min(1).max(2_000),
}).strict();

function brandLandscapePassSchema(lenses: readonly [string, ...string[]]) {
  return z.object({
    area: z.literal("brand_landscape"), lens: z.enum(lenses),
    query: z.string().trim().min(1).max(1_000), evidenceUrls: urlListSchema,
    discoveredBrands: z.array(z.string().trim().min(1).max(300)).max(300),
    newlyAddedBrands: z.array(z.string().trim().min(1).max(300)).max(300),
    finding: z.string().trim().min(1).max(2_000),
  }).strict().superRefine((pass, context) => {
    const discovered = new Set(pass.discoveredBrands.map(normalizedBrandName));
    for (const brand of pass.newlyAddedBrands) {
      if (!discovered.has(normalizedBrandName(brand))) {
        context.addIssue({ code: "custom", path: ["newlyAddedBrands"], message: "新增品牌必须同时出现在本轮发现品牌中" });
      }
    }
  });
}

const brandLandscapePassV2Schema = brandLandscapePassSchema(brandDiscoveryLensesV2);
const brandLandscapePassV3Schema = brandLandscapePassSchema(brandDiscoveryLenses);
const otherPlanningResearchPassSchema = z.object({
  area: z.enum(["official_source_mapping", "parameters_and_manuals", "standards_and_principles"]),
  query: z.string().trim().min(1).max(1_000), evidenceUrls: urlListSchema,
  finding: z.string().trim().min(1).max(2_000),
}).strict();

const planningBrandSchema = z.object({
  name: z.string().trim().min(1).max(300), aliases: z.array(z.string().trim().min(1).max(300)).max(30),
  evidenceUrls: urlListSchema, officialSourceKeys: z.array(keySchema).max(20),
  status: z.enum(["planned", "unresolved"]), note: z.string().trim().min(1).max(2_000),
}).strict().superRefine((brand, context) => {
  if (brand.status === "planned" && brand.officialSourceKeys.length === 0) {
    context.addIssue({ code: "custom", path: ["officialSourceKeys"], message: "已规划品牌必须引用至少一个官网来源" });
  }
  if (brand.status === "unresolved" && brand.officialSourceKeys.length > 0) {
    context.addIssue({ code: "custom", path: ["officialSourceKeys"], message: "未解决品牌不能同时引用已规划官网来源" });
  }
});

const planningTopicCoverageSchema = z.object({
  topic: z.string().trim().min(1).max(500), sourceKeys: z.array(keySchema).min(1).max(100),
  rationale: z.string().trim().min(1).max(2_000),
}).strict();
const denominatorSchema = z.object({
  method: z.enum(["public_registry_or_directory", "multi_source_union"]),
  description: z.string().trim().min(1).max(2_000), brandCount: z.number().int().positive().max(300),
  evidenceUrls: urlListSchema,
}).strict();

const commonAuditShape = {
  marketScope: z.string().trim().min(1).max(2_000), brands: z.array(planningBrandSchema).min(2).max(300),
  topicCoverage: z.array(planningTopicCoverageSchema).min(1).max(300),
  completeness: z.enum(["complete", "partial"]), stopReason: z.string().trim().min(1).max(2_000),
};

type AuditBrand = { name: string; aliases: string[]; status: "planned" | "unresolved" };
type AuditPass = { area: string; query: string; finding: string; evidenceUrls: string[]; lens?: string;
  discoveredBrands?: string[]; newlyAddedBrands?: string[] };
type AuditShape = { passes: AuditPass[]; brands: AuditBrand[]; completeness: "complete" | "partial" };
type CurrentAuditShape = AuditShape & { denominator: { brandCount: number } };

const crawlPlanResearchAuditV1Schema = z.object({ strategyVersion: z.literal(1),
  ...commonAuditShape, passes: z.array(planningResearchPassV1Schema).min(4).max(100),
}).strict().superRefine(addV1AuditIssues);

const crawlPlanResearchAuditV2Schema = z.object({ strategyVersion: z.literal(2),
  ...commonAuditShape, passes: z.array(z.union([brandLandscapePassV2Schema, otherPlanningResearchPassSchema])).min(9).max(120),
  denominator: denominatorSchema,
}).strict().superRefine((audit, context) => addCurrentAuditIssues(audit, context, brandDiscoveryLensesV2, false));

export const crawlPlanResearchAuditV3Schema = z.object({ strategyVersion: z.literal(3),
  ...commonAuditShape, passes: z.array(z.union([brandLandscapePassV3Schema, otherPlanningResearchPassSchema])).min(10).max(160),
  denominator: denominatorSchema,
}).strict().superRefine((audit, context) => addCurrentAuditIssues(audit, context, brandDiscoveryLenses, true));

export const crawlPlanResearchAuditSchema = z.union([
  crawlPlanResearchAuditV1Schema, crawlPlanResearchAuditV2Schema, crawlPlanResearchAuditV3Schema,
]);

function addV1AuditIssues(audit: AuditShape, context: z.RefinementCtx) {
  addAreaAndBrandIssues(audit, context);
}

function addCurrentAuditIssues(
  audit: CurrentAuditShape,
  context: z.RefinementCtx,
  lenses: readonly string[],
  requirePerBrandChecks: boolean,
) {
  addAreaAndBrandIssues(audit, context);
  if (audit.denominator.brandCount !== audit.brands.length) {
    context.addIssue({ code: "custom", path: ["denominator", "brandCount"], message: "覆盖分母必须等于逐品牌对账数量" });
  }
  const brandPasses = audit.passes.filter((pass) => pass.area === "brand_landscape");
  for (const lens of lenses) {
    if (!brandPasses.some((pass) => pass.lens === lens)) {
      context.addIssue({ code: "custom", path: ["passes"], message: `品牌调查缺少覆盖镜头：${lens}` });
    }
  }
  const expected = new Set(audit.brands.map((brand) => normalizedBrandName(brand.name)));
  const discovered = new Set(brandPasses.flatMap((pass) => pass.discoveredBrands ?? []).map(normalizedBrandName));
  if ([...expected].some((brand) => !discovered.has(brand)) || [...discovered].some((brand) => !expected.has(brand))) {
    context.addIssue({ code: "custom", path: ["brands"], message: "发现过程与逐品牌对账必须是同一品牌集合" });
  }
  const saturation = brandPasses.filter((pass) => pass.lens === "saturation_check");
  if (saturation.length < 2 || saturation.slice(-2).some((pass) => (pass.newlyAddedBrands?.length ?? 0) > 0)) {
    context.addIssue({ code: "custom", path: ["passes"], message: "至少需要两轮不同查询且连续无新增品牌的饱和检查" });
  }
  if (requirePerBrandChecks) addPerBrandCheckIssues(audit, context);
}

function addAreaAndBrandIssues(audit: { passes: Array<{ area: string }>; brands: Array<{ name: string; status: string }>;
  completeness: "complete" | "partial" }, context: z.RefinementCtx) {
  for (const area of crawlPlanningResearchAreas) {
    if (!audit.passes.some((pass) => pass.area === area)) {
      context.addIssue({ code: "custom", path: ["passes"], message: `深度调查缺少方向：${area}` });
    }
  }
  const names = audit.brands.map((brand) => normalizedBrandName(brand.name));
  if (new Set(names).size !== names.length) context.addIssue({ code: "custom", path: ["brands"], message: "深度调查品牌清单不能重复" });
  if (audit.completeness === "complete" && audit.brands.some((brand) => brand.status === "unresolved")) {
    context.addIssue({ code: "custom", path: ["completeness"], message: "仍有未解决品牌时不能声明调查完整" });
  }
}

function addPerBrandCheckIssues(audit: CurrentAuditShape, context: z.RefinementCtx) {
  const mappingPasses = audit.passes.filter((pass) => pass.area === "official_source_mapping");
  const parameterPasses = audit.passes.filter((pass) => pass.area === "parameters_and_manuals");
  for (const brand of audit.brands) {
    const names = [brand.name, ...brand.aliases].map(normalizedBrandName);
    const mappingCount = mappingPasses.filter((pass) => names.some((name) => searchablePass(pass).includes(name))).length;
    if (mappingCount < (brand.status === "unresolved" ? 2 : 1)) {
      context.addIssue({ code: "custom", path: ["brands"], message: `品牌 ${brand.name} 缺少专门的官网检索记录` });
    }
    if (brand.status === "planned" && !parameterPasses.some((pass) => names.some((name) => searchablePass(pass).includes(name)))) {
      context.addIssue({ code: "custom", path: ["brands"], message: `品牌 ${brand.name} 缺少参数或说明书入口检索记录` });
    }
  }
}

function searchablePass(pass: { query: string; finding: string }) {
  return normalizedBrandName(`${pass.query} ${pass.finding}`);
}

function normalizedBrandName(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN");
}
