import { randomUUID } from "node:crypto";

import type {
  CommitSourceSnapshot,
  ProductProjectDraftInput,
} from "@domain-analysis/shared";

import type { ProductKnowledgeWorkbench } from "../../src/productKnowledgeWorkbench";

export interface CategoryFixture {
  categoryCode: string;
  label: string;
  attributeCode: string;
  attributeLabel: string;
  unit: string;
  targetKey: string;
  targetLabel: string;
}

export function orderedRecord(input: {
  runId: string;
  idempotencyKey: string;
  externalKey: string;
  title: string;
  fieldName: string;
  fieldValue: string;
  unit: string;
  url: string;
}): CommitSourceSnapshot & {
  content: Extract<NonNullable<CommitSourceSnapshot["content"]>, { kind: "ordered_record" }>;
} {
  return {
    runId: input.runId,
    idempotencyKey: input.idempotencyKey,
    object: {
      sourceIdentity: "fixture-brand-site",
      kind: "product" as const,
      externalKey: input.externalKey,
    },
    targetKeys: ["target:fixture"],
    knowledgeNeedIds: ["need:model-fact"],
    observation: {
      requestedUrl: input.url,
      finalUrl: input.url,
      observedAt: "2026-08-17T08:00:00.000Z",
      state: "accessible" as const,
    },
    content: {
      kind: "ordered_record" as const,
      title: input.title,
      fieldGroups: [{
        label: "规格参数",
        fields: [{ name: input.fieldName, value: input.fieldValue, unit: input.unit }],
      }],
      blocks: [],
    },
    parsing: { adapterId: "fixture-brand-adapter", adapterVersion: "1.0.0" },
    claimScopes: ["model_fact" as const],
    usagePermission: fixtureUsagePermission(),
    relations: [],
  };
}

export function fixtureUsagePermission() {
  return {
    localRead: "allowed" as const,
    modelInput: "allowed" as const,
    evidenceStorage: "allowed" as const,
    derivedKnowledgePublication: "allowed" as const,
    sourceRedistribution: "allowed" as const,
    basis: "项目自有测试夹具",
  };
}

export async function createConfirmedProject(
  target: ProductKnowledgeWorkbench,
  category: CategoryFixture,
) {
  const draft = await target.productProjects.saveDraft(projectDraft(category));
  return target.productProjects.confirm(draft.project.id, draft.project.revision);
}

export function laneId(categoryCode: string) {
  return `lane:${categoryCode}:official`;
}

export function manualAccessPolicy() {
  return { kind: "manual" as const, version: "fixture-policy-v1" };
}

export function deterministicProjectOptions() {
  const prefix = `source-dataset-project-${randomUUID()}`;
  const counters = { project: 0, definition: 0, scope: 0, board: 0 };
  return {
    now: () => new Date("2026-08-17T07:00:00.000Z"),
    createId: (kind: keyof typeof counters) => `${prefix}-${kind}-${++counters[kind]}`,
  };
}

export function deterministicSourceOptions() {
  const prefix = `source-dataset-${randomUUID()}`;
  const counters = { plan: 0, run: 0, object: 0, snapshot: 0, asset: 0 };
  return {
    now: () => new Date("2026-08-17T08:00:00.000Z"),
    createId: (kind: keyof typeof counters) => `${prefix}-${kind}-${++counters[kind]}`,
  };
}

function projectDraft(category: CategoryFixture): ProductProjectDraftInput {
  return {
    name: `${category.label}来源数据验证`,
    knowledgeTopic: `中国市场${category.label}商品知识`,
    market: "CN",
    categoryDefinition: {
      categoryCode: category.categoryCode,
      label: category.label,
      sourceAuthorityPolicy: ["brand_official_site"],
      attributes: [{
        code: category.attributeCode,
        label: category.attributeLabel,
        description: `${category.label}${category.attributeLabel}`,
        knowledgeLayer: "specification",
        valueKind: "decimal",
        canonicalUnitCode: category.unit,
        externalMappings: [],
        filterable: true,
        comparable: true,
      }],
      decisionDimensions: [{
        code: "product.comparison",
        label: "产品比较",
        description: `比较${category.label}的关键规格`,
        relatedAttributeCodes: [category.attributeCode],
      }],
      competencyQuestions: [`怎样比较${category.label}？`],
    },
    confirmedScope: {
      populationLayers: ["official_current_catalog"],
      targets: [{
        key: category.targetKey,
        kind: "brand",
        label: category.targetLabel,
        evidenceReferenceIds: [`scope:${category.categoryCode}`],
        disposition: "included",
        reason: "跨品类来源数据纵切片",
      }],
    },
    collectionBoard: {
      lanes: [{
        id: laneId(category.categoryCode),
        sourceAuthorityType: "brand_official_site",
        accessMode: "public_web",
        targetKeys: [category.targetKey],
        knowledgeLayers: ["identity", "specification"],
        refreshPolicy: "manual",
        stopConditions: ["access_denied", "source_abnormal"],
      }],
    },
  };
}
