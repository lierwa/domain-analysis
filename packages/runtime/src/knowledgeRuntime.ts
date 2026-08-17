import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createClient, type Client, type InValue } from "@libsql/client";
import {
  knowledgePackageEvidenceSchema,
  knowledgePackageManifestSchema,
  publishableKnowledgeStateSchema,
  type KnowledgePackageEvidence,
  type KnowledgePackageManifest,
  type PublishableKnowledgeState,
} from "@domain-analysis/shared";
import { z } from "zod";

const exactQuerySchema = z.object({
  subjectKey: z.string().min(1),
  predicate: z.string().min(1).optional(),
}).strict();
const filterQuerySchema = z.object({
  stateKinds: z.array(z.enum(["fact", "conflict", "unknown"])).min(1).optional(),
  subjectKind: z.string().min(1).optional(),
  knowledgeLayer: z.string().min(1).optional(),
  predicate: z.string().min(1).optional(),
  numericMin: z.number().finite().optional(),
  numericMax: z.number().finite().optional(),
  unitCode: z.string().min(1).optional(),
  limit: z.number().int().positive().max(100).default(20),
}).strict().refine((query) => query.numericMin === undefined
  || query.numericMax === undefined
  || query.numericMin <= query.numericMax, "数值下限不能大于上限");

export interface KnowledgeRuntime {
  readonly manifest: KnowledgePackageManifest;
  exact(input: z.input<typeof exactQuerySchema>): Promise<PublishableKnowledgeState[]>;
  filter(input: z.input<typeof filterQuerySchema>): Promise<PublishableKnowledgeState[]>;
  search(term: string, limit?: number): Promise<PublishableKnowledgeState[]>;
  relations(subjectKey: string): Promise<Array<{
    stateId: string;
    sourceSubjectKey: string;
    predicate: string;
    targetSubjectKey: string;
    targetSubjectKind: string;
    targetSubjectLabel: string;
  }>>;
  evidenceFor(stateId: string): Promise<KnowledgePackageEvidence[]>;
  getEvidence(evidenceId: string): Promise<KnowledgePackageEvidence | null>;
  verifyReadOnly(): Promise<boolean>;
  close(): void;
}

export async function openKnowledgeRuntime(
  filePath: string,
  expectedDatabaseSha256?: string,
): Promise<KnowledgeRuntime> {
  if (expectedDatabaseSha256) {
    const actual = sha256(await readFile(filePath));
    if (actual !== expectedDatabaseSha256) throw new Error("知识包文件哈希不匹配");
  }
  const db = createClient({ url: `file:${filePath}` });
  await db.execute("PRAGMA query_only=ON");
  const meta = await db.execute({
    sql: "SELECT value_json FROM package_meta WHERE key = ?",
    args: ["manifest"],
  });
  const value = meta.rows[0]?.value_json;
  if (typeof value !== "string") {
    db.close();
    throw new Error("知识包缺少 manifest");
  }
  const manifest = knowledgePackageManifestSchema.parse(JSON.parse(value));
  return createRuntime(db, manifest);
}

function createRuntime(db: Client, manifest: KnowledgePackageManifest): KnowledgeRuntime {
  return Object.freeze({
    manifest,
    exact: async (rawInput: z.input<typeof exactQuerySchema>) => {
      const input = exactQuerySchema.parse(rawInput);
      const conditions = ["subject_key = ?"];
      const args: InValue[] = [input.subjectKey];
      if (input.predicate) { conditions.push("predicate = ?"); args.push(input.predicate); }
      return stateRows(db, `SELECT payload_json FROM knowledge_states WHERE ${conditions.join(" AND ")} ORDER BY state_id`, args);
    },
    filter: async (rawInput: z.input<typeof filterQuerySchema>) => {
      const input = filterQuerySchema.parse(rawInput);
      const conditions: string[] = [];
      const args: InValue[] = [];
      if (input.stateKinds) {
        conditions.push(`state_kind IN (${placeholders(input.stateKinds.length)})`);
        args.push(...input.stateKinds);
      }
      addEquals(conditions, args, "subject_kind", input.subjectKind);
      addEquals(conditions, args, "knowledge_layer", input.knowledgeLayer);
      addEquals(conditions, args, "predicate", input.predicate);
      addEquals(conditions, args, "unit_code", input.unitCode);
      if (input.numericMin !== undefined) { conditions.push("numeric_value >= ?"); args.push(input.numericMin); }
      if (input.numericMax !== undefined) { conditions.push("numeric_value <= ?"); args.push(input.numericMax); }
      args.push(input.limit);
      const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
      return stateRows(db, `SELECT payload_json FROM knowledge_states${where} ORDER BY state_id LIMIT ?`, args);
    },
    search: async (term: string, rawLimit = 10) => {
      const query = z.string().trim().min(1).max(500).parse(term);
      const limit = z.number().int().positive().max(100).parse(rawLimit);
      return stateRows(db, `SELECT s.payload_json FROM search_documents f
        JOIN knowledge_states s ON s.state_id = f.state_id
        WHERE search_documents MATCH ? ORDER BY rank LIMIT ?`, [ftsPhrase(query), limit]);
    },
    relations: async (subjectKey: string) => {
      const key = z.string().min(1).parse(subjectKey);
      const result = await db.execute({
        sql: `SELECT state_id AS stateId, source_subject_key AS sourceSubjectKey,
          predicate, target_subject_key AS targetSubjectKey,
          target_subject_kind AS targetSubjectKind, target_subject_label AS targetSubjectLabel
          FROM relations WHERE source_subject_key = ? OR target_subject_key = ? ORDER BY state_id`,
        args: [key, key],
      });
      return result.rows.map((row) => ({
        stateId: String(row.stateId), sourceSubjectKey: String(row.sourceSubjectKey),
        predicate: String(row.predicate), targetSubjectKey: String(row.targetSubjectKey),
        targetSubjectKind: String(row.targetSubjectKind), targetSubjectLabel: String(row.targetSubjectLabel),
      }));
    },
    evidenceFor: async (stateId: string) => {
      const id = z.string().min(1).parse(stateId);
      const result = await db.execute({
        sql: `SELECT e.payload_json FROM evidence e JOIN state_evidence se
          ON se.evidence_id = e.evidence_id WHERE se.state_id = ? ORDER BY e.evidence_id`,
        args: [id],
      });
      return result.rows.map(({ payload_json }) => parseEvidence(payload_json));
    },
    getEvidence: async (evidenceId: string) => {
      const id = z.string().min(1).parse(evidenceId);
      const result = await db.execute({
        sql: "SELECT payload_json FROM evidence WHERE evidence_id = ?",
        args: [id],
      });
      return result.rows[0] ? parseEvidence(result.rows[0].payload_json) : null;
    },
    verifyReadOnly: () => verifyReadOnly(db),
    close: () => db.close(),
  });
}

async function stateRows(db: Client, sql: string, args: InValue[]) {
  const result = await db.execute({ sql, args });
  return result.rows.map(({ payload_json }) => {
    if (typeof payload_json !== "string") throw new Error("知识状态 payload 不是 JSON 文本");
    return publishableKnowledgeStateSchema.parse(JSON.parse(payload_json));
  });
}

function parseEvidence(value: unknown) {
  if (typeof value !== "string") throw new Error("证据 payload 不是 JSON 文本");
  return knowledgePackageEvidenceSchema.parse(JSON.parse(value));
}

async function verifyReadOnly(db: Client) {
  try {
    await db.execute("CREATE TABLE forbidden_write(value TEXT)");
    return false;
  } catch {
    return true;
  }
}

function addEquals(conditions: string[], args: InValue[], column: string, value?: string) {
  if (value === undefined) return;
  conditions.push(`${column} = ?`);
  args.push(value);
}

function placeholders(length: number) { return Array.from({ length }, () => "?").join(", "); }

function ftsPhrase(value: string) {
  // WHY：型号中的连字符属于内容而不是 FTS 语法，短语查询避免把它解释为运算符。
  return `"${value.replaceAll('"', '""')}"`;
}

function sha256(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
