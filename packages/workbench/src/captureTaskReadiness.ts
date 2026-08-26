import type { CaptureTaskContent } from "@domain-analysis/shared";

export const professionalShoppingGuideTopics = [
  "多品牌、多型号的在售商品、价格与用户评价",
  "品牌官方配置参数、说明书与源站媒体",
  "国家标准、监管、能效与认证",
  "关键部件、技术路线与底层工作原理",
] as const;

export function applyProfessionalShoppingGuideDefaults(content: CaptureTaskContent): CaptureTaskContent {
  return {
    ...content,
    // WHY：这些内容是产品服务专业导购 Agent 的固定目标，不是每个品类都重新询问负责人的可选字段。
    generalTopics: [...new Set([...professionalShoppingGuideTopics, ...content.generalTopics])],
  };
}
