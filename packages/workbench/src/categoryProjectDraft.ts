import type {
  CategoryResearchBriefVersion,
  ProductProjectDraftInput,
} from "@domain-analysis/shared";

export function projectDraftFromBrief(
  brief: CategoryResearchBriefVersion,
  confirmedBriefId: string,
): ProductProjectDraftInput {
  const content = brief.content;
  return {
    name: `${content.category.label}品类知识项目`,
    knowledgeTopic: content.objective,
    market: content.category.market,
    categoryDefinition: {
      categoryCode: content.category.code,
      label: content.category.label,
      sourceAuthorityPolicy: content.sourcePolicy.authorityTypes,
      ...content.categoryFramework,
    },
    confirmedScope: {
      populationLayers: content.targetPopulation.populationLayers,
      targets: content.targetPopulation.targets.map((target) => ({
        ...target,
        // WHY：此处引用的是用户确认的范围依据，不冒充尚未发生的来源采集证据。
        evidenceReferenceIds: [confirmedBriefId],
      })),
    },
    collectionBoard: { lanes: content.collectionLanes },
  };
}
