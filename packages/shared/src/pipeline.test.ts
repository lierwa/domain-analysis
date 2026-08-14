import { describe, expect, it } from "vitest";

import { pipelineCommandSchema, pipelineRunViewSchema, startPipelineInputSchema } from "./pipeline";

const hash = "b".repeat(64);
const timestamp = "2026-08-14T00:00:00.000Z";

describe("pipeline contract", () => {
  it("freezes every versioned project input before start", () => {
    const parsed = startPipelineInputSchema.parse({ input: frozenInput, requestedBy: "user-1" });
    expect(parsed.input.collectionBoardHash).toBe(hash);
  });

  it("keeps lifecycle separate from current stage", () => {
    const view = pipelineRunViewSchema.parse({
      id: "run-1",
      workflowId: "workflow-1",
      input: frozenInput,
      lifecycleStatus: "waiting_user",
      currentStage: "review",
      stages: [{ id: "stage-1", stage: "review", status: "waiting_user", attemptCount: 1 }],
      interventions: [{
        id: "intervention-1",
        stageExecutionId: "stage-1",
        kind: "review",
        status: "open",
        prompt: "请处理证据冲突",
        createdAt: timestamp,
      }],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(view.lifecycleStatus).toBe("waiting_user");
    expect(view.currentStage).toBe("review");
  });

  it("accepts business commands without exposing DBOS message shapes", () => {
    expect(pipelineCommandSchema.parse({
      type: "resolve_intervention",
      interventionId: "intervention-1",
      resolutionId: "review-decision-1",
    }).type).toBe("resolve_intervention");
  });

  it("rejects waiting_user without an open intervention", () => {
    expect(pipelineRunViewSchema.safeParse({
      id: "run-1",
      workflowId: "workflow-1",
      input: frozenInput,
      lifecycleStatus: "waiting_user",
      currentStage: "review",
      stages: [{ id: "stage-1", stage: "review", status: "waiting_user", attemptCount: 1 }],
      interventions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }).success).toBe(false);
  });
});

const frozenInput = {
  projectId: "project-1",
  projectRevision: 1,
  categoryDefinitionVersionId: "category-1",
  categoryDefinitionHash: hash,
  confirmedScopeVersionId: "scope-1",
  confirmedScopeHash: hash,
  collectionBoardVersionId: "board-1",
  collectionBoardHash: hash,
};
