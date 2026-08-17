import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  EvidenceCandidate,
  EvidenceRequestDraft,
  ProductProjectDraftInput,
} from "@domain-analysis/shared";
import { afterEach, describe, expect, it } from "vitest";

import { EvidenceError } from "../src/evidenceModule";
import {
  openProductKnowledgeWorkbench,
  type ProductKnowledgeWorkbench,
} from "../src/productKnowledgeWorkbench";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("EvidenceModule integration", () => {
  let workbench: ProductKnowledgeWorkbench | undefined;
  let evidenceRoot: string | undefined;

  afterEach(async () => {
    await workbench?.close();
    if (evidenceRoot) await rm(evidenceRoot, { recursive: true, force: true });
    workbench = undefined;
    evidenceRoot = undefined;
  });

  it("commits only minimal contextual text and derives sufficient coverage", async () => {
    const fixture = await createFixture();
    const request = await workbench!.evidence.createRequest(requestDraft(fixture, "need-power"));
    await expect(workbench!.evidence.createRequest(requestDraft(fixture, "need-power")))
      .resolves.toMatchObject({ id: request.id });
    await expect(workbench!.evidence.assess(request.id)).resolves.toMatchObject({
      status: "not_started",
      evidenceItemIds: [],
    });
    const observation = await workbench!.evidence.recordObservation({
      requestId: request.id,
      subjectKeys: ["brand:midea"],
      sourceIdentity: "official-site:example.com",
      sourceAuthorityType: "brand_official_site",
      requestedUrl: "https://example.com/products/midea-one",
      finalUrl: "https://example.com/products/midea-one",
      observedAt: "2026-08-15T08:00:00.000Z",
      state: "accessible",
      httpValidation: { status: 200, etag: "fixture-v1" },
    });
    const content = new TextEncoder().encode("规格：微波输出功率为 900 W，额定输入功率为 1350 W。");
    await expect(workbench!.evidence.commit(
      candidate(request.id, observation.id),
      new TextEncoder().encode(`页面导航和无关正文\n${new TextDecoder().decode(content)}`),
    )).rejects.toMatchObject({ code: "candidate_rejected" });
    const item = await workbench!.evidence.commit(candidate(request.id, observation.id), content);

    const replay = await workbench!.evidence.read(item.id);
    expect(new TextDecoder().decode(replay?.content)).toBe(new TextDecoder().decode(content));
    await expect(workbench!.evidence.assess(request.id)).resolves.toMatchObject({
      status: "sufficient",
      evidenceItemIds: [item.id],
      reasonCodes: [],
    });
    await expect(workbench!.evidence.listProject(fixture.project.id)).resolves.toEqual([
      expect.objectContaining({
        request: expect.objectContaining({ id: request.id }),
        sourceObservations: [expect.objectContaining({ id: observation.id })],
        evidenceItems: [expect.objectContaining({
          item: expect.objectContaining({ id: item.id }),
          contentText: new TextDecoder().decode(content),
        })],
      }),
    ]);
  });

  it("fails closed for empty content, inaccessible observations and weak image relations", async () => {
    const fixture = await createFixture();
    const textRequest = await workbench!.evidence.createRequest(requestDraft(fixture, "need-text"));
    const waiting = await workbench!.evidence.recordObservation({
      requestId: textRequest.id,
      subjectKeys: ["brand:midea"],
      sourceIdentity: "official-site:example.com",
      sourceAuthorityType: "brand_official_site",
      requestedUrl: "https://example.com/challenge",
      observedAt: "2026-08-15T08:00:00.000Z",
      state: "verification_required",
      failureCode: "verification_required",
    });
    await expect(workbench!.evidence.commit(
      candidate(textRequest.id, waiting.id),
      new Uint8Array(),
    )).rejects.toMatchObject({ code: "candidate_rejected" });
    await expect(workbench!.evidence.commit(
      candidate(textRequest.id, waiting.id),
      new TextEncoder().encode("规格：微波输出功率为 900 W，额定输入功率为 1350 W。"),
    )).rejects.toMatchObject({ code: "observation_not_accessible" });
    await expect(workbench!.evidence.assess(textRequest.id)).resolves.toMatchObject({
      status: "waiting",
      reasonCodes: expect.arrayContaining(["access_waiting"]),
    });

    const imageRequest = await workbench!.evidence.createRequest({
      ...requestDraft(fixture, "need-image"),
      acceptedEvidenceKinds: ["image_region"],
      evidenceByteLimits: { image_region: 1024 * 1024 },
      imagePolicy: { mode: "crop_required" },
    });
    const accessible = await workbench!.evidence.recordObservation({
      requestId: imageRequest.id,
      subjectKeys: ["brand:midea"],
      sourceIdentity: "official-site:example.com",
      sourceAuthorityType: "brand_official_site",
      requestedUrl: "https://example.com/products/midea-one",
      finalUrl: "https://example.com/products/midea-one",
      observedAt: "2026-08-15T08:00:00.000Z",
      state: "accessible",
    });
    await expect(workbench!.evidence.commit({
      requestId: imageRequest.id,
      observationId: accessible.id,
      kind: "image_region",
      mediaType: "image/png",
      privacyClass: "public",
      subjectKeys: ["brand:midea"],
      relationProof: { method: "explicit_identifier", detail: "只凭文件名猜测" },
      locator: {
        kind: "image_region",
        sourceImageSha256: "a".repeat(64),
        sourceWidth: 1000,
        sourceHeight: 800,
        xywh: { unit: "pixel", x: 0, y: 0, width: 200, height: 200 },
      },
    }, new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(EvidenceError);
  });

  it("does not mark a multi-target request sufficient when only one target has evidence", async () => {
    const fixture = await createFixture();
    const request = await workbench!.evidence.createRequest({
      ...requestDraft(fixture, "need-multi-target"),
      targetKeys: ["brand:midea", "brand:galanz"],
    });
    const observation = await workbench!.evidence.recordObservation({
      requestId: request.id,
      subjectKeys: ["brand:midea"],
      sourceIdentity: "official-site:example.com",
      sourceAuthorityType: "brand_official_site",
      requestedUrl: "https://example.com/products/midea-one",
      finalUrl: "https://example.com/products/midea-one",
      observedAt: "2026-08-15T08:00:00.000Z",
      state: "accessible",
    });
    const content = new TextEncoder().encode("规格：微波输出功率为 900 W，额定输入功率为 1350 W。");
    await workbench!.evidence.commit(candidate(request.id, observation.id), content);

    const assessment = await workbench!.evidence.assess(request.id);
    expect(assessment.status).toBe("insufficient");
    expect(assessment.targets).toEqual([
      expect.objectContaining({ targetKey: "brand:midea", status: "sufficient" }),
      expect.objectContaining({ targetKey: "brand:galanz", status: "not_started" }),
    ]);
  });

  it("accepts a full image only when the request allows it and bytes match the locator", async () => {
    const fixture = await createFixture();
    const request = await workbench!.evidence.createRequest({
      ...requestDraft(fixture, "need-product-image"),
      acceptedEvidenceKinds: ["image_region"],
      evidenceByteLimits: { image_region: 1024 * 1024 },
      imagePolicy: { mode: "full_image_allowed", reason: "产品外观本身是本次知识需求" },
    });
    const observation = await workbench!.evidence.recordObservation({
      requestId: request.id,
      subjectKeys: ["brand:midea"],
      sourceIdentity: "official-site:example.com",
      sourceAuthorityType: "brand_official_site",
      requestedUrl: "https://example.com/products/midea-one",
      finalUrl: "https://example.com/products/midea-one",
      observedAt: "2026-08-15T08:00:00.000Z",
      state: "accessible",
    });
    const content = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );
    const sourceImageSha256 = createHash("sha256").update(content).digest("hex");

    await expect(workbench!.evidence.commit({
      requestId: request.id,
      observationId: observation.id,
      kind: "image_region",
      mediaType: "image/png",
      privacyClass: "public",
      subjectKeys: ["brand:midea"],
      relationProof: { method: "structured_data", detail: "官方产品数据把图片绑定到目标型号" },
      locator: {
        kind: "image_region",
        sourceImageSha256,
        sourceWidth: 1,
        sourceHeight: 1,
        xywh: { unit: "pixel", x: 0, y: 0, width: 1, height: 1 },
      },
    }, content)).resolves.toMatchObject({ contentIntegrity: expect.stringMatching(/^sha256-/) });
  });

  async function createFixture() {
    const prefix = `evidence-${randomUUID()}`;
    evidenceRoot = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
    const counters = { project: 0, definition: 0, scope: 0, board: 0 };
    const evidenceCounters = { request: 0, observation: 0, evidence: 0 };
    workbench = await openProductKnowledgeWorkbench({
      databaseUrl: databaseUrl!,
      evidenceRoot,
      productProjectModule: {
        now: () => new Date("2026-08-15T07:00:00.000Z"),
        createId: (kind) => `${prefix}-${kind}-${++counters[kind]}`,
      },
      evidenceModule: {
        now: () => new Date("2026-08-15T09:00:00.000Z"),
        createId: (kind) => `${prefix}-${kind}-${++evidenceCounters[kind]}`,
      },
    });
    const draft = await workbench.productProjects.saveDraft(projectDraft());
    return workbench.productProjects.confirm(draft.project.id, draft.project.revision);
  }
});

function requestDraft(
  project: Awaited<ReturnType<ProductKnowledgeWorkbench["productProjects"]["confirm"]>>,
  needId: string,
): EvidenceRequestDraft {
  return {
    projectId: project.project.id,
    categoryDefinitionVersionId: project.categoryDefinition.id,
    confirmedScopeVersionId: project.confirmedScope.id,
    collectionBoardVersionId: project.collectionBoard.id,
    collectionLaneIds: ["lane-midea-official"],
    knowledgeNeed: { id: needId, kind: "attribute", attributeCode: "heating.power" },
    question: "该型号标称微波输出功率是多少？",
    knowledgeLayer: "specification",
    targetKeys: ["brand:midea"],
    allowedSourceAuthorityTypes: ["brand_official_site"],
    acceptedEvidenceKinds: ["web_text"],
    evidenceByteLimits: { web_text: 4096 },
    freshness: { maxAgeDays: 30 },
    minimumEvidenceItemsPerTarget: 1,
    minimumDistinctSourcesPerTarget: 1,
    evidencePolicyVersion: "policy-1",
    stopConditions: ["access_denied", "source_abnormal"],
    priority: 50,
  };
}

function candidate(requestId: string, observationId: string): EvidenceCandidate {
  return {
    requestId,
    observationId,
    kind: "web_text",
    mediaType: "text/plain; charset=utf-8",
    privacyClass: "public",
    subjectKeys: ["brand:midea"],
    relationProof: { method: "explicit_identifier", detail: "标题明确写明美的目标型号" },
    locator: {
      kind: "web_text",
      quote: {
        exact: "微波输出功率为 900 W",
        prefix: "规格：",
        suffix: "，额定输入功率为 1350 W。",
      },
    },
  };
}

function projectDraft(): ProductProjectDraftInput {
  return {
    name: "微波炉最小证据验证",
    knowledgeTopic: "中国市场微波炉规格证据",
    market: "CN",
    categoryDefinition: {
      categoryCode: "microwave_oven",
      label: "微波炉",
      sourceAuthorityPolicy: ["brand_official_site"],
      attributes: [{
        code: "heating.power",
        label: "微波输出功率",
        description: "产品标称微波输出功率",
        knowledgeLayer: "specification",
        valueKind: "decimal",
        canonicalUnitCode: "W",
        externalMappings: [],
        filterable: true,
        comparable: true,
      }],
      decisionDimensions: [{
        code: "cooking.speed",
        label: "加热效率",
        description: "判断日常加热速度",
        relatedAttributeCodes: ["heating.power"],
      }],
      competencyQuestions: ["多大功率适合日常热饭？"],
    },
    confirmedScope: {
      populationLayers: ["official_current_catalog"],
      targets: [{
        key: "brand:midea",
        kind: "brand",
        label: "美的",
        evidenceReferenceIds: ["scope-evidence-midea"],
        disposition: "included",
        reason: "验证样本",
      }, {
        key: "brand:galanz",
        kind: "brand",
        label: "格兰仕",
        evidenceReferenceIds: ["scope-evidence-galanz"],
        disposition: "included",
        reason: "多目标充分性验证样本",
      }],
    },
    collectionBoard: {
      lanes: [{
        id: "lane-midea-official",
        sourceAuthorityType: "brand_official_site",
        accessMode: "public_web",
        targetKeys: ["brand:midea", "brand:galanz"],
        knowledgeLayers: ["specification"],
        refreshPolicy: "manual",
        stopConditions: ["access_denied", "source_abnormal"],
      }],
    },
  };
}
