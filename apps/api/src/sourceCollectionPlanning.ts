import type { SourceCollectionPlanningRule } from "@domain-analysis/workbench";

const publicResearchPolicy = {
  kind: "paced_http" as const,
  version: "public-research-poc-v1",
  maxRequestsPerMinute: 10,
  minimumIntervalMs: 6_000,
  jitterMs: { min: 500, max: 1_500 },
  batchSize: 5,
  batchCooldownMs: 60_000,
  maximumRunMs: 15 * 60_000,
};

export function createProductionSourceCollectionPlanningRules(
  allowedOrigins: readonly string[],
): SourceCollectionPlanningRule[] {
  const allowed = new Set(allowedOrigins.map((value) => new URL(value).origin));
  // WHY：规则按已核对的具体资料授权，不把同域第三方材料自动升级为可保存/可加工。
  return researchRules().filter((rule) => {
    const value = rule.urlMatch.kind === "origin" ? rule.urlMatch.origin : rule.urlMatch.url;
    // 被明确禁止的入口仍保留为 Planner waiting 证据；它永远不会形成可执行批次。
    return rule.usagePermission.localRead !== "allowed" || allowed.has(new URL(value).origin);
  });
}

function researchRules(): SourceCollectionPlanningRule[] {
  return [
    nistRule(
      "nist-cycle-d-hx-page-v1",
      "https://www.nist.gov/publications/cycled-hx-nist-vapor-compression-cycle-model-accounting-refrigerant-thermodynamic-and",
    ),
    usdaRule(
      "usda-refrigeration-food-safety-v1",
      "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/refrigeration",
    ),
    usdaRule(
      "usda-freezing-food-safety-v1",
      "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/freezing-and-food-safety",
    ),
    doeRule(
      "doe-television-definition-v1",
      "https://www.energy.gov/cmei/buildings/television-sets",
      "doe-television-definition",
    ),
    doeRule(
      "doe-television-efficiency-guidance-v1",
      "https://www.energy.gov/cmei/femp/purchasing-energy-efficient-televisions",
      "doe-television-efficiency-guidance",
    ),
    doeDisplayArchitecturePdfRule(),
    epaEnergyStarModelIndexRule(),
    energyLabelRule(),
    blockedMideaManualRule(),
  ];
}

function doeDisplayArchitecturePdfRule(): SourceCollectionPlanningRule {
  return {
    id: "doe-display-architecture-report-v1",
    providerKey: "document-excerpt-source",
    sourceIdentity: "doe-display-architecture-report",
    sourceAuthorityType: "government_research",
    accessMode: "document",
    requestKinds: ["document_excerpt"],
    urlMatch: {
      kind: "exact_url",
      url: "https://www.energy.gov/sites/default/files/2022-05/ssl-displays-rdmeeting-feb22.pdf",
    },
    objectKind: "document",
    parsing: { adapterId: "unpdf-page-excerpt", adapterVersion: "1.8.1" },
    claimScopes: ["foundational_principle"],
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed",
      sourceRedistribution: "unknown",
      basis: "DOE 政府信息属于公有领域；报告页仍按最小证据保存并排除第三方材料再分发",
      basisUrl: "https://www.energy.gov/web-policies",
    },
    accessPolicy: publicResearchPolicy,
  };
}

function doeRule(id: string, url: string, sourceIdentity: string): SourceCollectionPlanningRule {
  return {
    ...baseResearchRule(id, url, sourceIdentity),
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed",
      sourceRedistribution: "unknown",
      basis: "DOE 官方机构页面允许最小证据与派生知识；不默认再分发整页或第三方材料",
      basisUrl: "https://www.energy.gov/web-policies",
    },
  };
}

function epaEnergyStarModelIndexRule(): SourceCollectionPlanningRule {
  return {
    id: "epa-energy-star-model-index-v1",
    providerKey: "socrata-open-data",
    sourceIdentity: "epa-energy-star-model-index",
    sourceAuthorityType: "regulatory_source",
    accessMode: "public_web",
    requestKinds: ["structured_record_lookup"],
    urlMatch: { kind: "origin", origin: "https://data.energystar.gov" },
    objectKind: "regulatory_record",
    parsing: { adapterId: "socrata-open-data", adapterVersion: "2.1" },
    claimScopes: ["standard_or_regulatory", "model_fact"],
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed",
      sourceRedistribution: "allowed",
      basis: "EPA Standard Open Data License 明确 EPA 生产数据默认属于公有领域",
      basisUrl: "https://edg.epa.gov/EPA_Data_License.html",
    },
    accessPolicy: publicResearchPolicy,
  };
}

function nistRule(id: string, url: string): SourceCollectionPlanningRule {
  return {
    ...baseResearchRule(id, url, "nist-technical-series"),
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed",
      sourceRedistribution: "unknown",
      basis: "NIST Technical Series 政府职务作品许可；仍需逐资料排除第三方材料",
      basisUrl: "https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications",
    },
  };
}

function usdaRule(id: string, url: string): SourceCollectionPlanningRule {
  return {
    ...baseResearchRule(id, url, "usda-fsis-food-safety"),
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed",
      sourceRedistribution: "unknown",
      basis: "USDA 政府信息通常为公有领域；仍需逐资料排除第三方材料",
      basisUrl: "https://www.nal.usda.gov/web-policies-and-important-links",
    },
  };
}

function baseResearchRule(
  id: string,
  url: string,
  sourceIdentity: string,
): Omit<SourceCollectionPlanningRule, "usagePermission"> {
  return {
    id,
    providerKey: "readable-technical-source",
    sourceIdentity,
    sourceAuthorityType: "government_research",
    accessMode: "public_web",
    requestKinds: ["full_resource"],
    urlMatch: { kind: "exact_url", url },
    objectKind: "document",
    parsing: { adapterId: "mozilla-readability", adapterVersion: "0.6.0" },
    claimScopes: ["foundational_principle"],
    accessPolicy: publicResearchPolicy,
  };
}

function energyLabelRule(): SourceCollectionPlanningRule {
  return {
    id: "china-energy-label-record-v1",
    providerKey: "energy-label-record",
    sourceIdentity: "china-energy-label-public-registration",
    sourceAuthorityType: "regulatory_source",
    accessMode: "public_web",
    requestKinds: ["structured_record_lookup"],
    urlMatch: { kind: "origin", origin: "https://www.energylabel.com.cn" },
    objectKind: "regulatory_record",
    parsing: { adapterId: "china-energy-label-public-api", adapterVersion: "2026-08-16" },
    claimScopes: ["standard_or_regulatory", "model_fact"],
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed",
      sourceRedistribution: "unknown",
      basis: "R-026 已验证的无登录公开备案查询；只按已知型号查询并保存单条原始详情",
      basisUrl: "https://www.energylabel.com.cn/",
    },
    accessPolicy: publicResearchPolicy,
  };
}

function blockedMideaManualRule(): SourceCollectionPlanningRule {
  return {
    id: "midea-manual-blocked-2026-08-17",
    providerKey: "document-excerpt-source",
    sourceIdentity: "midea-official-manual",
    sourceAuthorityType: "official_manual",
    accessMode: "document",
    requestKinds: ["document_excerpt"],
    urlMatch: {
      kind: "exact_url",
      url: "https://dsdcp.smartmidea.net/mcsp/prod/20230803/6b0f37e5343a4abfba8c4a5274565d70.pdf",
    },
    objectKind: "document",
    parsing: { adapterId: "unpdf-page-excerpt", adapterVersion: "1.8.1" },
    claimScopes: ["model_fact", "component_application"],
    usagePermission: {
      localRead: "denied",
      modelInput: "denied",
      evidenceStorage: "denied",
      derivedKnowledgePublication: "unknown",
      sourceRedistribution: "denied",
      basis: "美的法律声明要求爬虫、下载、复制等使用取得书面许可；项目当前没有该许可",
      basisUrl: "https://www.midea.cn/act/help_center_new/transaction_terms?id=106&parentId=508",
    },
    accessPolicy: { kind: "manual", version: "permission-blocked-2026-08-17" },
  };
}
