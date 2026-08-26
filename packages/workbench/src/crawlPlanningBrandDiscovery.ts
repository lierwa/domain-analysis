import { brandDiscoveryLenses } from "@domain-analysis/shared";
import { z } from "zod";

import { isExcludedPlanningUrl } from "./crawlPlanningResearchAudit";

const boundedText = z.string().trim().min(1).max(2_000);
const urlListSchema = z.array(z.string().url().max(2_048)).min(1).max(30);
const brandPlaceholderMarkers = new Set([
  "placeholder", "unknown", "n/a", "n-a", "na", "null", "undefined", "todo", "tbd",
  "待定", "未知", "其他", "其它", "示例品牌", "品牌名",
]);

const landscapePassSchema = z.object({
  area: z.literal("brand_landscape"), lens: z.enum(brandDiscoveryLenses),
  query: boundedText, evidenceUrls: urlListSchema,
  discoveredBrands: z.array(z.string().trim().min(1).max(300)).max(300),
  finding: boundedText,
}).strict();

const landscapeBrandSchema = z.object({
  name: z.string().trim().min(1).max(300),
  aliases: z.array(z.string().trim().min(1).max(300)).max(30),
  evidenceUrls: urlListSchema,
}).strict();

const discoveryBaseSchema = z.object({
  assistantText: z.string().trim().min(1).max(20_000),
  marketScope: boundedText,
  passes: z.array(landscapePassSchema).min(6).max(60),
  denominator: z.object({
    method: z.enum(["public_registry_or_directory", "multi_source_union"]),
    description: boundedText, evidenceUrls: urlListSchema,
  }).strict(),
  brands: z.array(landscapeBrandSchema).min(2).max(300),
}).strict();

export const brandDiscoveryStageSchema = discoveryBaseSchema.superRefine(addDiscoveryIssues);

export const brandSaturationStageSchema = z.object({
  assistantText: z.string().trim().min(1).max(20_000),
  pass: landscapePassSchema.extend({ lens: z.literal("saturation_check") }).strict(),
  brands: z.array(landscapeBrandSchema).max(300),
}).strict().superRefine((stage, context) => {
  addBrandIdentityIssues(stage.brands, context);
  const discovered = new Set(stage.pass.discoveredBrands.map(normalized));
  const brands = stage.brands.map((brand) => normalized(brand.name));
  if (new Set(brands).size !== brands.length) {
    context.addIssue({ code: "custom", path: ["brands"], message: "饱和查询品牌不能重复" });
  }
  if (discovered.size !== brands.length || brands.some((brand) => !discovered.has(brand))) {
    context.addIssue({ code: "custom", path: ["brands"], message: "饱和查询品牌明细必须与本次发现品牌一致" });
  }
});

export type BrandDiscoveryStage = z.infer<typeof brandDiscoveryStageSchema>;
export type BrandSaturationStage = z.infer<typeof brandSaturationStageSchema>;
export type BrandLandscapeStage = BrandDiscoveryStage & {
  denominator: BrandDiscoveryStage["denominator"] & { brandCount: number };
};

export function assembleBrandLandscape(
  discovery: BrandDiscoveryStage,
  saturationStages: BrandSaturationStage[],
): BrandLandscapeStage {
  const landscape = projectBrandLandscape(discovery, saturationStages);
  const projected = projectLandscapePasses(landscape.passes, landscape.brands);
  const finalPasses = projected.slice(-2);
  if (finalPasses.length < 2 || finalPasses.some((pass) => pass.lens !== "saturation_check"
    || pass.newlyAddedBrands.length > 0)
    || new Set(finalPasses.map((pass) => normalized(pass.query))).size < 2) {
    throw new Error("品牌发现必须以两个不同查询连续无新增品牌停止");
  }
  return landscape;
}

export function projectBrandLandscape(
  discovery: BrandDiscoveryStage,
  saturationStages: BrandSaturationStage[],
): BrandLandscapeStage {
  const brands = new Map(discovery.brands.map((brand) => [normalized(brand.name), { ...brand }]));
  for (const stage of saturationStages) {
    for (const brand of stage.brands) mergeBrand(brands, brand);
  }
  const passes = [...discovery.passes, ...saturationStages.map((stage) => stage.pass)];
  return {
    ...discovery,
    passes,
    denominator: { ...discovery.denominator, brandCount: brands.size },
    brands: [...brands.values()],
  };
}

export function mergeObservedBrands(
  landscape: BrandLandscapeStage,
  observed: Array<{ name: string; aliases: string[]; evidenceUrls: string[]; query: string; finding: string }>,
): BrandLandscapeStage {
  const stages: BrandSaturationStage[] = observed.map((brand) => ({
    assistantText: `官网核对发现品牌候选：${brand.name}`,
    pass: { area: "brand_landscape", lens: "saturation_check", query: brand.query,
      evidenceUrls: brand.evidenceUrls, discoveredBrands: [brand.name], finding: brand.finding },
    brands: [{ name: brand.name, aliases: brand.aliases, evidenceUrls: brand.evidenceUrls }],
  }));
  // WHY：官网核对产生的是带真实查询和证据的增量发现；直接并入既有分母可保留旧品牌事实，
  // 避免为了几个新增项让模型重写全部品牌、别名和证据，再制造空证据或重复品牌。
  return projectBrandLandscape(landscape, stages);
}

export function saturationNewBrandCount(
  stage: BrandSaturationStage,
  knownBrands: BrandLandscapeStage["brands"],
) {
  return stage.brands.filter((brand) => !findMatchingBrandKey(knownBrands, brand)).length;
}

export function projectLandscapePasses(
  passes: BrandLandscapeStage["passes"],
  brands: BrandLandscapeStage["brands"],
) {
  const seen = new Set<string>();
  return passes.map((pass) => {
    const discoveredBrands = [...new Set(pass.discoveredBrands.map((brand) =>
      canonicalBrandName(brand, brands)))];
    const newlyAddedBrands = discoveredBrands.flatMap((canonical) => {
      const key = normalized(canonical);
      if (seen.has(key)) return [];
      seen.add(key);
      return [canonical];
    });
    return { ...pass, discoveredBrands, newlyAddedBrands };
  });
}

function canonicalBrandName(value: string, brands: BrandLandscapeStage["brands"]) {
  const key = normalized(value);
  return brands.find((brand) => [brand.name, ...brand.aliases]
    .some((identity) => normalized(identity) === key))?.name ?? value;
}

function addDiscoveryIssues(stage: z.infer<typeof discoveryBaseSchema>, context: z.RefinementCtx) {
  addBrandIdentityIssues(stage.brands, context);
  const brands = stage.brands.map((brand) => normalized(brand.name));
  if (new Set(brands).size !== brands.length) {
    context.addIssue({ code: "custom", path: ["brands"], message: "品牌发现不能重复" });
  }
  const requiredLenses = brandDiscoveryLenses.filter((lens) => lens !== "saturation_check");
  for (const lens of requiredLenses) {
    if (!stage.passes.some((pass) => pass.lens === lens)) {
      context.addIssue({ code: "custom", path: ["passes"], message: `品牌调查缺少镜头：${lens}` });
    }
  }
  if (stage.passes.some((pass) => pass.lens === "saturation_check")) {
    context.addIssue({ code: "custom", path: ["passes"], message: "饱和查询必须由 Workbench 独立推进" });
  }
  const discovered = new Set(stage.passes.flatMap((pass) => pass.discoveredBrands).map(normalized));
  if (brands.some((brand) => !discovered.has(brand)) || [...discovered].some((brand) => !brands.includes(brand))) {
    context.addIssue({ code: "custom", path: ["brands"], message: "品牌清单必须与发现过程一致" });
  }
  const origins = new Set(stage.passes.flatMap((pass) => pass.evidenceUrls)
    .filter((url) => !isExcludedPlanningUrl(url)).map((url) => new URL(url).origin));
  if (origins.size < 4) context.addIssue({ code: "custom", path: ["passes"], message: "品牌发现至少需要四个独立来源" });
  const evidence = new Set(stage.passes.flatMap((pass) => pass.evidenceUrls));
  if (stage.denominator.evidenceUrls.some((url) => !evidence.has(url))) {
    context.addIssue({ code: "custom", path: ["denominator", "evidenceUrls"], message: "分母证据必须来自品牌发现过程" });
  }
}

function addBrandIdentityIssues(
  brands: Array<{ name: string; aliases: string[] }>,
  context: z.RefinementCtx,
) {
  const owners = new Map<string, number>();
  for (const [index, brand] of brands.entries()) {
    for (const [identityIndex, identity] of [brand.name, ...brand.aliases].entries()) {
      const key = normalized(identity);
      // WHY：模型占位词进入分母后会触发昂贵且无意义的官网搜索；必须在品牌发现阶段失败回填，
      // 不能等批次映射时再把它伪装成一个 unresolved 品牌。
      if (brandPlaceholderMarkers.has(key)) {
        context.addIssue({ code: "custom",
          path: ["brands", index, identityIndex === 0 ? "name" : "aliases"],
          message: `品牌名称不能使用占位标记：${identity}` });
        continue;
      }
      const owner = owners.get(key);
      if (owner !== undefined && owner !== index) {
        context.addIssue({ code: "custom", path: ["brands", index, "aliases"],
          message: `品牌名称或别名与另一品牌重复：${identity}` });
      } else {
        owners.set(key, index);
      }
    }
  }
}

function mergeBrand(
  brands: Map<string, BrandDiscoveryStage["brands"][number]>,
  brand: BrandSaturationStage["brands"][number],
) {
  const key = findMatchingBrandKey([...brands.values()], brand) ?? normalized(brand.name);
  const existing = brands.get(key);
  if (!existing) {
    brands.set(key, { ...brand });
    return;
  }
  // WHY：同一品牌可在不同饱和查询中重复出现；只合并证据和别名，不制造第二个品牌事实。
  existing.aliases = [...new Set([...existing.aliases, ...brand.aliases,
    ...(normalized(existing.name) === normalized(brand.name) ? [] : [brand.name])])];
  existing.evidenceUrls = [...new Set([...existing.evidenceUrls, ...brand.evidenceUrls])];
}

function findMatchingBrandKey(
  knownBrands: BrandLandscapeStage["brands"],
  candidate: BrandSaturationStage["brands"][number],
) {
  const candidateIdentities = new Set([candidate.name, ...candidate.aliases].map(normalized));
  const match = knownBrands.find((brand) => [brand.name, ...brand.aliases]
    .some((identity) => candidateIdentities.has(normalized(identity))));
  return match ? normalized(match.name) : undefined;
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN");
}
