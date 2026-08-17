import { randomUUID } from "node:crypto";

import type {
  CategoryDefinitionVersion,
  CollectionBoardVersion,
  ConfirmedProjectSnapshot,
  ConfirmedScopeVersion,
  ProductKnowledgeProject,
  ProductProjectDraftInput,
  ProductProjectView,
} from "@domain-analysis/shared";
import {
  categoryDefinitionVersionSchema,
  collectionBoardVersionSchema,
  confirmedProjectSnapshotSchema,
  confirmedScopeVersionSchema,
  productKnowledgeProjectSchema,
  productProjectDraftInputSchema,
} from "@domain-analysis/shared";
import type { ProductKnowledgeDb } from "@domain-analysis/db";
import {
  categoryDefinitionVersions,
  collectionBoardVersions,
  confirmedScopeVersions,
  productKnowledgeProjects,
} from "@domain-analysis/db";
import { and, desc, eq } from "drizzle-orm";

import { contentHash } from "./contentHash";

export interface ProductProjectModule {
  list(): Promise<ProductKnowledgeProject[]>;
  saveDraft(input: ProductProjectDraftInput): Promise<ProductProjectView>;
  confirm(projectId: string, expectedRevision: number): Promise<ConfirmedProjectSnapshot>;
  get(projectId: string): Promise<ProductProjectView | null>;
}

export type ProductProjectErrorCode = "not_found" | "revision_conflict" | "archived" | "incomplete";

export class ProductProjectError extends Error {
  constructor(readonly code: ProductProjectErrorCode, message: string) {
    super(message);
    this.name = "ProductProjectError";
  }
}

export interface ProductProjectModuleOptions {
  now?: () => Date;
  createId?: (kind: "project" | "definition" | "scope" | "board") => string;
}

export function createProductProjectModule(
  db: ProductKnowledgeDb,
  options: ProductProjectModuleOptions = {},
): ProductProjectModule {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((kind) => `${kind}-${randomUUID()}`);

  return {
    list: () => listProjects(db),
    saveDraft: (input) => saveDraft(db, input, now, createId),
    confirm: (projectId, revision) => confirm(db, projectId, revision, now),
    get: (projectId) => loadView(db, projectId),
  };
}

async function listProjects(db: ProductKnowledgeDb) {
  const projects = await db.select().from(productKnowledgeProjects)
    .orderBy(desc(productKnowledgeProjects.updatedAt));
  return projects.map(normalizeProject);
}

async function saveDraft(
  db: ProductKnowledgeDb,
  rawInput: ProductProjectDraftInput,
  now: () => Date,
  createId: NonNullable<ProductProjectModuleOptions["createId"]>,
) {
  const input = productProjectDraftInputSchema.parse(rawInput);
  const existing = input.projectId ? await findProject(db, input.projectId) : undefined;
  validateExistingProject(input, existing);
  const projectId = existing?.id ?? createId("project");
  const revision = existing ? existing.revision + 1 : 1;
  const timestamp = now().toISOString();
  const view = buildDraftView(
    input,
    projectId,
    revision,
    existing?.createdAt ?? timestamp,
    timestamp,
    createId,
  );

  // WHY：项目状态和三份版本输入必须同进同退，避免流水线读到“半个新版本”。
  await db.transaction(async (transaction) => {
    if (existing) {
      const updated = await transaction.update(productKnowledgeProjects).set({
        name: input.name,
        knowledgeTopic: input.knowledgeTopic,
        market: input.market,
        status: "draft",
        revision,
        updatedAt: timestamp,
      }).where(and(
        eq(productKnowledgeProjects.id, projectId),
        eq(productKnowledgeProjects.revision, input.expectedRevision!),
      )).returning({ id: productKnowledgeProjects.id });
      if (updated.length !== 1) throw revisionConflict(projectId);
      await supersedeDraftVersions(transaction, projectId);
    } else {
      await transaction.insert(productKnowledgeProjects).values(view.project);
    }
    await transaction.insert(categoryDefinitionVersions).values(toDefinitionRow(view.categoryDefinition));
    await transaction.insert(confirmedScopeVersions).values(toScopeRow(view.confirmedScope));
    await transaction.insert(collectionBoardVersions).values(toBoardRow(view.collectionBoard));
  });
  return view;
}

async function confirm(
  db: ProductKnowledgeDb,
  projectId: string,
  expectedRevision: number,
  now: () => Date,
) {
  const view = await loadView(db, projectId);
  if (!view) throw new ProductProjectError("not_found", `项目不存在：${projectId}`);
  if (view.project.status === "archived") throw new ProductProjectError("archived", "归档项目不能确认");
  if (view.project.revision !== expectedRevision) throw revisionConflict(projectId);
  const confirmedAt = now().toISOString();
  const snapshot = confirmedProjectSnapshotSchema.parse({
    project: { ...view.project, status: "ready", updatedAt: confirmedAt },
    categoryDefinition: { ...view.categoryDefinition, status: "confirmed", confirmedAt },
    confirmedScope: { ...view.confirmedScope, status: "confirmed", confirmedAt },
    collectionBoard: { ...view.collectionBoard, status: "confirmed", confirmedAt },
  });

  await db.transaction(async (transaction) => {
    const updated = await transaction.update(productKnowledgeProjects).set({
      status: "ready",
      updatedAt: confirmedAt,
    }).where(and(
      eq(productKnowledgeProjects.id, projectId),
      eq(productKnowledgeProjects.revision, expectedRevision),
    )).returning({ id: productKnowledgeProjects.id });
    if (updated.length !== 1) throw revisionConflict(projectId);
    await supersedeConfirmedVersions(transaction, projectId);
    await transaction.update(categoryDefinitionVersions).set({ status: "confirmed", confirmedAt })
      .where(eq(categoryDefinitionVersions.id, snapshot.categoryDefinition.id));
    await transaction.update(confirmedScopeVersions).set({ status: "confirmed", confirmedAt })
      .where(eq(confirmedScopeVersions.id, snapshot.confirmedScope.id));
    await transaction.update(collectionBoardVersions).set({ status: "confirmed", confirmedAt })
      .where(eq(collectionBoardVersions.id, snapshot.collectionBoard.id));
  });
  return snapshot;
}

async function loadView(db: ProductKnowledgeDb, projectId: string): Promise<ProductProjectView | null> {
  const project = await findProject(db, projectId);
  if (!project) return null;
  const [definition, scope, board] = await Promise.all([
    db.query.categoryDefinitionVersions.findFirst({ where: and(
      eq(categoryDefinitionVersions.projectId, projectId), eq(categoryDefinitionVersions.version, project.revision),
    ) }),
    db.query.confirmedScopeVersions.findFirst({ where: and(
      eq(confirmedScopeVersions.projectId, projectId), eq(confirmedScopeVersions.version, project.revision),
    ) }),
    db.query.collectionBoardVersions.findFirst({ where: and(
      eq(collectionBoardVersions.projectId, projectId), eq(collectionBoardVersions.version, project.revision),
    ) }),
  ]);
  if (!definition || !scope || !board) {
    throw new ProductProjectError("incomplete", `项目版本数据不完整：${projectId}@${project.revision}`);
  }

  const { content: definitionContent, ...definitionMetadata } = definition;
  const { content: scopeContent, ...scopeMetadata } = scope;
  const { content: boardContent, ...boardMetadata } = board;
  return {
    // WHY：读取时再次走共享契约，数据库损坏应立即失败，不能把脏输入交给采集流水线。
    project: productKnowledgeProjectSchema.parse(project),
    categoryDefinition: categoryDefinitionVersionSchema.parse({
      ...normalizeVersionMetadata(definitionMetadata),
      ...definitionContent,
    }),
    confirmedScope: confirmedScopeVersionSchema.parse({
      ...normalizeVersionMetadata(scopeMetadata),
      ...scopeContent,
    }),
    collectionBoard: collectionBoardVersionSchema.parse({
      ...normalizeVersionMetadata(boardMetadata),
      ...boardContent,
    }),
  };
}

function normalizeVersionMetadata<T extends { createdAt: string; confirmedAt: string | null }>(metadata: T) {
  const { createdAt, confirmedAt, ...rest } = metadata;
  // WHY：PostgreSQL 保留时区语义，但返回格式受会话时区影响；领域 contract 统一输出 UTC ISO。
  return confirmedAt
    ? { ...rest, createdAt: normalizeTimestamp(createdAt), confirmedAt: normalizeTimestamp(confirmedAt) }
    : { ...rest, createdAt: normalizeTimestamp(createdAt) };
}

function buildDraftView(
  input: ProductProjectDraftInput,
  projectId: string,
  revision: number,
  createdAt: string,
  timestamp: string,
  createId: NonNullable<ProductProjectModuleOptions["createId"]>,
): ProductProjectView {
  const definitionId = createId("definition");
  const scopeId = createId("scope");
  const boardId = createId("board");
  const categoryContent = pickCategoryContent(input.categoryDefinition);
  return {
    project: {
      id: projectId, name: input.name, knowledgeTopic: input.knowledgeTopic, market: input.market,
      status: "draft", revision, createdAt, updatedAt: timestamp,
    },
    categoryDefinition: {
      id: definitionId, projectId, categoryCode: input.categoryDefinition.categoryCode,
      label: input.categoryDefinition.label, market: input.market, version: revision, status: "draft",
      ...categoryContent, contentHash: contentHash({ ...categoryContent, market: input.market }), createdAt: timestamp,
    },
    confirmedScope: {
      id: scopeId, projectId, categoryDefinitionVersionId: definitionId, market: input.market,
      version: revision, status: "draft", ...input.confirmedScope,
      contentHash: contentHash(input.confirmedScope), createdAt: timestamp,
    },
    collectionBoard: {
      id: boardId, projectId, confirmedScopeVersionId: scopeId, version: revision, status: "draft",
      ...input.collectionBoard, contentHash: contentHash(input.collectionBoard), createdAt: timestamp,
    },
  };
}

function validateExistingProject(
  input: ProductProjectDraftInput,
  existing: ProductKnowledgeProject | undefined,
) {
  if (input.projectId && !existing) throw new ProductProjectError("not_found", `项目不存在：${input.projectId}`);
  if (existing?.status === "archived") throw new ProductProjectError("archived", "归档项目不能保存草稿");
  if (existing && existing.revision !== input.expectedRevision) throw revisionConflict(existing.id);
}

function pickCategoryContent(input: ProductProjectDraftInput["categoryDefinition"]) {
  const { categoryCode: _categoryCode, label: _label, ...content } = input;
  return content;
}

function toDefinitionRow(definition: CategoryDefinitionVersion) {
  const { sourceAuthorityPolicy, attributes, decisionDimensions, competencyQuestions, ...metadata } = definition;
  return { ...metadata, content: { sourceAuthorityPolicy, attributes, decisionDimensions, competencyQuestions } };
}

function toScopeRow(scope: ConfirmedScopeVersion) {
  const { populationLayers, targets, ...metadata } = scope;
  return { ...metadata, content: { populationLayers, targets } };
}

function toBoardRow(board: CollectionBoardVersion) {
  const { lanes, ...metadata } = board;
  return { ...metadata, content: { lanes } };
}

async function findProject(db: ProductKnowledgeDb, projectId: string) {
  const project = await db.query.productKnowledgeProjects.findFirst({
    where: eq(productKnowledgeProjects.id, projectId),
  });
  return project ? normalizeProject(project) : undefined;
}

function normalizeProject(project: typeof productKnowledgeProjects.$inferSelect) {
  return productKnowledgeProjectSchema.parse({
    ...project,
    createdAt: normalizeTimestamp(project.createdAt),
    updatedAt: normalizeTimestamp(project.updatedAt),
  });
}

function normalizeTimestamp(value: string) {
  return new Date(value).toISOString();
}

async function supersedeDraftVersions(transaction: Parameters<Parameters<ProductKnowledgeDb["transaction"]>[0]>[0], projectId: string) {
  await transaction.update(categoryDefinitionVersions).set({ status: "superseded" }).where(and(
    eq(categoryDefinitionVersions.projectId, projectId), eq(categoryDefinitionVersions.status, "draft"),
  ));
  await transaction.update(confirmedScopeVersions).set({ status: "superseded" }).where(and(
    eq(confirmedScopeVersions.projectId, projectId), eq(confirmedScopeVersions.status, "draft"),
  ));
  await transaction.update(collectionBoardVersions).set({ status: "superseded" }).where(and(
    eq(collectionBoardVersions.projectId, projectId), eq(collectionBoardVersions.status, "draft"),
  ));
}

async function supersedeConfirmedVersions(transaction: Parameters<Parameters<ProductKnowledgeDb["transaction"]>[0]>[0], projectId: string) {
  await transaction.update(categoryDefinitionVersions).set({ status: "superseded" }).where(and(
    eq(categoryDefinitionVersions.projectId, projectId), eq(categoryDefinitionVersions.status, "confirmed"),
  ));
  await transaction.update(confirmedScopeVersions).set({ status: "superseded" }).where(and(
    eq(confirmedScopeVersions.projectId, projectId), eq(confirmedScopeVersions.status, "confirmed"),
  ));
  await transaction.update(collectionBoardVersions).set({ status: "superseded" }).where(and(
    eq(collectionBoardVersions.projectId, projectId), eq(collectionBoardVersions.status, "confirmed"),
  ));
}

function revisionConflict(projectId: string) {
  return new ProductProjectError("revision_conflict", `项目版本已变化，请重新读取：${projectId}`);
}
