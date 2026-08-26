import type { CaptureTask, CrawlPlanContent } from "@domain-analysis/shared";

export function requirePlanningResearchAudit(
  task: CaptureTask,
  content: CrawlPlanContent,
  invalid: (message: string) => never,
) {
  if (content.executionChecklistVersion !== 4 || !content.researchAudit) {
    invalid("该计划缺少当前多路径与内容验收契约，不是 version 4 执行清单；请重新规划");
  }
  if (content.researchAudit.strategyVersion !== 3) {
    invalid("该计划仍使用缺少逐品牌官网核对的历史 Research Audit；请重新深度规划");
  }
  if (content.sources.some((source) => source.provider.key === "jd.catalog-market"
    || source.entryUrls.some(isExcludedPlanningUrl)
    || source.targets.some((target) => target.providerConfiguration.some(
      (item) => item.key === "url" && typeof item.value === "string" && isExcludedPlanningUrl(item.value),
    )))) {
    invalid("当前正式计划不执行京东来源；请由 AI 深度搜索品牌官网和公开权威来源");
  }
  const audit = content.researchAudit;
  const sources = new Map(content.sources.map((source) => [source.key, source]));
  const landscapePasses = audit.passes.filter((pass) => pass.area === "brand_landscape");
  const landscapeOrigins = new Set(landscapePasses
    .flatMap((pass) => pass.evidenceUrls)
    .filter((url) => !isExcludedPlanningUrl(url))
    .map((url) => new URL(url).origin));
  if (landscapeOrigins.size < 4) {
    invalid("品牌发现至少需要四个独立公开来源，覆盖主流、长尾、区域/进口和饱和核查，且不能依赖京东");
  }
  const saturationQueries = new Set(landscapePasses
    .filter((pass) => pass.lens === "saturation_check")
    .map((pass) => pass.query.trim().toLocaleLowerCase("zh-CN")));
  if (saturationQueries.size < 2) {
    invalid("品牌发现必须用至少两个不同查询完成连续无新增品牌的饱和核查");
  }
  const discoveryEvidence = new Set(landscapePasses.flatMap((pass) => pass.evidenceUrls));
  if (audit.denominator.evidenceUrls.some((url) => !discoveryEvidence.has(url))) {
    invalid("品牌覆盖分母只能引用本轮品牌发现过程实际核查的证据");
  }
  for (const brand of audit.brands) {
    for (const sourceKey of brand.officialSourceKeys) {
      const source = sources.get(sourceKey);
      if (!source || source.sourceKind !== "brand_official") {
        invalid(`品牌 ${brand.name} 引用了不存在或非官网的来源：${sourceKey}`);
      }
    }
  }
  const plannedOfficialSourceKeys = new Set(audit.brands
    .filter((brand) => brand.status === "planned")
    .flatMap((brand) => brand.officialSourceKeys));
  const orphanOfficialSource = content.sources.find((source) => source.sourceKind === "brand_official"
    && !plannedOfficialSourceKeys.has(source.key));
  if (orphanOfficialSource) {
    // WHY：历史来源可以继续保留，但当前执行版必须在品牌账中明确承认，不能一边标未解决一边照常抓。
    invalid(`官网来源没有归属到已规划品牌：${orphanOfficialSource.key}`);
  }
  const requiredTopics = new Set([...task.content.generalTopics, ...task.content.categoryTopics]);
  const mappedTopics = new Set<string>();
  for (const coverage of audit.topicCoverage) {
    if (!requiredTopics.has(coverage.topic)) {
      invalid(`深度调查引用了任务中不存在的内容方向：${coverage.topic}`);
    }
    if (mappedTopics.has(coverage.topic)) {
      invalid(`深度调查重复登记内容方向：${coverage.topic}`);
    }
    for (const sourceKey of new Set(coverage.sourceKeys)) {
      const source = sources.get(sourceKey);
      if (!source || !source.targets.some((target) => target.taskTopics.includes(coverage.topic))) {
        invalid(`内容方向 ${coverage.topic} 没有对应的实际抓取来源：${sourceKey}`);
      }
    }
    mappedTopics.add(coverage.topic);
  }
  const missingTopics = [...requiredTopics].filter((topic) => !mappedTopics.has(topic));
  if (missingTopics.length > 0) {
    invalid(`深度调查账没有覆盖任务内容方向：${missingTopics.join("、")}`);
  }
  const hasStandards = content.sources.some((source) => source.sourceKind === "standards_body"
    || source.sourceKind === "regulator");
  const hasPrinciples = content.sources.some((source) => source.sourceKind === "technical_publisher"
    || source.sourceKind === "industry_organization");
  if (!hasStandards || !hasPrinciples) {
    invalid("深度规划必须同时包含标准/监管来源和权威技术原理来源");
  }
}

export function isExcludedPlanningUrl(rawUrl: string) {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname === "jd.com" || hostname.endsWith(".jd.com");
  } catch {
    return false;
  }
}
