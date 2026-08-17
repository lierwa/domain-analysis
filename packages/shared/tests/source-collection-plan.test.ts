import {
  sourceCollectionPlanSchema,
  type SourceCollectionPlan,
} from "../src/source-collection-plan";
import { describe, expect, it } from "vitest";

describe("Source Collection plan contract", () => {
  it("requires every ready lane to preserve target and knowledge-purpose bindings", () => {
    const plan = sourceCollectionPlanSchema.parse(fixturePlan());

    expect(plan.content.lanes[0]!.batches[0]!.workItems[0]).toMatchObject({
      targetKeys: ["category:television"],
      knowledgeNeedIds: ["need-display-mechanism"],
    });
  });

  it("rejects a ready lane that hides an unresolved planning issue", () => {
    const input = fixturePlan();
    input.content.lanes[0]!.issues.push({
      code: "planning_rule_missing",
      message: "没有来源能力",
    });

    expect(() => sourceCollectionPlanSchema.parse(input)).toThrow("ready 路线必须有批次且不能有问题");
  });
});

function fixturePlan(): SourceCollectionPlan {
  return {
    id: "plan-television-v1",
    projectId: "project-television",
    projectRevision: 1,
    categoryDefinitionVersionId: "definition-television-v1",
    confirmedScopeVersionId: "scope-television-v1",
    collectionBoardVersionId: "board-television-v1",
    contentHash: "a".repeat(64),
    content: {
      recipeVersion: "source-planner-v1",
      confirmedBriefId: "brief-television-v1",
      lanes: [{
        collectionLaneId: "lane-technical",
        sourceAuthorityType: "government_research",
        status: "ready",
        issues: [],
        batches: [{
          key: "batch-public-web",
          providerKey: "public-web-source",
          accessPolicy: { kind: "manual", version: "public-web-v1" },
          workItems: [{
            id: "item-technical",
            object: {
              sourceIdentity: "nist-technical-series",
              kind: "document",
              externalKey: "reference-technical",
            },
            requestedUrl: "https://example.com/technical",
            targetKeys: ["category:television"],
            knowledgeNeedIds: ["need-display-mechanism"],
            parsing: { adapterId: "public-web-source", adapterVersion: "v1" },
            claimScopes: ["foundational_principle"],
            usagePermission: {
              localRead: "allowed",
              modelInput: "allowed",
              evidenceStorage: "allowed",
              derivedKnowledgePublication: "allowed",
              sourceRedistribution: "unknown",
              basis: "fixture policy",
            },
          }],
        }],
      }],
    },
    createdAt: "2026-08-17T10:00:00.000Z",
  };
}
