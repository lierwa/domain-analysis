import type {
  KnowledgeFactoryModule,
  KnowledgeReviewModule,
} from "@domain-analysis/workbench";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerKnowledgeRoutes } from "../src/routes/knowledgeRoutes";

describe("Knowledge Factory / Review HTTP contract", () => {
  it("运行批次、读取详情并提交不可变审核决定", async () => {
    const { factory, review, batch } = fakes();
    const app = Fastify();
    await registerKnowledgeRoutes(app, factory, review);

    const run = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-1/knowledge-batches",
      payload: {
        categoryDefinitionVersionId: "definition-1",
        recipeVersion: "recipe-v1",
        evidenceRequestIds: ["request-1"],
      },
    });
    expect(run.statusCode).toBe(201);
    expect(factory.run).toHaveBeenCalledWith({
      projectId: "project-1",
      categoryDefinitionVersionId: "definition-1",
      recipeVersion: "recipe-v1",
      evidenceRequestIds: ["request-1"],
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/product-projects/project-1/knowledge-batches/${batch.batch.id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().item.batch.id).toBe(batch.batch.id);

    const submitted = await app.inject({
      method: "POST",
      url: `/api/knowledge-batches/${batch.batch.id}/reviews`,
      payload: {
        reviewer: "local-reviewer",
        rationale: "证据与字段一致",
        grouping: { categoryDefinitionVersionId: "definition-1" },
        selection: { action: "accept_candidates", targetIds: ["candidate-1"] },
      },
    });
    expect(submitted.statusCode).toBe(201);
    expect(review.decide).toHaveBeenCalledWith(expect.objectContaining({
      batchId: batch.batch.id,
      selection: { action: "accept_candidates", targetIds: ["candidate-1"] },
    }));
    await app.close();
  });

  it("拒绝跨项目读取知识批次", async () => {
    const { factory, review, batch } = fakes();
    const app = Fastify();
    await registerKnowledgeRoutes(app, factory, review);
    const response = await app.inject({
      method: "GET",
      url: `/api/product-projects/project-2/knowledge-batches/${batch.batch.id}`,
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

function fakes() {
  const batch = {
    batch: {
      id: "batch-1",
      projectId: "project-1",
      categoryDefinitionVersionId: "definition-1",
      recipeVersion: "recipe-v1",
      inputHash: "a".repeat(64),
      evidenceRequestIds: ["request-1"],
      status: "completed",
      candidateCount: 1,
      conflictCount: 0,
      unknownCount: 0,
      createdAt: "2026-08-17T10:00:00.000Z",
      finishedAt: "2026-08-17T10:00:00.000Z",
    },
    candidates: [],
    conflicts: [],
    unknowns: [],
  } as const;
  const factory = {
    run: vi.fn(async () => batch),
    get: vi.fn(async () => batch),
    listProject: vi.fn(async () => [batch]),
  } as unknown as KnowledgeFactoryModule & Record<"run" | "get" | "listProject", ReturnType<typeof vi.fn>>;
  const review = {
    decide: vi.fn(async (input: Record<string, unknown>) => ({ id: "decision-1", ...input })),
    listBatch: vi.fn(async () => []),
    listReviewed: vi.fn(async () => []),
  } as unknown as KnowledgeReviewModule & Record<"decide" | "listBatch" | "listReviewed", ReturnType<typeof vi.fn>>;
  return { factory, review, batch };
}
