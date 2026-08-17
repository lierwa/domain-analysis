import {
  productProjectDraftInputSchema,
  type ProductProjectView
} from "@domain-analysis/shared";
import type { z } from "zod";

export type DraftFormInput = z.input<typeof productProjectDraftInputSchema>;
export type DraftFormOutput = z.output<typeof productProjectDraftInputSchema>;

export function draftFromView(view: ProductProjectView): DraftFormInput {
  const { project, categoryDefinition, confirmedScope, collectionBoard } = view;
  return {
    projectId: project.id,
    expectedRevision: project.revision,
    name: project.name,
    knowledgeTopic: project.knowledgeTopic,
    market: project.market,
    categoryDefinition: {
      categoryCode: categoryDefinition.categoryCode,
      label: categoryDefinition.label,
      sourceAuthorityPolicy: [...categoryDefinition.sourceAuthorityPolicy],
      attributes: categoryDefinition.attributes.map((attribute) => ({ ...attribute })),
      decisionDimensions: categoryDefinition.decisionDimensions.map((dimension) => ({ ...dimension })),
      competencyQuestions: [...categoryDefinition.competencyQuestions]
    },
    confirmedScope: {
      populationLayers: [...confirmedScope.populationLayers],
      targets: confirmedScope.targets.map((target) => ({ ...target }))
    },
    collectionBoard: {
      lanes: collectionBoard.lanes.map((lane) => ({ ...lane }))
    }
  };
}

export function linesToValues(value: string) {
  const values = value.split("\n").map((item) => item.trim()).filter(Boolean);
  return values.length > 0 ? values : [];
}
