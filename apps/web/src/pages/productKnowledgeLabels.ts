import type {
  knowledgeLayers,
  sourceAuthorityTypes,
  sourceClaimScopes,
} from "@domain-analysis/shared";

export const sourceAuthorityLabels: Record<(typeof sourceAuthorityTypes)[number], string> = {
  brand_official_site: "品牌官网",
  official_direct_retail: "官方直营",
  brand_flagship_store: "品牌旗舰店",
  official_manual: "官方说明书",
  regulatory_source: "监管来源",
  standards_body: "标准机构",
  government_research: "政府研究资料",
  intergovernmental_technical: "政府间技术资料",
  primary_research: "原始研究",
  professional_association: "专业协会",
  component_official_technical: "部件厂商技术资料"
};

export const sourceClaimScopeLabels: Record<(typeof sourceClaimScopes)[number], string> = {
  foundational_principle: "底层原理",
  standard_or_regulatory: "标准/监管",
  component_application: "部件应用",
  brand_claim: "品牌声明",
  model_fact: "型号事实",
  market_offer: "市场要约",
  user_experience: "用户体验",
};

export const knowledgeLayerLabels: Record<(typeof knowledgeLayers)[number], string> = {
  identity: "商品身份",
  specification: "配置参数",
  function: "功能作用",
  mechanism: "工作原理",
  decision: "购买决策",
  offer: "官方销售信息"
};

export const targetKindLabels = {
  foundational_concept: "底层概念",
  category: "品类",
  brand: "品牌",
  model: "型号",
  variant: "变体"
} as const;

export const accessModeLabels = {
  public_web: "公开网页",
  browser_session: "登录浏览器",
  licensed_api: "授权接口",
  document: "文档"
} as const;

export const refreshPolicyLabels = {
  manual: "手动刷新",
  on_source_change: "来源变化时刷新",
  daily: "每天刷新",
  weekly: "每周刷新",
  monthly: "每月刷新"
} as const;
