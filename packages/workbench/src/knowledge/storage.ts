import { createHash, randomUUID } from "node:crypto";
import { knowledgeAiReviews, knowledgeDecisions, knowledgeItems, knowledgePacks, knowledgeRuns, knowledgeVersions,
  type WorkbenchDb } from "@domain-analysis/db";
import { knowledgeAiReviewSchema, knowledgeItemSchema, knowledgePackSchema, knowledgeRunSchema, knowledgeVersionSchema,
  type KnowledgeCommand } from "@domain-analysis/shared";
import cacache from "cacache";
import canonicalize from "canonicalize";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { ProcessingInputReader } from "../sourceDatasetProcessingInputs";
import type { KnowledgeAiReviewer } from "./aiReviewer";
import type { KnowledgeProcessor } from "./processor";

export class KnowledgeProcessingError extends Error {
  constructor(readonly code: "not_found" | "conflict" | "invalid_input" | "unavailable", message: string) {
    super(message); this.name = "KnowledgeProcessingError";
  }
}
export type KnowledgeTransaction = Parameters<Parameters<WorkbenchDb["transaction"]>[0]>[0];
export type KnowledgeDb = WorkbenchDb | KnowledgeTransaction;
export type KnowledgeContext = { db: WorkbenchDb; sources: ProcessingInputReader; artifactPath: string;
  processor: KnowledgeProcessor; aiReviewer?: KnowledgeAiReviewer };
export const createId = (kind: string) => `knowledge-${kind}-${randomUUID()}`;
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const digest = (value: unknown) => sha256(canonicalize(value)!);
export const timestamp = () => new Date().toISOString();
export function requireValue<T>(value: T | undefined | null, message = "加工记录不存在"): T {
  if (value == null) throw new KnowledgeProcessingError("not_found", message);
  return value;
}
export function assertRevision(actual: number, expected: number) {
  if (actual !== expected) throw new KnowledgeProcessingError("conflict", "记录已更新，请刷新后继续");
}

// WHY：数据库的空值与时间表示只在持久化边界归一化，界面直接消费校验后的领域契约。
function normalized(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)
    .map(([key, value]) => [key, key.endsWith("At") && typeof value === "string"
      ? new Date(value).toISOString() : value]));
}
export const asPack = (row: typeof knowledgePacks.$inferSelect) => knowledgePackSchema.parse(normalized(row));
export const asRun = (row: typeof knowledgeRuns.$inferSelect) => knowledgeRunSchema.parse({ ...normalized(row), llmCalls: 0, llmTokens: 0 });
export const asVersion = (row: typeof knowledgeVersions.$inferSelect) => knowledgeVersionSchema.parse(normalized(row));
export const asItem = ({ inputKey: _, ...row }: typeof knowledgeItems.$inferSelect) => knowledgeItemSchema.parse(normalized(row));
export const asAiReview = (row: typeof knowledgeAiReviews.$inferSelect) => knowledgeAiReviewSchema.parse(normalized(row));

export async function readPack(db: KnowledgeDb, id: string) {
  const [row] = await db.select().from(knowledgePacks).where(eq(knowledgePacks.id, id));
  return asPack(requireValue(row));
}
export async function readRun(db: KnowledgeDb, packId: string, id: string) {
  const [row] = await db.select().from(knowledgeRuns).where(eq(knowledgeRuns.id, id));
  const run = asRun(requireValue(row));
  if (run.packId !== packId) throw new KnowledgeProcessingError("not_found", "加工记录不属于此知识包");
  return run;
}
export async function readRunContent(db: KnowledgeDb, runId: string) {
  const [items, decisions] = await Promise.all([
    db.select().from(knowledgeItems).where(eq(knowledgeItems.runId, runId)).orderBy(asc(knowledgeItems.id)),
    db.select().from(knowledgeDecisions).where(eq(knowledgeDecisions.runId, runId)).orderBy(asc(knowledgeDecisions.revision)),
  ]);
  return { items: items.map(asItem), decisions: decisions.map(row => row.value) };
}
export async function readLatestAiReview(db: KnowledgeDb, runId: string) {
  const [row] = await db.select().from(knowledgeAiReviews).where(eq(knowledgeAiReviews.runId, runId))
    .orderBy(desc(knowledgeAiReviews.createdAt)).limit(1);
  return row ? asAiReview(row) : undefined;
}
export async function lockPack(tx: KnowledgeTransaction, id: string, revision?: number) {
  const [row] = await tx.select().from(knowledgePacks).where(eq(knowledgePacks.id, id)).for("update");
  const pack = asPack(requireValue(row));
  if (revision !== undefined) assertRevision(pack.revision, revision);
  return pack;
}
export async function lockRun(tx: KnowledgeTransaction, packId: string, id: string, revision?: number) {
  const [row] = await tx.select().from(knowledgeRuns).where(eq(knowledgeRuns.id, id)).for("update");
  const run = asRun(requireValue(row));
  if (run.packId !== packId) throw new KnowledgeProcessingError("not_found", "加工记录不属于此知识包");
  if (revision !== undefined) assertRevision(run.reviewRevision, revision);
  return run;
}
export async function enqueue(tx: KnowledgeTransaction, command: KnowledgeCommand) {
  // WHY：Graphile 的 SQL API 与领域记录共用提交点，避免生成了加工记录却丢失执行任务。
  await tx.execute(sql`select graphile_worker.add_job('execute_knowledge_processing',
    ${JSON.stringify(command)}::json, queue_name := 'knowledge_processing', max_attempts := 1::smallint,
    job_key := ${command.kind === "extract" ? `extract:${command.runId}:${command.generation}`
      : command.kind === "build" ? `build:${command.versionId}` : `ai-review:${command.reviewId}`})`);
}
export async function storeBytes(cachePath: string, bytes: Uint8Array) {
  const hash = sha256(bytes);
  const stored = await cacache.put(cachePath, hash, bytes, { algorithms: ["sha256"], size: bytes.byteLength });
  if (stored.toString() !== integrity(hash)) throw new KnowledgeProcessingError("invalid_input", "成品存储摘要校验失败");
  return hash;
}
export function loadBytes(cachePath: string, hash: string) {
  return cacache.get.byDigest(cachePath, integrity(hash));
}
function integrity(hash: string) { return `sha256-${Buffer.from(hash, "hex").toString("base64")}`; }
export async function readPackVersions(db: KnowledgeDb, packId: string) {
  return (await db.select().from(knowledgeVersions).where(eq(knowledgeVersions.packId, packId))
    .orderBy(desc(knowledgeVersions.number))).map(asVersion);
}
