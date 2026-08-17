import { randomUUID } from "node:crypto";

import {
  categoryDefinitionVersions,
  createProductKnowledgeDb,
  migrateProductKnowledgeDatabase,
} from "@domain-analysis/db";
import type { ProductProjectDraftInput } from "@domain-analysis/shared";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  createProductProjectModule,
  ProductProjectError,
} from "./productProjectModule";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;
const clients: Array<ReturnType<typeof createProductKnowledgeDb>["$client"]> = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.end()));
});

describeWithPostgres("ProductProjectModule", () => {
  it("atomically saves, confirms and reads a complete project version", async () => {
    const db = await openTestDatabase();
    const module = createProductProjectModule(db, deterministicOptions());

    const draft = await module.saveDraft(createDraft());
    expect(draft.project).toMatchObject({ revision: 1, status: "draft" });
    expect(draft.categoryDefinition.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const confirmed = await module.confirm(draft.project.id, draft.project.revision);
    expect(confirmed.project.status).toBe("ready");
    expect(confirmed.categoryDefinition.status).toBe("confirmed");

    const reloaded = await module.get(draft.project.id);
    expect(reloaded).toEqual(confirmed);
    expect("content" in reloaded!.categoryDefinition).toBe(false);
  });

  it("preserves project creation time and stable content hashes across revisions", async () => {
    const db = await openTestDatabase();
    const options = deterministicOptions([
      "2026-08-14T01:00:00.000Z",
      "2026-08-14T02:00:00.000Z",
    ]);
    const module = createProductProjectModule(db, options);
    const first = await module.saveDraft(createDraft());
    const second = await module.saveDraft({
      ...createDraft(),
      projectId: first.project.id,
      expectedRevision: first.project.revision,
    });

    expect(second.project).toMatchObject({
      revision: 2,
      createdAt: "2026-08-14T01:00:00.000Z",
      updatedAt: "2026-08-14T02:00:00.000Z",
    });
    expect(second.categoryDefinition.contentHash).toBe(first.categoryDefinition.contentHash);
    expect(second.confirmedScope.contentHash).toBe(first.confirmedScope.contentHash);
    expect(second.collectionBoard.contentHash).toBe(first.collectionBoard.contentHash);

    const oldDefinition = await db.query.categoryDefinitionVersions.findFirst({
      where: eq(categoryDefinitionVersions.id, first.categoryDefinition.id),
    });
    expect(oldDefinition?.status).toBe("superseded");
  });

  it("rejects stale revisions without overwriting the current project", async () => {
    const db = await openTestDatabase();
    const module = createProductProjectModule(db, deterministicOptions());
    const first = await module.saveDraft(createDraft());
    await module.saveDraft({
      ...createDraft(),
      projectId: first.project.id,
      expectedRevision: 1,
      name: "冰箱知识项目 v2",
    });

    await expect(module.saveDraft({
      ...createDraft(),
      projectId: first.project.id,
      expectedRevision: 1,
      name: "过期写入",
    })).rejects.toMatchObject({ code: "revision_conflict" });
    expect((await module.get(first.project.id))?.project.name).toBe("冰箱知识项目 v2");
  });

  it("validates the whole collection board before writing", async () => {
    const db = await openTestDatabase();
    const idPrefix = `validation-${randomUUID()}`;
    const module = createProductProjectModule(db, deterministicOptions(undefined, idPrefix));
    const invalid = createDraft();
    invalid.collectionBoard.lanes[0]!.targetKeys = ["brand:not-in-scope"];

    await expect(module.saveDraft(invalid)).rejects.toThrow("搜集板引用了未纳入范围的目标");
    expect(await module.get(`${idPrefix}-project-1`)).toBeNull();
  });

  it("rolls back the project when a version insert fails", async () => {
    const db = await openTestDatabase();
    const idPrefix = `rollback-${randomUUID()}`;
    const first = createProductProjectModule(db, deterministicOptions(undefined, idPrefix));
    await first.saveDraft(createDraft());
    const conflicting = createProductProjectModule(db, {
      now: () => new Date("2026-08-14T03:00:00.000Z"),
      createId: (kind) => kind === "project"
        ? `${idPrefix}-project-2`
        : `${idPrefix}-${kind}-1`,
    });

    await expect(conflicting.saveDraft({ ...createDraft(), name: "第二个项目" })).rejects.toThrow();
    expect(await conflicting.get(`${idPrefix}-project-2`)).toBeNull();
  });

  it("returns a typed not-found error when confirming a missing project", async () => {
    const db = await openTestDatabase();
    const module = createProductProjectModule(db, deterministicOptions());

    await expect(module.confirm("missing", 1)).rejects.toBeInstanceOf(ProductProjectError);
    await expect(module.confirm("missing", 1)).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists project summaries by most recent update", async () => {
    const db = await openTestDatabase();
    const module = createProductProjectModule(db, deterministicOptions([
      "2026-08-14T01:00:00.000Z",
      "2026-08-14T02:00:00.000Z",
    ]));
    const first = await module.saveDraft(createDraft());
    const second = await module.saveDraft({ ...createDraft(), name: "第二个知识项目" });

    const projectIds = new Set([first.project.id, second.project.id]);
    expect((await module.list()).filter((project) => projectIds.has(project.id)).map((project) => project.name))
      .toEqual(["第二个知识项目", "冰箱知识项目"]);
  });
});

function createDraft(): ProductProjectDraftInput {
  return {
    name: "冰箱知识项目",
    knowledgeTopic: "中国市场冰箱专业导购知识",
    market: "CN",
    categoryDefinition: {
      categoryCode: "refrigerator",
      label: "冰箱",
      sourceAuthorityPolicy: ["brand_official_site", "brand_flagship_store"],
      attributes: [{
        code: "capacity.total",
        label: "总容积",
        description: "产品标称总容积",
        knowledgeLayer: "specification",
        valueKind: "decimal",
        canonicalUnitCode: "L",
        externalMappings: [],
        filterable: true,
        comparable: true,
      }],
      decisionDimensions: [{
        code: "household.capacity",
        label: "家庭容量适配",
        description: "按家庭人数判断容量是否适合",
        relatedAttributeCodes: ["capacity.total"],
      }],
      competencyQuestions: ["三口之家需要多大容量？"],
    },
    confirmedScope: {
      populationLayers: ["official_current_catalog"],
      targets: [{
        key: "brand:haier",
        kind: "brand",
        label: "海尔",
        evidenceReferenceIds: ["evidence-1"],
        disposition: "included",
        reason: "官方在售主流品牌",
      }],
    },
    collectionBoard: {
      lanes: [{
        id: "lane-official-site",
        sourceAuthorityType: "brand_official_site",
        accessMode: "public_web",
        targetKeys: ["brand:haier"],
        knowledgeLayers: ["identity", "specification"],
        refreshPolicy: "weekly",
        stopConditions: ["login_required", "verification_required"],
      }],
    },
  };
}

function deterministicOptions(
  timestamps = ["2026-08-14T01:00:00.000Z"],
  idPrefix = `project-module-${randomUUID()}`,
) {
  const counters = { project: 0, definition: 0, scope: 0, board: 0 };
  let timeIndex = 0;
  return {
    now: () => new Date(timestamps[Math.min(timeIndex++, timestamps.length - 1)]!),
    createId: (kind: keyof typeof counters) => `${idPrefix}-${kind}-${++counters[kind]}`,
  };
}

async function openTestDatabase() {
  await migrateProductKnowledgeDatabase(databaseUrl!);
  const db = createProductKnowledgeDb(databaseUrl!);
  clients.push(db.$client);
  return db;
}
