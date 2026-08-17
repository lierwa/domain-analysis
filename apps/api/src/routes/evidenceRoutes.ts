import {
  cnisRegistryRowCollectionInputSchema,
  documentExcerptCollectionInputSchema,
  energyLabelRecordCollectionInputSchema,
  publicWebTextCollectionInputSchema,
} from "@domain-analysis/shared";
import type { SourceAuthorityType } from "@domain-analysis/shared";
import {
  EvidenceError,
  ProductProjectError,
  type EvidenceModule,
  type ProductProjectModule,
} from "@domain-analysis/workbench";
import {
  SourceAccessError,
  type CnisRegistryTableSource,
  type DocumentExcerptSource,
  type EnergyLabelRecordSource,
  type PublicWebTextSource,
} from "@domain-analysis/worker";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const projectParamsSchema = z.object({ projectId: z.string().min(1) }).strict();

export interface EvidenceRouteDependencies {
  projects: ProductProjectModule;
  evidence: EvidenceModule;
  source: PublicWebTextSource;
  regulatorySource?: EnergyLabelRecordSource;
  documentSource?: DocumentExcerptSource;
  registryTableSource?: CnisRegistryTableSource;
}

export async function registerEvidenceRoutes(
  app: FastifyInstance,
  dependencies: EvidenceRouteDependencies,
) {
  app.get("/api/product-projects/:projectId/evidence", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return { items: await dependencies.evidence.listProject(projectId) };
  });

  app.post("/api/product-projects/:projectId/evidence/public-web-text", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = publicWebTextCollectionInputSchema.parse(request.body);
    const project = await dependencies.projects.get(projectId);
    if (!project) throw new ProductProjectError("not_found", `项目不存在：${projectId}`);
    if (project.project.status !== "ready") {
      throw new EvidenceError("project_not_confirmed", "来源访问只能使用已冻结项目");
    }
    const lane = project.collectionBoard.lanes.find((item) => item.id === input.collectionLaneId);
    if (!lane || lane.accessMode !== "public_web") {
      throw new EvidenceError("request_outside_confirmed_scope", "当前项目没有对应的公开网页搜集路线");
    }

    const evidenceRequest = await dependencies.evidence.createRequest({
      projectId,
      categoryDefinitionVersionId: project.categoryDefinition.id,
      confirmedScopeVersionId: project.confirmedScope.id,
      collectionBoardVersionId: project.collectionBoard.id,
      collectionLaneIds: [input.collectionLaneId],
      knowledgeNeed: input.knowledgeNeed,
      question: input.question,
      knowledgeLayer: input.knowledgeLayer,
      targetKeys: [input.targetKey],
      allowedSourceAuthorityTypes: [lane.sourceAuthorityType],
      acceptedEvidenceKinds: ["web_text"],
      evidenceByteLimits: { web_text: 40_000 },
      freshness: { maxAgeDays: 30 },
      minimumEvidenceItemsPerTarget: 1,
      minimumDistinctSourcesPerTarget: 1,
      evidencePolicyVersion: "evidence-policy-v1",
      stopConditions: lane.stopConditions,
      priority: 80,
    });

    let capture;
    try {
      capture = await dependencies.source.capture({
        requestedUrl: input.requestedUrl,
        selector: input.selector,
        requiredText: input.requiredText,
        maximumBytes: 40_000,
      });
    } catch (error) {
      await recordFailedObservation(
        dependencies.evidence,
        evidenceRequest.id,
        input,
        lane,
        input.requestedUrl,
        error,
      );
      throw error;
    }
    const observation = await dependencies.evidence.recordObservation({
      requestId: evidenceRequest.id,
      subjectKeys: [input.targetKey],
      sourceIdentity: input.sourceIdentity,
      sourceAuthorityType: lane.sourceAuthorityType,
      requestedUrl: capture.requestedUrl,
      finalUrl: capture.finalUrl,
      observedAt: capture.observedAt,
      state: "accessible",
      httpValidation: capture.httpValidation,
    });
    const item = await dependencies.evidence.commit({
      requestId: evidenceRequest.id,
      observationId: observation.id,
      kind: "web_text",
      mediaType: "text/plain; charset=utf-8",
      privacyClass: "public",
      subjectKeys: [input.targetKey],
      relationProof: {
        method: "structured_data",
        detail: `选中区域 ${input.selector} 明确包含对象标识 ${input.requiredText}`,
      },
      locator: capture.locator,
    }, new TextEncoder().encode(capture.content));
    const assessment = await dependencies.evidence.assess(evidenceRequest.id);
    return reply.status(201).send({
      item: { request: evidenceRequest, observation, evidence: item, assessment },
    });
  });

  if (dependencies.documentSource) {
    app.post("/api/product-projects/:projectId/evidence/document-excerpt", async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const input = documentExcerptCollectionInputSchema.parse(request.body);
      const project = await dependencies.projects.get(projectId);
      if (!project) throw new ProductProjectError("not_found", `项目不存在：${projectId}`);
      if (project.project.status !== "ready") {
        throw new EvidenceError("project_not_confirmed", "来源访问只能使用已冻结项目");
      }
      const lane = project.collectionBoard.lanes.find((item) => item.id === input.collectionLaneId);
      if (!lane || lane.accessMode !== "public_web" || lane.sourceAuthorityType !== "official_manual") {
        throw new EvidenceError("request_outside_confirmed_scope", "当前项目没有对应的官方说明书路线");
      }

      const evidenceRequest = await dependencies.evidence.createRequest({
        projectId,
        categoryDefinitionVersionId: project.categoryDefinition.id,
        confirmedScopeVersionId: project.confirmedScope.id,
        collectionBoardVersionId: project.collectionBoard.id,
        collectionLaneIds: [input.collectionLaneId],
        knowledgeNeed: input.knowledgeNeed,
        question: input.question,
        knowledgeLayer: input.knowledgeLayer,
        targetKeys: [input.targetKey],
        allowedSourceAuthorityTypes: [lane.sourceAuthorityType],
        acceptedEvidenceKinds: ["document_excerpt"],
        evidenceByteLimits: { document_excerpt: 40_000 },
        freshness: { maxAgeDays: 365 },
        minimumEvidenceItemsPerTarget: 1,
        minimumDistinctSourcesPerTarget: 1,
        evidencePolicyVersion: "evidence-policy-v1",
        stopConditions: lane.stopConditions,
        priority: 85,
      });

      let capture;
      try {
        capture = await dependencies.documentSource!.capture({
          requestedUrl: input.requestedUrl,
          requiredText: input.requiredText,
          requiredSectionTerms: input.requiredSectionTerms,
          section: input.section,
          maximumSourceBytes: 4 * 1024 * 1024,
          maximumExcerptBytes: 40_000,
        });
      } catch (error) {
        await recordFailedObservation(
          dependencies.evidence,
          evidenceRequest.id,
          input,
          lane,
          input.requestedUrl,
          error,
        );
        throw error;
      }
      const observation = await dependencies.evidence.recordObservation({
        requestId: evidenceRequest.id,
        subjectKeys: [input.targetKey],
        sourceIdentity: input.sourceIdentity,
        sourceAuthorityType: lane.sourceAuthorityType,
        requestedUrl: capture.requestedUrl,
        finalUrl: capture.finalUrl,
        observedAt: capture.observedAt,
        state: "accessible",
        httpValidation: capture.httpValidation,
      });
      const item = await dependencies.evidence.commit({
        requestId: evidenceRequest.id,
        observationId: observation.id,
        kind: "document_excerpt",
        mediaType: "text/plain; charset=utf-8",
        privacyClass: "public",
        subjectKeys: [input.targetKey],
        relationProof: {
          method: "document_identity",
          detail: `官方说明书页同时包含对象标识 ${input.requiredText} 与请求的章节线索`,
        },
        locator: capture.locator,
      }, new TextEncoder().encode(capture.content));
      const assessment = await dependencies.evidence.assess(evidenceRequest.id);
      return reply.status(201).send({
        item: { request: evidenceRequest, observation, evidence: item, assessment },
      });
    });
  }

  if (dependencies.regulatorySource) {
    app.post("/api/product-projects/:projectId/evidence/energy-label-record", async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const input = energyLabelRecordCollectionInputSchema.parse(request.body);
      const project = await dependencies.projects.get(projectId);
      if (!project) throw new ProductProjectError("not_found", `项目不存在：${projectId}`);
      if (project.project.status !== "ready") {
        throw new EvidenceError("project_not_confirmed", "来源访问只能使用已冻结项目");
      }
      const lane = project.collectionBoard.lanes.find((item) => item.id === input.collectionLaneId);
      if (!lane || lane.accessMode !== "public_web" || lane.sourceAuthorityType !== "regulatory_source") {
        throw new EvidenceError("request_outside_confirmed_scope", "当前项目没有对应的监管来源路线");
      }

      const evidenceRequest = await dependencies.evidence.createRequest({
        projectId,
        categoryDefinitionVersionId: project.categoryDefinition.id,
        confirmedScopeVersionId: project.confirmedScope.id,
        collectionBoardVersionId: project.collectionBoard.id,
        collectionLaneIds: [input.collectionLaneId],
        knowledgeNeed: input.knowledgeNeed,
        question: input.question,
        knowledgeLayer: input.knowledgeLayer,
        targetKeys: [input.targetKey],
        allowedSourceAuthorityTypes: [lane.sourceAuthorityType],
        acceptedEvidenceKinds: ["web_text"],
        evidenceByteLimits: { web_text: 40_000 },
        freshness: { maxAgeDays: 30 },
        minimumEvidenceItemsPerTarget: 1,
        minimumDistinctSourcesPerTarget: 1,
        evidencePolicyVersion: "evidence-policy-v1",
        stopConditions: lane.stopConditions,
        priority: 90,
      });

      let capture;
      try {
        capture = await dependencies.regulatorySource!.captureByModel({
          productModel: input.productModel,
          maximumBytes: 40_000,
        });
      } catch (error) {
        await recordFailedObservation(
          dependencies.evidence,
          evidenceRequest.id,
          input,
          lane,
          dependencies.regulatorySource!.requestedUrl,
          error,
        );
        throw error;
      }
      const observation = await dependencies.evidence.recordObservation({
        requestId: evidenceRequest.id,
        subjectKeys: [input.targetKey],
        sourceIdentity: input.sourceIdentity,
        sourceAuthorityType: lane.sourceAuthorityType,
        requestedUrl: capture.requestedUrl,
        finalUrl: capture.finalUrl,
        observedAt: capture.observedAt,
        state: "accessible",
        httpValidation: capture.httpValidation,
      });
      const item = await dependencies.evidence.commit({
        requestId: evidenceRequest.id,
        observationId: observation.id,
        kind: "web_text",
        mediaType: "text/plain; charset=utf-8",
        privacyClass: "public",
        subjectKeys: [input.targetKey],
        relationProof: {
          method: "structured_data",
          detail: `官方备案详情响应明确包含对象型号 ${input.productModel}`,
        },
        locator: capture.locator,
      }, new TextEncoder().encode(capture.content));
      const assessment = await dependencies.evidence.assess(evidenceRequest.id);
      return reply.status(201).send({
        item: { request: evidenceRequest, observation, evidence: item, assessment },
      });
    });
  }

  if (dependencies.registryTableSource) {
    app.post("/api/product-projects/:projectId/evidence/cnis-registry-row", async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const input = cnisRegistryRowCollectionInputSchema.parse(request.body);
      const project = await dependencies.projects.get(projectId);
      if (!project) throw new ProductProjectError("not_found", `项目不存在：${projectId}`);
      if (project.project.status !== "ready") {
        throw new EvidenceError("project_not_confirmed", "来源访问只能使用已冻结项目");
      }
      const lane = project.collectionBoard.lanes.find((item) => item.id === input.collectionLaneId);
      if (!lane || lane.accessMode !== "public_web" || lane.sourceAuthorityType !== "regulatory_source") {
        throw new EvidenceError("request_outside_confirmed_scope", "当前项目没有对应的监管来源路线");
      }
      const evidenceRequest = await dependencies.evidence.createRequest({
        projectId,
        categoryDefinitionVersionId: project.categoryDefinition.id,
        confirmedScopeVersionId: project.confirmedScope.id,
        collectionBoardVersionId: project.collectionBoard.id,
        collectionLaneIds: [input.collectionLaneId],
        knowledgeNeed: input.knowledgeNeed,
        question: input.question,
        knowledgeLayer: input.knowledgeLayer,
        targetKeys: [input.targetKey],
        allowedSourceAuthorityTypes: [lane.sourceAuthorityType],
        acceptedEvidenceKinds: ["table_region"],
        evidenceByteLimits: { table_region: 4096 },
        freshness: { maxAgeDays: 3650 },
        minimumEvidenceItemsPerTarget: 1,
        minimumDistinctSourcesPerTarget: 1,
        evidencePolicyVersion: "evidence-policy-v1",
        stopConditions: lane.stopConditions,
        priority: 90,
      });

      let capture;
      try {
        capture = await dependencies.registryTableSource!.captureByModel({
          productModel: input.productModel,
          year: input.year,
          maximumArchiveBytes: 10 * 1024 * 1024,
          maximumEvidenceBytes: 4096,
        });
      } catch (error) {
        await recordFailedObservation(
          dependencies.evidence,
          evidenceRequest.id,
          input,
          lane,
          dependencies.registryTableSource!.requestedUrl,
          error,
        );
        throw error;
      }
      const observation = await dependencies.evidence.recordObservation({
        requestId: evidenceRequest.id,
        subjectKeys: [input.targetKey],
        sourceIdentity: input.sourceIdentity,
        sourceAuthorityType: lane.sourceAuthorityType,
        requestedUrl: capture.requestedUrl,
        finalUrl: capture.finalUrl,
        observedAt: capture.observedAt,
        state: "accessible",
        httpValidation: capture.httpValidation,
      });
      const item = await dependencies.evidence.commit({
        requestId: evidenceRequest.id,
        observationId: observation.id,
        kind: "table_region",
        mediaType: "application/json",
        privacyClass: "public",
        subjectKeys: [input.targetKey],
        relationProof: {
          method: "table_row_identity",
          detail: `监管工作簿唯一行的规格型号等于 ${input.productModel}`,
        },
        locator: capture.locator,
      }, new TextEncoder().encode(capture.content));
      const assessment = await dependencies.evidence.assess(evidenceRequest.id);
      return reply.status(201).send({
        item: { request: evidenceRequest, observation, evidence: item, assessment },
      });
    });
  }
}

async function recordFailedObservation(
  evidence: EvidenceModule,
  requestId: string,
  input: { targetKey: string; sourceIdentity: string },
  lane: { sourceAuthorityType: SourceAuthorityType },
  requestedUrl: string,
  error: unknown,
) {
  if (!(error instanceof SourceAccessError) || error.code === "origin_not_allowed") return;
  const state = error.code === "evidence_not_found" ? "not_found" : "source_abnormal";
  await evidence.recordObservation({
    requestId,
    subjectKeys: [input.targetKey],
    sourceIdentity: input.sourceIdentity,
    sourceAuthorityType: lane.sourceAuthorityType,
    requestedUrl,
    observedAt: new Date().toISOString(),
    state,
    failureCode: state,
  });
}
