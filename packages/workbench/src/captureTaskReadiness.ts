import type { CaptureTaskContent } from "@domain-analysis/shared";

export const professionalShoppingGuideTopics = [
  "多品牌、多型号的在售商品、价格与用户评价",
  "品牌官方配置参数、说明书与源站媒体",
  "国家标准、监管、能效与认证",
  "关键部件、技术路线与底层工作原理",
] as const;

const requiredSourceRoles = [
  { label: "核心零售/市场平台", kinds: ["retailer"] },
  { label: "品牌官网、官方目录或说明书", kinds: ["brand_official"] },
  { label: "国家标准或监管来源", kinds: ["standards_body", "regulator"] },
  { label: "权威技术原理来源", kinds: ["technical_publisher", "industry_organization"] },
] as const;

export function applyProfessionalShoppingGuideDefaults(content: CaptureTaskContent): CaptureTaskContent {
  return {
    ...content,
    // WHY：这些内容是产品服务专业导购 Agent 的固定目标，不是每个品类都重新询问负责人的可选字段。
    generalTopics: [...new Set([...professionalShoppingGuideTopics, ...content.generalTopics])],
  };
}

export function findCaptureTaskReadinessGaps(content: CaptureTaskContent): string[] {
  const kinds = new Set(content.sourceCandidates.map((candidate) => candidate.sourceKind));
  const gaps: string[] = requiredSourceRoles
    .filter((requirement) => !requirement.kinds.some((kind) => kinds.has(kind)))
    .map((requirement) => requirement.label);
  const brandOrigins = new Set(content.sourceCandidates
    .filter((candidate) => candidate.sourceKind === "brand_official")
    .map((candidate) => new URL(candidate.entryUrl).origin));
  if (brandOrigins.size === 1) gaps.push("至少两个独立品牌官网");
  if (content.jd.disposition === "included" && !content.sourceCandidates.some(isJdCandidate)) {
    gaps.push("京东具体类目或品牌入口");
  }
  return gaps;
}

function isJdCandidate(candidate: CaptureTaskContent["sourceCandidates"][number]) {
  const hostname = new URL(candidate.entryUrl).hostname.toLowerCase();
  return hostname === "jd.com" || hostname.endsWith(".jd.com");
}
