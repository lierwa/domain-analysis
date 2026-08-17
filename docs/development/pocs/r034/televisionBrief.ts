import type { CategoryResearchBriefContent } from "@domain-analysis/shared";

export const televisionSources = {
  definition: "https://www.energy.gov/cmei/buildings/television-sets",
  efficiency: "https://www.energy.gov/cmei/femp/purchasing-energy-efficient-televisions",
  displayArchitecture: "https://www.energy.gov/sites/default/files/2022-05/ssl-displays-rdmeeting-feb22.pdf",
  modelIndex: "https://data.energystar.gov/resource/8wj2-sec8.json?pd_id=2399940&$limit=1",
} as const;

export function televisionBrief(decisionId: string): CategoryResearchBriefContent {
  return {
    category: { code: "television", label: "电视", market: "US" },
    objective: "验证电视底层概念、品类决策知识和真实型号身份可走同一知识生产链。",
    audience: "需要理解产品原理并选择合适型号的消费者与 Agent",
    priorityScenarios: ["理解电视定义、显示机制与能效取舍", "查询真实认证型号"],
    excludedScope: ["价格、库存、评价与未经授权商业站点"],
    knowledgeNeeds: [{
      id: "need:television-definition",
      question: "什么条件构成电视机，适用边界是什么？",
      knowledgeLayers: ["identity"],
      priority: "must",
    }, {
      id: "need:display-architecture",
      question: "LCD 与 OLED 的成像架构、适用条件和主要取舍是什么？",
      knowledgeLayers: ["mechanism"],
      priority: "must",
    }, {
      id: "need:television-efficiency",
      question: "电视全生命周期节能收益应怎样与购置溢价比较？",
      knowledgeLayers: ["decision"],
      priority: "must",
    }, {
      id: "need:model-number",
      question: "ENERGY STAR 记录 2399940 对应哪个厂家型号？",
      knowledgeLayers: ["identity"],
      priority: "must",
    }],
    categoryFramework: {
      attributes: [{
        code: "identity.model_number",
        label: "厂家型号",
        description: "监管或认证记录中的厂家型号",
        knowledgeLayer: "identity",
        valueKind: "text",
        externalMappings: ["model_number"],
        filterable: true,
        comparable: false,
      }],
      decisionDimensions: [{
        code: "energy_and_viewing",
        label: "能耗与观看体验",
        description: "亮度、背光控制与能耗之间的适用条件和取舍",
        relatedAttributeCodes: ["identity.model_number"],
      }],
      competencyQuestions: [
        "什么条件构成电视机，适用边界是什么？",
        "LCD 与 OLED 的成像架构、适用条件和主要取舍是什么？",
        "电视全生命周期节能收益应怎样与购置溢价比较？",
      ],
    },
    targetPopulation: {
      populationLayers: ["regulatory_registry", "official_current_catalog"],
      targets: [{
        key: "category:television",
        kind: "category",
        label: "电视",
        disposition: "included",
        reason: "承载品类边界和对底层概念的证据关系。",
      }, {
        key: "concept:television-definition",
        kind: "foundational_concept",
        label: "电视机定义与边界",
        parentKey: "category:television",
        disposition: "included",
        reason: "底层概念必须独立于品牌和型号表达。",
      }, {
        key: "concept:display-architecture",
        kind: "foundational_concept",
        label: "LCD 与 OLED 显示架构",
        parentKey: "category:television",
        disposition: "included",
        reason: "用机制、条件和取舍验证非结构化知识加工。",
      }, {
        key: "concept:lifecycle-cost-effectiveness",
        kind: "foundational_concept",
        label: "全生命周期成本有效性",
        parentKey: "category:television",
        disposition: "included",
        reason: "把购置溢价、使用条件和长期节能收益作为决策知识。",
      }, {
        key: "model:energy-star:2399940",
        kind: "model",
        label: "ENERGY STAR pd_id 2399940",
        parentKey: "category:television",
        disposition: "included",
        reason: "EPA 公开模型索引中的真实电视记录。",
      }],
    },
    sourcePolicy: {
      authorityTypes: ["government_research", "regulatory_source"],
      accessModes: ["public_web", "document"],
      freshnessPolicy: "manual",
      stopConditions: ["access_denied", "source_abnormal"],
    },
    collectionLanes: [{
      id: "lane:television:government-research",
      sourceAuthorityType: "government_research",
      accessMode: "public_web",
      targetKeys: [
        "category:television",
        "concept:television-definition",
        "concept:lifecycle-cost-effectiveness",
      ],
      knowledgeLayers: ["identity", "mechanism", "decision"],
      refreshPolicy: "manual",
      stopConditions: ["access_denied", "source_abnormal"],
    }, {
      id: "lane:television:government-document",
      sourceAuthorityType: "government_research",
      accessMode: "document",
      targetKeys: ["category:television", "concept:display-architecture"],
      knowledgeLayers: ["mechanism"],
      refreshPolicy: "manual",
      stopConditions: ["access_denied", "source_abnormal"],
    }, {
      id: "lane:television:regulatory",
      sourceAuthorityType: "regulatory_source",
      accessMode: "public_web",
      targetKeys: ["model:energy-star:2399940"],
      knowledgeLayers: ["identity"],
      refreshPolicy: "manual",
      stopConditions: ["access_denied", "source_abnormal"],
    }],
    sourceAssignments: [{
      collectionLaneId: "lane:television:government-research",
      factReferenceId: "source:doe:television-definition",
      knowledgeNeedIds: ["need:television-definition"],
    }, {
      collectionLaneId: "lane:television:government-document",
      factReferenceId: "source:doe:display-architecture",
      knowledgeNeedIds: ["need:display-architecture"],
      request: {
        kind: "document_excerpt",
        requiredIdentityText: "Display Architecture Performance and Efficiency",
        requiredSectionTerms: [
          "Liquid crystal displays (LCDs)",
          "light emitting diode (LED) backlight",
        ],
        section: "Display Architecture Performance and Efficiency",
        maximumSourceBytes: 20 * 1024 * 1024,
        maximumExcerptBytes: 256 * 1024,
      },
    }, {
      collectionLaneId: "lane:television:government-research",
      factReferenceId: "source:doe:television-efficiency",
      knowledgeNeedIds: ["need:television-efficiency"],
    }, {
      collectionLaneId: "lane:television:regulatory",
      factReferenceId: "source:epa:model-index:2399940",
      knowledgeNeedIds: ["need:model-number"],
      request: {
        kind: "structured_record_lookup",
        fields: [{ code: "pd_id", value: "2399940" }],
        maximumBytes: 40_000,
      },
    }],
    acceptanceCriteria: [
      "三个真实来源逐条持久化并形成最小证据",
      "底层概念候选由固定模型禁网生成且只引用输入 Evidence ID",
      "人工接受后构建可复制、可校验、离线只读知识包",
    ],
    decisionIds: [decisionId],
    factReferences: [{
      id: "source:doe:television-definition",
      label: "DOE Television Sets",
      url: televisionSources.definition,
      sourceAuthorityType: "government_research",
      observedAt: "2026-08-17T00:00:00.000Z",
    }, {
      id: "source:doe:display-architecture",
      label: "DOE Displays R&D Meeting Report",
      url: televisionSources.displayArchitecture,
      sourceAuthorityType: "government_research",
      observedAt: "2026-08-17T00:00:00.000Z",
    }, {
      id: "source:doe:television-efficiency",
      label: "DOE Purchasing Energy-Efficient Televisions",
      url: televisionSources.efficiency,
      sourceAuthorityType: "government_research",
      observedAt: "2026-08-17T00:00:00.000Z",
    }, {
      id: "source:epa:model-index:2399940",
      label: "EPA ENERGY STAR Model Index",
      url: televisionSources.modelIndex,
      sourceAuthorityType: "regulatory_source",
      observedAt: "2026-08-17T00:00:00.000Z",
    }],
    investigatedFacts: ([
      "brand", "model", "parameter", "component", "mechanism", "source_entrypoint",
    ] as const).map((kind) => ({
      id: `investigated:${kind}`,
      kind,
      statement: `${kind} 的本轮范围、真实来源和未知边界已调查`,
      factReferenceIds: [
        "source:doe:television-definition",
        "source:doe:display-architecture",
        "source:doe:television-efficiency",
        "source:epa:model-index:2399940",
      ],
    })),
  };
}
