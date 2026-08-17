import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  KnowledgePackageBuildInput,
  KnowledgePackageEvidence,
  PublishableKnowledgeState,
} from "@domain-analysis/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  activateKnowledgePackage,
  buildKnowledgePackage,
  openActiveKnowledgeRuntime,
  openKnowledgeRuntime,
  readActiveKnowledgePackage,
  rollbackKnowledgePackage,
} from "../src";

describe("SQLite + FTS5 knowledge package runtime", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("构建单文件包并提供精确、筛选、全文、关系、证据和只读查询", async () => {
    const root = await temporaryRoot();
    const descriptor = await buildKnowledgePackage(fixture(), root);
    const runtime = await openKnowledgeRuntime(descriptor.filePath, descriptor.databaseSha256);
    try {
      expect(runtime.manifest).toMatchObject({ stateCount: 4, evidenceCount: 4 });
      expect(await runtime.exact({ subjectKey: "model:tv-144", predicate: "display.refresh_rate" }))
        .toMatchObject([{ kind: "fact", entry: { value: { kind: "decimal", value: 144, unitCode: "Hz" } } }]);
      expect(await runtime.filter({ subjectKind: "model", numericMin: 120, unitCode: "Hz" }))
        .toHaveLength(1);
      expect(await runtime.search("净味抗菌")).toMatchObject([{ kind: "fact" }]);
      expect(await runtime.relations("model:tv-144")).toMatchObject([{
        sourceSubjectKey: "model:tv-144",
        predicate: "uses.panel_technology",
        targetSubjectKey: "concept:miniled",
      }]);
      expect(await runtime.evidenceFor("candidate:refresh")).toMatchObject([{
        id: "evidence:public",
        redistributionAllowed: true,
        content: "规格参数\n刷新率: 144 Hz",
      }]);
      expect(await runtime.getEvidence("evidence:restricted")).toMatchObject({
        redistributionAllowed: false,
      });
      expect((await runtime.getEvidence("evidence:restricted"))?.content).toBeUndefined();
      expect(await runtime.filter({ stateKinds: ["conflict", "unknown"] })).toHaveLength(2);
      expect(await runtime.verifyReadOnly()).toBe(true);
    } finally {
      runtime.close();
    }

    const copiedPath = path.join(await temporaryRoot(), "copied.sqlite");
    await copyFile(descriptor.filePath, copiedPath);
    const copied = await openKnowledgeRuntime(copiedPath, descriptor.databaseSha256);
    expect(await copied.search("TV-144")).toHaveLength(3);
    copied.close();
  });

  it("先验哈希后原子切换，保留旧版本并可回滚", async () => {
    const root = await temporaryRoot();
    const first = await buildKnowledgePackage(fixture(), root);
    const second = await buildKnowledgePackage(fixture("2026-08-17T13:00:00.000Z"), root);
    await activateKnowledgePackage(root, first, () => new Date("2026-08-17T14:00:00.000Z"));
    await activateKnowledgePackage(root, second, () => new Date("2026-08-17T15:00:00.000Z"));
    expect((await readActiveKnowledgePackage(root))?.versionHash).toBe(second.versionHash);
    await rollbackKnowledgePackage(root);
    expect((await readActiveKnowledgePackage(root))?.versionHash).toBe(first.versionHash);
    const runtime = await openActiveKnowledgeRuntime(root);
    expect(runtime.manifest.versionHash).toBe(first.versionHash);
    runtime.close();
  });

  it("相同知识内容重复构建不会因构建时间生成伪版本", async () => {
    const root = await temporaryRoot();
    const input = fixture();
    const first = await buildKnowledgePackage(input, root);
    const rebuilt = await buildKnowledgePackage({
      ...input,
      createdAt: "2026-08-18T12:00:00.000Z",
    }, root);

    expect(rebuilt.versionHash).toBe(first.versionHash);
    expect(rebuilt.filePath).toBe(first.filePath);
    expect(rebuilt.createdAt).toBe(first.createdAt);
  });

  async function temporaryRoot() {
    const root = await mkdtemp(path.join(tmpdir(), "knowledge-runtime-"));
    roots.push(root);
    return root;
  }
});

function fixture(createdAt = "2026-08-17T12:00:00.000Z"): KnowledgePackageBuildInput {
  return {
    projectId: "project-tv",
    categoryDefinitionVersionId: "definition-tv-v1",
    createdAt,
    states: states(createdAt),
    evidence: evidence(),
  };
}

function states(confirmedAt: string): PublishableKnowledgeState[] {
  return [
    {
      kind: "fact",
      entry: {
        sourceTargetKind: "candidate",
        sourceTargetId: "candidate:refresh",
        decisionId: "decision:refresh",
        projectId: "project-tv",
        categoryDefinitionVersionId: "definition-tv-v1",
        knowledgeNeedId: "need:refresh",
        subject: { kind: "model", key: "model:tv-144", label: "TV-144" },
        knowledgeLayer: "specification",
        predicate: "display.refresh_rate",
        value: { kind: "decimal", raw: "规格参数\n刷新率: 144 Hz", value: 144, unitCode: "Hz" },
        evidenceIds: ["evidence:public"],
        limitations: [],
        confirmedAt,
      },
    },
    {
      kind: "fact",
      entry: {
        sourceTargetKind: "candidate",
        sourceTargetId: "candidate:relation",
        decisionId: "decision:relation",
        projectId: "project-tv",
        categoryDefinitionVersionId: "definition-tv-v1",
        knowledgeNeedId: "need:panel",
        subject: { kind: "model", key: "model:tv-144", label: "TV-144" },
        knowledgeLayer: "mechanism",
        predicate: "uses.panel_technology",
        value: { kind: "subject_ref", subject: { kind: "foundational_concept", key: "concept:miniled", label: "Mini LED" } },
        evidenceIds: ["evidence:restricted"],
        limitations: ["净味抗菌仅用于验证中文全文，不代表电视属性。"],
        confirmedAt,
      },
    },
    {
      kind: "conflict",
      sourceTargetId: "conflict:brightness",
      decisionId: "decision:conflict",
      projectId: "project-tv",
      categoryDefinitionVersionId: "definition-tv-v1",
      knowledgeNeedId: "need:brightness",
      subject: { kind: "model", key: "model:tv-conflict", label: "TV-Conflict" },
      knowledgeLayer: "specification",
      predicate: "display.peak_brightness",
      alternatives: [
        { value: { kind: "decimal", raw: "1000 nit", value: 1000, unitCode: "nit" }, evidenceIds: ["evidence:conflict-a"] },
        { value: { kind: "decimal", raw: "1200 nit", value: 1200, unitCode: "nit" }, evidenceIds: ["evidence:conflict-b"] },
      ],
      reasonCode: "distinct_normalized_values",
      confirmedAt,
    },
    {
      kind: "unknown",
      sourceTargetId: "unknown:latency",
      decisionId: "decision:unknown",
      projectId: "project-tv",
      categoryDefinitionVersionId: "definition-tv-v1",
      knowledgeNeedId: "need:latency",
      subject: { kind: "model", key: "model:tv-144", label: "TV-144" },
      question: "游戏输入延迟是多少？",
      reasonCode: "evidence_missing",
      evidenceRequestIds: ["request:latency"],
      evidenceIds: [],
      confirmedAt,
    },
  ];
}

function evidence(): KnowledgePackageEvidence[] {
  return [
    evidenceRecord("evidence:public", true, "规格参数\n刷新率: 144 Hz"),
    evidenceRecord("evidence:restricted", false),
    evidenceRecord("evidence:conflict-a", false),
    evidenceRecord("evidence:conflict-b", false),
  ];
}

function evidenceRecord(id: string, redistributionAllowed: boolean, content?: string): KnowledgePackageEvidence {
  return {
    id,
    kind: "web_text",
    mediaType: "text/plain;charset=utf-8",
    sourceIdentity: `source:${id}`,
    sourceAuthorityType: "brand_official_site",
    sourceUrl: `https://example.com/${encodeURIComponent(id)}`,
    locator: {
      kind: "web_text",
      quote: { exact: id, prefix: "source " },
      structuralHint: "fixture",
    },
    contentIntegrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    capturedAt: "2026-08-17T11:00:00.000Z",
    redistributionAllowed,
    ...(content ? { contentEncoding: "utf8" as const, content } : {}),
    permissionBasis: "测试 fixture",
  };
}
