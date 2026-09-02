import { captureTaskSchema, publicSourceResearchSchema,
  sourceCoverageAssessmentSchema } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import {
  createMultiSourceCategoryPlanningRuntime,
  mergePublicSources,
  type PublicSourcePlanningResearcher,
} from "../src/multiSourceCategoryPlanningRuntime";
import type { CrawlPlanningRuntime } from "../src/crawlPlanningModule";
import { buildZolCategoryPlanContent } from "../src/zolCategoryPlanningRuntime";

const at = "2026-09-01T00:00:00.000Z";

describe("多来源品类规划", () => {
  it("把原理词研究结果组装为与 ZOL 同级的 exact 网页和 PDF 来源", () => {
    const catalog = buildZolCategoryPlanContent(task(), zolResearch(), at);
    const content = mergePublicSources(task(), catalog, publicResearch(), at, coverage("gap"));

    expect(content.executionChecklistVersion).toBe(7);
    expect(content.sources.map((source) => source.provider.key)).toEqual([
      "zol.catalog-gallery",
      "public.web-resource",
      "public.web-resource",
      "public.web-resource",
    ]);
    expect(content.sources[1]).toMatchObject({
      key: "public.gb-safety",
      sourceKind: "standards_body",
      rawOutputPolicy: { formats: ["html"], retainAssets: false },
      targets: [{ quantity: { mode: "target_count", targetCount: 1 },
        providerConfiguration: [{ key: "route", value: "exact" },
          { key: "url", value: "https://standards.example.org/microwave" }] }],
    });
    expect(content.sources[2]).toMatchObject({
      rawOutputPolicy: { formats: ["document"], retainAssets: true },
    });
    expect(content.researchAudit).toMatchObject({
      kind: "multi_source_planning",
      publicSourceResearch: { topics: expect.any(Array), sources: expect.any(Array) },
    });
  });

  it("公开来源全部受阻时保留失败记录并继续生成商品目录计划", () => {
    const catalog = buildZolCategoryPlanContent(task(), zolResearch(), at);
    const research = publicSourceResearchSchema.parse({
      topics: publicResearch().topics,
      sources: [],
      blocked: [
        { sourceKind: "regulator", query: "官方标准原文", reason: "当前入口不可访问" },
        { sourceKind: "technical_publisher", query: "专业技术原文", reason: "当前入口不可访问" },
        { sourceKind: "brand_official", query: "品牌公开说明书", reason: "当前入口不可访问" },
      ],
    });

    const content = mergePublicSources(task(), catalog, research, at, coverage("gap"));

    expect(content.sources.map((source) => source.provider.key)).toEqual(["zol.catalog-gallery"]);
    expect(content.researchAudit).toMatchObject({
      kind: "multi_source_planning",
      publicSourceResearch: { sources: [], blocked: expect.any(Array) },
    });
  });

  it("exact URL 只允许声明一种实际响应格式", () => {
    const catalog = buildZolCategoryPlanContent(task(), zolResearch(), at);
    const fixture = publicResearch();
    const research = publicSourceResearchSchema.parse({ ...fixture, sources: fixture.sources.map((source, index) =>
      index === 0 ? { ...source, rawFormats: ["HTML", "PDF"] } : source) });

    const content = mergePublicSources(task(), catalog, research, at, coverage("gap"));

    expect(content.sources.some((source) => source.key === "public.gb-safety")).toBe(false);
    expect(content.planningBlockers).toContain(
      "exact URL 只能声明一种实际响应格式：https://standards.example.org/microwave",
    );
  });

  it("引用已完成 ZOL Batch 时只生成其他来源计划", async () => {
    let catalogRuns = 0;
    const catalogRuntime: CrawlPlanningRuntime = { async *run() {
      catalogRuns += 1;
      yield { type: "completed", assistantText: "不应执行", content: buildZolCategoryPlanContent(
        task(), zolResearch(), at,
      ) };
    } };
    const researcher: PublicSourcePlanningResearcher = { async *run() {
      yield { type: "completed", research: publicResearch() };
    } };
    const runtime = createMultiSourceCategoryPlanningRuntime({
      catalogRuntime,
      publicSourceResearcher: researcher,
      now: () => new Date(at),
    });

    const events = [];
    for await (const event of runtime.run({ task: task(), coverage: coverage("satisfied") })) {
      events.push(event);
    }

    expect(catalogRuns).toBe(0);
    const completed = events.at(-1);
    expect(completed?.type).toBe("completed");
    if (completed?.type !== "completed") throw new Error("多来源规划没有返回最终计划");
    expect(completed.content.sources.map((source) => source.provider.key)).toEqual([
      "public.web-resource", "public.web-resource", "public.web-resource",
    ]);
    expect(completed.content.researchAudit).toMatchObject({
      productCatalog: { kind: "completed_source_reference",
        sourceBatchId: "source-batch-completed-zol" },
    });
  });

  it("商品目录和公开研究只产生一份最终多来源计划", async () => {
    const catalogContent = buildZolCategoryPlanContent(task(), zolResearch(), at);
    const catalogRuntime: CrawlPlanningRuntime = { async *run() {
      yield { type: "activity", activity: { id: "catalog-final", kind: "finalizing",
        label: "整理商品目录", status: "running" } };
      yield { type: "completed", assistantText: "商品目录完成。", content: catalogContent };
    } };
    const researcher: PublicSourcePlanningResearcher = { async *run() {
      yield { type: "activity", activity: { id: "research", kind: "web_search",
        label: "搜索网页", status: "completed" } };
      yield { type: "completed", research: publicResearch() };
    } };
    const runtime = createMultiSourceCategoryPlanningRuntime({
      catalogRuntime,
      publicSourceResearcher: researcher,
      now: () => new Date(at),
    });

    const events = [];
    for await (const event of runtime.run({ task: task(), coverage: coverage("gap") })) events.push(event);

    expect(events.filter((event) => event.type === "activity")).toHaveLength(1);
    const completed = events.at(-1);
    expect(completed?.type).toBe("completed");
    if (completed?.type !== "completed") throw new Error("多来源规划没有返回最终计划");
    expect(completed.content.executionChecklistVersion).toBe(7);
    expect(completed.content.sources.map((source) => source.provider.key)).toEqual([
      "zol.catalog-gallery",
      "public.web-resource",
      "public.web-resource",
      "public.web-resource",
    ]);
  });

  it("把覆盖校验错误原样反馈一次并使用补齐后的完整研究结果", async () => {
    const first = publicResearch();
    const corrected = publicSourceResearchSchema.parse({ ...first, sources: [...first.sources,
      source("industry-guide", "industry_organization", "https://industry.example.net/microwave",
        ["principle", "components"], ["HTML"])] });
    let calls = 0;
    const researcher: PublicSourcePlanningResearcher = { async *run(input) {
      calls += 1;
      if (calls === 1) {
        expect(input.correction).toBeUndefined();
        yield { type: "completed", research: first };
        return;
      }
      expect(input.correction).toEqual({
        previousResearch: first,
        validationErrors: ["family professional_technical 需要至少 2 个新候选，当前 1 个",
          "family professional_technical 需要至少 2 个独立网站，当前 1 个"],
      });
      yield { type: "completed", research: corrected };
    } };
    const runtime = createMultiSourceCategoryPlanningRuntime({
      catalogRuntime: unusedCatalogRuntime(), publicSourceResearcher: researcher, now: () => new Date(at),
    });

    const events = [];
    for await (const event of runtime.run({ task: task(), coverage: professionalGapCoverage() })) {
      events.push(event);
    }

    expect(calls).toBe(2);
    const completed = events.at(-1);
    expect(completed?.type).toBe("completed");
    if (completed?.type !== "completed") throw new Error("多来源规划没有返回最终计划");
    expect(completed.content.planningBlockers).toEqual([]);
    expect(completed.content.sources).toHaveLength(4);
  });

  it("一次修正后仍有缺口时停止补查并保留现有覆盖门", async () => {
    let calls = 0;
    const researcher: PublicSourcePlanningResearcher = { async *run() {
      calls += 1;
      yield { type: "completed", research: publicResearch() };
    } };
    const runtime = createMultiSourceCategoryPlanningRuntime({
      catalogRuntime: unusedCatalogRuntime(), publicSourceResearcher: researcher, now: () => new Date(at),
    });

    const events = [];
    for await (const event of runtime.run({ task: task(), coverage: professionalGapCoverage() })) {
      events.push(event);
    }

    expect(calls).toBe(2);
    const completed = events.at(-1);
    expect(completed?.type).toBe("completed");
    if (completed?.type !== "completed") throw new Error("多来源规划没有返回最终计划");
    expect(completed.content.planningBlockers).toContain(
      "family professional_technical 需要至少 2 个新候选，当前 1 个",
    );
  });
});

function unusedCatalogRuntime(): CrawlPlanningRuntime {
  return { async *run() {
    throw new Error("已完成 ZOL 引用不应再次运行商品目录规划");
  } };
}

function task() {
  return captureTaskSchema.parse({
    id: "task-microwave", name: "微波炉多来源抓取", status: "ready", revision: 3,
    content: {
      originalRequest: "抓中国大陆家用微波炉多来源原始资料",
      category: { code: "microwave_oven", label: "家用微波炉" },
      marketScope: "中国大陆",
      brandSelectionPolicy: { mode: "source_brand_ranking", scoreField: "comprehensive_score",
        minimumScoreExclusive: 0, maxBrands: 20 },
      executionCadencePolicy: { mode: "fixed", brandBatchSize: 3, modelsPerBrandPerRound: 10 },
      modelCoveragePolicy: { mode: "max_models_per_brand", maxModelsPerBrand: 20 },
      generalTopics: ["品牌、型号、参数、图集页、来源原图、标准与原始资料"],
      categoryTopics: ["底层原理、核心部件、安全、能效、使用维护"],
      sourceCandidates: [candidate("zol", "https://detail.zol.com.cn/microwave_oven/")],
      excludedContent: ["商用微波炉"], unresolvedItems: [], decisionIds: [],
    },
    createdAt: at, updatedAt: at, confirmedAt: at,
  });
}

function zolResearch() {
  return {
    assistantText: "已核验榜单。",
    categoryUrl: "https://detail.zol.com.cn/microwave_oven/",
    categorySlug: "microwave_oven",
    evidenceUrls: ["https://detail.zol.com.cn/microwave_oven/",
      "https://top.zol.com.cn/compositor/410/manu_attention.html"],
    ranking: { status: "verified" as const,
      rankingUrl: "https://top.zol.com.cn/compositor/410/manu_attention.html",
      rows: [{ rank: 1, name: "美的", comprehensiveScore: 99,
        key: "midea", catalogUrl: "https://detail.zol.com.cn/microwave_oven/midea/" }] },
    budgetRationale: "一个品牌最多二十个型号。",
  };
}

function publicResearch() {
  return publicSourceResearchSchema.parse({
    topics: [
      topic("principle", "operating_principle", "电磁加热原理"),
      topic("components", "core_components", "磁控管与波导"),
      topic("safety", "safety_and_regulation", "安全与认证"),
      topic("testing", "performance_and_testing", "能效与测试"),
      topic("maintenance", "use_and_maintenance", "使用与维护"),
    ],
    sources: [
      source("gb-safety", "standards_body", "https://standards.example.org/microwave", ["safety"], ["HTML"]),
      source("university-paper", "technical_publisher", "https://university.example.edu/microwave.pdf",
        ["principle", "components"], ["PDF"]),
      source("brand-manual", "brand_official", "https://brand.example.com/microwave-manual.pdf",
        ["maintenance", "testing"], ["PDF"]),
    ],
    blocked: [],
  });
}

function topic(key: string, facet: string, label: string) {
  return { key, facet, label, searchTerms: [`${label} 资料`, `${label} 原文`], purpose: `保存${label}原始资料` };
}

function source(key: string, sourceKind: string, url: string, topics: string[], rawFormats: string[]) {
  return { key, name: key, publisher: `${key} publisher`, sourceKind, url, topics, rawFormats,
    reason: `${key} 原始资料入口` };
}

function candidate(id: string, entryUrl: string) {
  return { id, name: id, publisher: "ZOL", entryUrl, sourceKind: "other" as const,
    expectedContents: ["商品目录"], observedFormats: ["HTML"], accessState: "public" as const,
    observedAt: at };
}

function coverage(productCatalog: "gap" | "satisfied") {
  const dimension = (key: string) => ({ key, acceptedSourceCount: 0, distinctOriginCount: 0,
    minimumAcceptedSources: 3, minimumDistinctOrigins: 2, status: "gap" as const });
  return sourceCoverageAssessmentSchema.parse({
    policyVersion: "source-coverage-v1",
    status: "gaps",
    productCatalog: productCatalog === "satisfied"
      ? { status: "satisfied", reference: { providerKey: "zol.catalog-gallery",
        sourceBatchId: "source-batch-completed-zol", reason: "ZOL 微波炉原始数据已经完成验收" } }
      : { status: "gap" },
    acceptedSources: [], attemptedUrls: [],
    families: [dimension("standards_and_regulation"), dimension("professional_technical"),
      dimension("brand_official")],
    facets: [dimension("operating_principle"), dimension("core_components"),
      dimension("safety_and_regulation"), dimension("performance_and_testing"),
      dimension("use_and_maintenance")],
    gaps: [], unfinishedExecutionIds: [], assessedAt: at,
  });
}

function professionalGapCoverage() {
  const current = coverage("satisfied");
  return sourceCoverageAssessmentSchema.parse({ ...current, gaps: [{
    kind: "family", key: "professional_technical", missingSources: 1, missingOrigins: 1,
    targetCandidateCount: 2, targetOriginCount: 2,
  }] });
}
