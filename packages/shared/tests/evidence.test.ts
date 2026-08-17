import { describe, expect, it } from "vitest";

import {
  evidenceCandidateSchema,
  evidenceRequestDraftSchema,
  sourceObservationDraftSchema,
} from "../src/evidence";

describe("minimal evidence contracts", () => {
  it("requires a versioned purpose and a feasible evidence policy", () => {
    const request = requestDraft();
    expect(evidenceRequestDraftSchema.parse(request)).toEqual(request);
    expect(() => evidenceRequestDraftSchema.parse({
      ...request,
      minimumEvidenceItemsPerTarget: 1,
      minimumDistinctSourcesPerTarget: 2,
    })).toThrow("独立来源数量不能大于最小证据数量");
  });

  it("rejects a URL-only text candidate without exact contextual evidence", () => {
    expect(() => evidenceCandidateSchema.parse({
      requestId: "request-1",
      observationId: "observation-1",
      kind: "web_text",
      mediaType: "text/plain",
      privacyClass: "public",
      subjectKeys: ["brand:midea"],
      relationProof: { method: "explicit_identifier", detail: "页面标题明确写明目标型号" },
      locator: {
        kind: "web_text",
        quote: { exact: "微波输出功率为 900 W" },
      },
    })).toThrow("文本证据必须保留前文或后文以便消歧");
  });

  it("requires failed observations to use a typed matching reason", () => {
    expect(() => sourceObservationDraftSchema.parse({
      requestId: "request-1",
      subjectKeys: ["brand:midea"],
      sourceIdentity: "official-site:example.com",
      sourceAuthorityType: "brand_official_site",
      requestedUrl: "https://example.com/product",
      observedAt: "2026-08-15T08:00:00.000Z",
      state: "verification_required",
      failureCode: "access_denied",
    })).toThrow("失败状态必须记录同名失败码");
  });
});

function requestDraft() {
  return {
    projectId: "project-1",
    categoryDefinitionVersionId: "definition-1",
    confirmedScopeVersionId: "scope-1",
    collectionBoardVersionId: "board-1",
    collectionLaneIds: ["lane-official"],
    knowledgeNeed: { id: "need-power", kind: "attribute" as const, attributeCode: "heating.power" },
    question: "该型号标称微波输出功率是多少？",
    knowledgeLayer: "specification" as const,
    targetKeys: ["brand:midea"],
    allowedSourceAuthorityTypes: ["brand_official_site" as const],
    acceptedEvidenceKinds: ["web_text" as const],
    evidenceByteLimits: { web_text: 4096 },
    freshness: { maxAgeDays: 30 },
    minimumEvidenceItemsPerTarget: 1,
    minimumDistinctSourcesPerTarget: 1,
    evidencePolicyVersion: "policy-1",
    stopConditions: ["access_denied" as const],
    priority: 50,
  };
}
