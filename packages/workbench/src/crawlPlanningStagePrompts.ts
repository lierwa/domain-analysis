import type { CaptureTask, CrawlPlan } from "@domain-analysis/shared";

import {
  brandStageCandidates,
  knowledgeStageCandidates,
} from "./crawlPlanningStages";
import type { BrandLandscapeStage } from "./crawlPlanningBrandDiscovery";
import { isExcludedPlanningUrl } from "./crawlPlanningResearchAudit";

type RuntimeInput = {
  task: CaptureTask;
  instruction?: string;
  previousPlans: CrawlPlan[];
};

export function brandDiscoveryPrompt(input: RuntimeInput) {
  return [
    commonPreamble(),
    "本轮只做品牌发现阶段：调查品类品牌集合和发现账。不要输出官网来源、target、最终 Crawl Plan 或 saturation_check。",
    "分别按 authoritative_directory、broad_market_catalog、mainstream_brands、long_tail_and_niche、regional_and_imported、brand_families_and_subbrands 六个镜头搜索。前 N、销量榜、推荐榜不能冒充完整分母，至少四个独立非京东 origin。饱和查询稍后由 Workbench 逐轮独立发起。",
    "每轮 discoveredBrands 只写该查询实际发现的规范品牌名；Workbench 会按 pass 顺序确定性计算首次新增，不能输出 newlyAddedBrands。母品牌、面向消费者独立销售的子品牌和授权品牌分别核查。品牌清单必须与全部发现记录的并集一致。",
    "denominator 只有公开注册表或完整目录才能用 public_registry_or_directory；否则用 multi_source_union。证据只能引用本轮 passes；不要填写 brandCount，Workbench 会从品牌清单计算。",
    "这是首次品牌分母调查；官网核对后发现的新品牌由 Workbench 使用原查询证据增量并入，不重写本轮品牌账。用户指定的品类目录线索必须在 broad_market_catalog 镜头搜索核实，不能只写进 finding。",
    `品类与市场：${JSON.stringify({ category: input.task.content.category, marketScope: input.task.content.marketScope })}`,
    `明确排除：${JSON.stringify(input.task.content.excludedContent)}`,
    `任务原文：${JSON.stringify(input.task.content.originalRequest)}`,
    `用户本轮修订要求：${JSON.stringify(input.instruction ?? "首次制定计划")}`,
    finalAnswerRule(),
  ].join("\n\n");
}

export function brandSaturationPrompt(
  input: RuntimeInput,
  landscape: BrandLandscapeStage,
  previousQueries: string[],
) {
  return [
    commonPreamble(),
    "本轮只执行一个新的品牌饱和查询，不重复六类品牌发现，不输出官网来源、target 或最终 Crawl Plan。",
    "选择一个与 previousQueries 不同的查询并实际 web search。pass.lens 固定为 saturation_check；discoveredBrands 只写有证据明确属于任务品类、市场且作为独立消费者品牌销售的规范名称。相邻品类、任务排除项、产品线、系列名、母品牌已有别名和身份仍不确定的线索只写 finding，不进入 discoveredBrands/brands。brands 必须逐项对应 discoveredBrands，并保存别名和证据 URL；如果没有符合范围的品牌，两者都返回空数组。",
    "Workbench 会把本次品牌与已知集合比较；只有连续两个不同查询都没有新增品牌才停止。不要声称整轮已经饱和，也不要填写 brandCount。",
    `品类与市场：${JSON.stringify({ category: input.task.content.category, marketScope: input.task.content.marketScope })}`,
    `品类内容方向：${JSON.stringify(input.task.content.categoryTopics)}`,
    `明确排除：${JSON.stringify(input.task.content.excludedContent)}`,
    `当前已知品牌：${JSON.stringify(landscape.brands.map((brand) => ({ name: brand.name, aliases: brand.aliases })))}`,
    `previousQueries：${JSON.stringify(previousQueries)}`,
    `用户本轮修订要求：${JSON.stringify(input.instruction ?? "首次制定计划")}`,
    finalAnswerRule(),
  ].join("\n\n");
}

export function brandMappingPrompt(
  input: RuntimeInput,
  brands: BrandLandscapeStage["brands"],
) {
  return [
    commonPreamble(),
    "本轮只做第二阶段的一个品牌批次：逐品牌核对官网、官方品类/型号目录、参数页和说明书入口。不要输出最终 Crawl Plan，也不要处理本批次以外的既有品牌。",
    `本批品牌：${JSON.stringify(brands)}`,
    "每个品牌必须恰好返回一次。planned 把官网检索写入 officialMappingPasses、参数/说明书检索写入 parameterAndManualPasses，并把每个明确的官方公开 URL 同时写入 officialSourceUrls 与 sources.targets；unresolved 的 officialMappingPasses 至少保留两条不同官网查询，officialSourceUrls 必须为空，parameterAndManualPasses 可为空。不要把一个品牌的证据写入另一个品牌。",
    "sources 只允许 brand_official。每个 target 都要给出一个已核实的公开 HTTPS 种子 URL，并从任务原文 topic 中选择真实相关的 taskTopics；HTML 品类/产品入口写 html，PDF/可下载文档写 document。同一 URL 在整个批次只能出现一次；若一个官网页面同时服务同集团的多个品牌，只建立一个 source/target，让相关 planned 品牌共同引用该 URL，并合并真实 taskTopics，不能复制 target，也不要为去重臆造替代 URL。若采访候选要求说明书/PDF/附件，入口页与正文 URL 必须放在同一个 source 的不同 targets。Workbench 会把每个官网来源的首个 HTML 种子确定性组装为有界 site route，其余正文/附件保持 exact route；不要生成 source key、target key 或遍历参数。",
    "如果官网核对确实发现分母中遗漏的独立消费者品牌/子品牌，写入 additionalBrands，保留真实 query、evidenceUrls 和 finding；不要在当前批次替它生成映射，Workbench 会先重新核对品牌分母再排入后续批次。",
    `任务 topic（必须逐字引用）：${JSON.stringify(taskTopics(input.task))}`,
    `本批必须重新核实并作为实际 target 返回的确认候选：${JSON.stringify(brandStageCandidates(input.task, brands).map(projectCandidate))}`,
    `同 revision 历史官网来源仅作复核线索；只有本轮重新搜索核实且属于本批品牌的 URL 才能返回，不能无条件复制旧 source key：${JSON.stringify(previousSources(input).filter((item) => item.sourceKind === "brand_official"))}`,
    `用户本轮修订要求：${JSON.stringify(input.instruction ?? "首次制定计划")}`,
    finalAnswerRule(),
  ].join("\n\n");
}

export function marketCatalogPrompt(input: RuntimeInput, landscape: BrandLandscapeStage) {
  const catalogEvidence = landscape.passes
    .filter((pass) => pass.lens === "authoritative_directory" || pass.lens === "broad_market_catalog")
    .map((pass) => ({ lens: pass.lens, query: pass.query, evidenceUrls: pass.evidenceUrls,
      discoveredBrands: pass.discoveredBrands }));
  return [
    commonPreamble(),
    "本轮只核对跨品牌品类市场目录：它们用于发现品牌、型号、参数和站内产品页，不是品牌官网，也不代替标准或技术原理来源。不输出品牌分母、官网映射或最终 Crawl Plan。",
    "sources 只允许 other 或 retailer；每个 source 只返回一个已核实的公开 HTTPS 品类入口，且 URL 必须逐字来自品牌发现的 authoritative_directory/broad_market_catalog 证据。Workbench 会把它组装成有页数、深度、频控和内容验收门的 site route。",
    "排除搜索结果页、排行榜文章、需要登录/风控对抗的入口和无明确品类边界的首页。用户指定的目录线索必须本轮 web search 复核；若它已在证据中且公开可识别，应成为实际 source target。",
    `任务 topic（必须逐字引用）：${JSON.stringify(taskTopics(input.task))}`,
    `已核对的目录证据：${JSON.stringify(catalogEvidence)}`,
    `用户本轮修订要求：${JSON.stringify(input.instruction ?? "首次制定计划")}`,
    finalAnswerRule(),
  ].join("\n\n");
}

export function knowledgeSourcesPrompt(input: RuntimeInput) {
  return [
    commonPreamble(),
    "本轮只做第三阶段：补齐国家/行业标准或监管来源，以及能解释参数、关键部件和技术路线的权威技术原理来源。不要输出品牌分母或最终 Crawl Plan。",
    "至少形成一个 regulator/standards_body 来源和一个 technical_publisher/industry_organization 来源。搜索结果页不能作为执行入口；source.targets 必须给精确公开正文 URL。PDF/表格正文使用 document 并单列 target，普通网页使用 html。",
    "每个 target 从任务原文 topic 中选择真正相关的 taskTopics。不要生成 source key 或 target key，Workbench 会确定性生成。采访中已有的非京东候选 URL 必须成为同 source 的实际 target；不能只在文字中提及。",
    `任务 topic（必须逐字引用）：${JSON.stringify(taskTopics(input.task))}`,
    `本阶段必须重新核实并作为实际 target 返回的确认候选：${JSON.stringify(knowledgeStageCandidates(input.task).map(projectCandidate))}`,
    `同 revision 历史非品牌来源仅作复核线索；只有本轮重新搜索核实的 URL 才能返回：${JSON.stringify(previousSources(input).filter((item) => item.sourceKind !== "brand_official"))}`,
    `用户本轮修订要求：${JSON.stringify(input.instruction ?? "首次制定计划")}`,
    finalAnswerRule(),
  ].join("\n\n");
}

function commonPreamble() {
  return [
    "$plan-product-crawl 请严格执行该 Skill。Skill 已由 Workbench 注入；不要读取仓库、AGENTS.md 或 Git 状态。",
    "你只规划公开来源，不运行正式抓取、不登录、不下载文件、不访问 Cookie/Profile。必须使用真实 web search；搜索发现只表示 search_discovered/unknown。当前正式计划排除京东及 *.jd.com。",
  ].join("\n");
}

function finalAnswerRule() {
  return "commentary 用普通中文持续说明搜索和判断；final_answer 只返回符合本轮 outputSchema 的 JSON 对象，不加 Markdown 代码块。";
}

function taskTopics(task: CaptureTask) {
  return [...task.content.generalTopics, ...task.content.categoryTopics];
}

function projectCandidate(candidate: CaptureTask["content"]["sourceCandidates"][number]) {
  return {
    id: candidate.id, name: candidate.name, publisher: candidate.publisher,
    sourceKind: candidate.sourceKind, exactEntryUrl: candidate.entryUrl,
    expectedContents: candidate.expectedContents, observedFormats: candidate.observedFormats,
  };
}

function previousSources(input: RuntimeInput) {
  const byKey = new Map<string, ReturnType<typeof projectSource>>();
  for (const plan of input.previousPlans.filter((item) => item.taskRevision === input.task.revision)) {
    for (const source of plan.content.sources) {
      if (source.provider.key !== "public.web-resource" || source.entryUrls.some(isExcludedPlanningUrl)) continue;
      if (!byKey.has(source.key)) byKey.set(source.key, projectSource(source));
    }
  }
  return [...byKey.values()];
}

function projectSource(source: CrawlPlan["content"]["sources"][number]) {
  return {
    key: source.key, name: source.name, publisher: source.publisher,
    sourceKind: source.sourceKind, entryUrls: source.entryUrls,
    sourceCandidateIds: source.sourceCandidateIds,
    targets: source.targets.map((target) => ({ name: target.name, taskTopics: target.taskTopics,
      configuration: target.providerConfiguration })),
  };
}
