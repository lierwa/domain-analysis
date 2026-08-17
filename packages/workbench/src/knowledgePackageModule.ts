import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  activateKnowledgePackage,
  buildKnowledgePackage,
  describeKnowledgePackage,
  readActiveKnowledgePackage,
  rollbackKnowledgePackage,
} from "@domain-analysis/knowledge-runtime";
import {
  knowledgePackageEvidenceSchema,
  stateEvidenceIds,
  type KnowledgePackageDescriptor,
  type PublishableKnowledgeState,
} from "@domain-analysis/shared";

import { contentHash } from "./contentHash";
import type { EvidenceModule } from "./evidenceModule";
import type { KnowledgeReviewModule } from "./knowledgeReviewModule";
import type { ProductProjectModule } from "./productProjectModule";

export interface KnowledgePackageModule {
  build(projectId: string): Promise<KnowledgePackageDescriptor>;
  list(projectId: string): Promise<KnowledgePackageDescriptor[]>;
  activate(projectId: string, versionHash: string): Promise<KnowledgePackageDescriptor>;
  rollback(projectId: string): Promise<KnowledgePackageDescriptor>;
  active(projectId: string): Promise<KnowledgePackageDescriptor | null>;
}

export interface KnowledgePackageModuleOptions {
  root: string;
  now?: () => Date;
}

export class KnowledgePackageError extends Error {
  constructor(
    readonly code: "project_not_confirmed" | "no_publishable_knowledge" | "permission_missing" | "package_not_found",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgePackageError";
  }
}

export function createKnowledgePackageModule(
  projects: Pick<ProductProjectModule, "get">,
  review: Pick<KnowledgeReviewModule, "listPublishable">,
  evidence: Pick<EvidenceModule, "read" | "getObservation">,
  options: KnowledgePackageModuleOptions,
): KnowledgePackageModule {
  const now = options.now ?? (() => new Date());
  return {
    build: async (projectId) => {
      const project = await projects.get(projectId);
      if (!project || project.project.status !== "ready") {
        throw new KnowledgePackageError("project_not_confirmed", "只能为已确认项目构建知识包");
      }
      const states = await review.listPublishable(projectId);
      if (states.length === 0) {
        throw new KnowledgePackageError("no_publishable_knowledge", "项目还没有经过审核的可发布知识或状态");
      }
      const packagedEvidence = await collectEvidence(states, evidence);
      return buildKnowledgePackage({
        projectId,
        categoryDefinitionVersionId: project.categoryDefinition.id,
        createdAt: now().toISOString(),
        states,
        evidence: packagedEvidence,
      }, projectRoot(options.root, projectId));
    },
    list: (projectId) => listPackages(options.root, projectId),
    activate: async (projectId, versionHash) => {
      const descriptor = await requirePackage(options.root, projectId, versionHash);
      await activateKnowledgePackage(projectRoot(options.root, projectId), descriptor, now);
      return descriptor;
    },
    rollback: async (projectId) => {
      const root = projectRoot(options.root, projectId);
      const pointer = await rollbackKnowledgePackage(root);
      return requirePackage(options.root, projectId, pointer.versionHash);
    },
    active: async (projectId) => {
      const pointer = await readActiveKnowledgePackage(projectRoot(options.root, projectId));
      return pointer ? requirePackage(options.root, projectId, pointer.versionHash) : null;
    },
  };
}

async function collectEvidence(
  states: PublishableKnowledgeState[],
  evidence: Pick<EvidenceModule, "read" | "getObservation">,
) {
  const ids = [...new Set(states.flatMap(stateEvidenceIds))].sort();
  return Promise.all(ids.map(async (evidenceId) => {
    const result = await evidence.read(evidenceId);
    if (!result) throw new KnowledgePackageError("permission_missing", `知识引用的证据不存在：${evidenceId}`);
    const observation = await evidence.getObservation(result.item.observationId);
    const permission = observation?.usagePermission;
    if (!observation || !permission) {
      throw new KnowledgePackageError("permission_missing", `证据没有可审计的来源许可：${evidenceId}`);
    }
    if (isClaimEvidence(states, evidenceId)
      && permission.derivedKnowledgePublication !== "allowed") {
      throw new KnowledgePackageError("permission_missing", `证据不允许发布派生知识：${evidenceId}`);
    }
    const redistributionAllowed = permission.sourceRedistribution === "allowed";
    return knowledgePackageEvidenceSchema.parse({
      id: result.item.id,
      kind: result.item.kind,
      mediaType: result.item.mediaType,
      sourceIdentity: observation.sourceIdentity,
      sourceAuthorityType: observation.sourceAuthorityType,
      sourceUrl: observation.finalUrl ?? observation.requestedUrl,
      locator: result.item.locator,
      contentIntegrity: result.item.contentIntegrity,
      capturedAt: result.item.capturedAt,
      redistributionAllowed,
      ...(redistributionAllowed ? encodeContent(result.item.mediaType, result.content) : {}),
      permissionBasis: permission.basis,
      permissionBasisUrl: permission.basisUrl,
    });
  }));
}

function isClaimEvidence(states: PublishableKnowledgeState[], evidenceId: string) {
  return states.some((state) => state.kind !== "unknown" && stateEvidenceIds(state).includes(evidenceId));
}

function encodeContent(mediaType: string, content: Uint8Array) {
  if (mediaType.startsWith("text/") || mediaType === "application/json") {
    return { contentEncoding: "utf8" as const, content: new TextDecoder("utf-8", { fatal: true }).decode(content) };
  }
  return { contentEncoding: "base64" as const, content: Buffer.from(content).toString("base64") };
}

async function listPackages(root: string, projectId: string) {
  const versionsRoot = path.join(projectRoot(root, projectId), "versions");
  let names: string[];
  try {
    names = await readdir(versionsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const descriptors = await Promise.all(names.filter((name) => name.endsWith(".sqlite"))
    .map((name) => describeKnowledgePackage(path.join(versionsRoot, name))));
  return descriptors.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function requirePackage(root: string, projectId: string, versionHash: string) {
  if (!/^[a-f0-9]{64}$/.test(versionHash)) {
    throw new KnowledgePackageError("package_not_found", "知识包版本不存在");
  }
  const filePath = path.join(projectRoot(root, projectId), "versions", `${versionHash}.sqlite`);
  try {
    const descriptor = await describeKnowledgePackage(filePath);
    if (descriptor.projectId !== projectId || descriptor.versionHash !== versionHash) {
      throw new KnowledgePackageError("package_not_found", "知识包版本与项目不匹配");
    }
    return descriptor;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new KnowledgePackageError("package_not_found", "知识包版本不存在");
    }
    throw error;
  }
}

function projectRoot(root: string, projectId: string) {
  // WHY：项目 ID 是领域值而不是安全路径段，内容哈希避免路径穿越和跨平台非法字符。
  return path.resolve(root, "projects", contentHash(projectId));
}
