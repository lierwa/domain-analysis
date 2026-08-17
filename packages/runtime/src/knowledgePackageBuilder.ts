import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import {
  knowledgePackageBuildInputSchema,
  knowledgePackageDescriptorSchema,
  knowledgePackageManifestSchema,
  knowledgePackageSchemaVersion,
  stateEvidenceIds,
  type KnowledgePackageBuildInput,
  type KnowledgePackageDescriptor,
  type KnowledgePackageManifest,
  type PublishableKnowledgeState,
} from "@domain-analysis/shared";
import canonicalize from "canonicalize";

export async function buildKnowledgePackage(
  rawInput: KnowledgePackageBuildInput,
  outputRoot: string,
): Promise<KnowledgePackageDescriptor> {
  const input = normalizeInput(rawInput);
  // WHY：构建时间是发布元数据，不是知识内容；否则同一审核结果每次重建都会伪造新版本。
  const versionHash = sha256(canonical(versionContent(input)));
  const manifest = knowledgePackageManifestSchema.parse({
    schemaVersion: knowledgePackageSchemaVersion,
    packageId: `knowledge-package-${versionHash.slice(0, 32)}`,
    versionHash,
    projectId: input.projectId,
    categoryDefinitionVersionId: input.categoryDefinitionVersionId,
    createdAt: input.createdAt,
    stateCount: input.states.length,
    evidenceCount: input.evidence.length,
  });
  const versionsRoot = path.resolve(outputRoot, "versions");
  await mkdir(versionsRoot, { recursive: true });
  const filePath = path.join(versionsRoot, `${versionHash}.sqlite`);
  const existing = await descriptorForExisting(filePath, versionHash);
  if (existing) return existing;
  const temporaryPath = path.join(versionsRoot, `.${versionHash}.${randomUUID()}.tmp`);
  const db = createClient({ url: `file:${temporaryPath}` });
  try {
    await createSchema(db);
    await insertPackage(db, manifest, input);
    await db.execute("PRAGMA optimize");
  } catch (error) {
    await removeTemporary(temporaryPath, db);
    throw error;
  }
  db.close();
  await chmod(temporaryPath, 0o444);
  await rename(temporaryPath, filePath);
  return createDescriptor(filePath, manifest);
}

export async function describeKnowledgePackage(filePath: string) {
  const { openKnowledgeRuntime } = await import("./knowledgeRuntime");
  const runtime = await openKnowledgeRuntime(filePath);
  const manifest = runtime.manifest;
  runtime.close();
  return createDescriptor(filePath, manifest);
}

async function createSchema(db: Client) {
  await db.execute("PRAGMA foreign_keys=ON");
  await db.execute("PRAGMA journal_mode=DELETE");
  await db.execute("CREATE TABLE package_meta(key TEXT PRIMARY KEY, value_json TEXT NOT NULL)");
  await db.execute(`CREATE TABLE knowledge_states(
    state_id TEXT PRIMARY KEY,
    state_kind TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    subject_kind TEXT NOT NULL,
    subject_label TEXT NOT NULL,
    knowledge_need_id TEXT NOT NULL,
    knowledge_layer TEXT,
    predicate TEXT,
    numeric_value REAL,
    unit_code TEXT,
    value_text TEXT,
    reason_code TEXT,
    confirmed_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  )`);
  await db.execute("CREATE INDEX knowledge_states_subject_idx ON knowledge_states(subject_key, predicate)");
  await db.execute("CREATE INDEX knowledge_states_filter_idx ON knowledge_states(state_kind, subject_kind, knowledge_layer, predicate)");
  await db.execute(`CREATE TABLE evidence(
    evidence_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    source_identity TEXT NOT NULL,
    source_authority_type TEXT NOT NULL,
    source_url TEXT NOT NULL,
    content_integrity TEXT NOT NULL,
    redistribution_allowed INTEGER NOT NULL,
    payload_json TEXT NOT NULL
  )`);
  await db.execute(`CREATE TABLE state_evidence(
    state_id TEXT NOT NULL REFERENCES knowledge_states(state_id),
    evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id),
    PRIMARY KEY(state_id, evidence_id)
  )`);
  await db.execute(`CREATE TABLE relations(
    state_id TEXT PRIMARY KEY REFERENCES knowledge_states(state_id),
    source_subject_key TEXT NOT NULL,
    predicate TEXT NOT NULL,
    target_subject_key TEXT NOT NULL,
    target_subject_kind TEXT NOT NULL,
    target_subject_label TEXT NOT NULL
  )`);
  await db.execute("CREATE INDEX relations_source_idx ON relations(source_subject_key, predicate)");
  await db.execute("CREATE INDEX relations_target_idx ON relations(target_subject_key, predicate)");
  await db.execute("CREATE VIRTUAL TABLE search_documents USING fts5(state_id UNINDEXED, content, tokenize='trigram')");
}

async function insertPackage(
  db: Client,
  manifest: KnowledgePackageManifest,
  input: ReturnType<typeof normalizeInput>,
) {
  await db.execute({
    sql: "INSERT INTO package_meta(key, value_json) VALUES (?, ?)",
    args: ["manifest", canonical(manifest)],
  });
  for (const evidence of input.evidence) {
    await db.execute({
      sql: "INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [evidence.id, evidence.kind, evidence.sourceIdentity, evidence.sourceAuthorityType,
        evidence.sourceUrl, evidence.contentIntegrity, evidence.redistributionAllowed ? 1 : 0,
        canonical(evidence)],
    });
  }
  for (const state of input.states) {
    const row = stateRow(state);
    await db.execute({
      sql: "INSERT INTO knowledge_states VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [row.id, state.kind, row.subject.key, row.subject.kind, row.subject.label,
        row.knowledgeNeedId, row.knowledgeLayer, row.predicate, row.numericValue,
        row.unitCode, row.valueText, row.reasonCode, row.confirmedAt, canonical(state)],
    });
    for (const evidenceId of stateEvidenceIds(state)) {
      await db.execute({
        sql: "INSERT INTO state_evidence(state_id, evidence_id) VALUES (?, ?)",
        args: [row.id, evidenceId],
      });
    }
    if (state.kind === "fact" && state.entry.value.kind === "subject_ref") {
      const target = state.entry.value.subject;
      await db.execute({
        sql: "INSERT INTO relations VALUES (?, ?, ?, ?, ?, ?)",
        args: [row.id, row.subject.key, row.predicate, target.key, target.kind, target.label],
      });
    }
    await db.execute({
      sql: "INSERT INTO search_documents(state_id, content) VALUES (?, ?)",
      args: [row.id, searchContent(state)],
    });
  }
}

function stateRow(state: PublishableKnowledgeState) {
  if (state.kind === "fact") {
    const value = state.entry.value;
    return {
      id: state.entry.sourceTargetId,
      subject: state.entry.subject,
      knowledgeNeedId: state.entry.knowledgeNeedId,
      knowledgeLayer: state.entry.knowledgeLayer,
      predicate: state.entry.predicate,
      numericValue: value.kind === "decimal" ? value.value : null,
      unitCode: value.kind === "decimal" ? value.unitCode : null,
      valueText: value.kind === "subject_ref" ? value.subject.label : value.raw,
      reasonCode: null,
      confirmedAt: state.entry.confirmedAt,
    };
  }
  return {
    id: state.sourceTargetId,
    subject: state.subject,
    knowledgeNeedId: state.knowledgeNeedId,
    knowledgeLayer: state.kind === "conflict" ? state.knowledgeLayer : null,
    predicate: state.kind === "conflict" ? state.predicate : null,
    numericValue: null,
    unitCode: null,
    valueText: state.kind === "unknown" ? state.question : state.alternatives.map(({ value }) =>
      value.kind === "subject_ref" ? value.subject.label : value.raw).join(" | "),
    reasonCode: state.reasonCode,
    confirmedAt: state.confirmedAt,
  };
}

function searchContent(state: PublishableKnowledgeState) {
  const row = stateRow(state);
  const detail = state.kind === "fact"
    ? state.entry.limitations
    : state.kind === "conflict"
      ? state.alternatives.map(({ value }) => value.kind === "subject_ref" ? value.subject.label : value.raw)
      : [state.question];
  return [row.subject.key, row.subject.label, row.predicate, row.valueText, row.reasonCode, ...detail]
    .filter(Boolean).join(" ");
}

function normalizeInput(rawInput: KnowledgePackageBuildInput) {
  const input = knowledgePackageBuildInputSchema.parse(rawInput);
  return {
    ...input,
    states: [...input.states].sort((left, right) => stateId(left).localeCompare(stateId(right))),
    evidence: [...input.evidence].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function versionContent(input: ReturnType<typeof normalizeInput>) {
  const { createdAt: _buildTimestamp, ...content } = input;
  return content;
}

function stateId(state: PublishableKnowledgeState) {
  return state.kind === "fact" ? state.entry.sourceTargetId : state.sourceTargetId;
}

async function descriptorForExisting(filePath: string, expectedVersionHash: string) {
  try {
    // WHY：libSQL 打开不存在的 file: URL 会创建空库，必须先用文件系统判定是否已有版本。
    await stat(filePath);
    const descriptor = await describeKnowledgePackage(filePath);
    if (descriptor.versionHash !== expectedVersionHash) {
      throw new Error(`知识包文件名与 manifest 版本不一致：${filePath}`);
    }
    return descriptor;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function createDescriptor(filePath: string, manifest: KnowledgePackageManifest) {
  const bytes = await readFile(filePath);
  return knowledgePackageDescriptorSchema.parse({
    ...manifest,
    filePath,
    databaseSha256: sha256(bytes),
    bytes: (await stat(filePath)).size,
  });
}

async function removeTemporary(filePath: string, db: Client) {
  db.close();
  await rm(filePath, { force: true });
}

function canonical(value: unknown) {
  const result = canonicalize(value);
  if (!result) throw new Error("无法序列化知识包内容");
  return result;
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
