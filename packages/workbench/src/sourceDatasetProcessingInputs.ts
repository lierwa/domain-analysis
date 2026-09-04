import { createHash } from "node:crypto";
import { sourceAssets, sourceCaptureSubjects, sourceCaptureWorkItems, sourceCollectionBatches, sourceCollectionRuns,
  sourceObjects, sourceSnapshots, type WorkbenchDb } from "@domain-analysis/db";
import { knowledgeBatchRefSchema, knowledgeInputSchema, knowledgeSourceRefSchema,
  type KnowledgeBatchRef, type KnowledgeInput, type KnowledgeSourceRef } from "@domain-analysis/shared";
import canonicalize from "canonicalize";
import { and, desc, eq, sql } from "drizzle-orm";
import type { SourceAssetStore } from "./sourceAssetStore";
import { SourceDatasetError } from "./sourceDatasetError";
import { normalizeSnapshot } from "./sourceDatasetNormalization";

export interface ProcessingInputReader {
  readProcessingBatch(ref: KnowledgeBatchRef): Promise<{ inputs: KnowledgeInput[]; total: number; excluded: number }>;
  readProcessingInput(ref: KnowledgeSourceRef): Promise<{ input: KnowledgeInput; bytes: Uint8Array }>;
}

const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function createProcessingInputReader(db: WorkbenchDb, store: SourceAssetStore): ProcessingInputReader {
  return {
    async readProcessingInput(value) {
      const ref = knowledgeSourceRefSchema.parse(value);
      const row = await loadInput(db, ref.snapshotId, ref.assetId ?? null);
      if (canonicalize(row.input.ref) !== canonicalize(ref)) {
        throw new SourceDatasetError("invalid_state", "选料身份或内容哈希已失效，请重新选料");
      }
      if (row.input.availability !== "ready") throw new SourceDatasetError("invalid_state", row.input.reason!);
      const bytes = row.asset ? await collect(store.open(row.asset.casIntegrity)) : Buffer.from(row.text!, "utf8");
      if (bytes.byteLength !== row.input.bytes || sha(bytes) !== ref.sha256) {
        throw new SourceDatasetError("invalid_state", "原始内容校验失败，请检查本地原件");
      }
      return { input: row.input, bytes };
    },
    async readProcessingBatch(value) {
      const ref = knowledgeBatchRefSchema.parse(value);
      const [batch] = await db.select().from(sourceCollectionBatches).where(eq(sourceCollectionBatches.id, ref.batchId));
      if (!batch || batch.taskId !== ref.taskId) throw new SourceDatasetError("invalid_state", "采集批次不属于所选任务");
      const runRows = await db.select().from(sourceCollectionRuns).where(eq(sourceCollectionRuns.executionBatchId, ref.batchId))
        .orderBy(desc(sourceCollectionRuns.startedAt));
      const latestBySource = new Map<string, typeof runRows[number]>();
      for (const run of runRows) {
        if (!run.sourceCollectionPlanSourceKey || latestBySource.has(run.sourceCollectionPlanSourceKey)) continue;
        latestBySource.set(run.sourceCollectionPlanSourceKey, run);
      }
      const latestRuns = [...latestBySource.values()];
      // WHY：批次状态是历史命令结果；恢复或重试后的最新来源执行才代表当前是否可重复生产。
      if (batch.status !== "completed" || latestRuns.length !== batch.plannedSourceCount
        || latestRuns.some(run => run.status !== "completed")) {
        throw new SourceDatasetError("invalid_state", "只有全部来源最新执行均完成的采集批次可以进入加工");
      }
      const runIds = latestRuns.map(run => run.id);
      const result = await db.execute<{ sid: string; aid: string | null }>(sql`select distinct s.id sid,k.aid
        from ${sourceSnapshots} s join ${sourceCollectionRuns} r on r.id=s.run_id
        left join ${sourceAssets} a on a.snapshot_id=s.id
        cross join lateral (select null::text aid where s.content_json->>'kind'='inline_text'
          union all select a.id where a.id is not null) k
        where r.id in (${sql.join(runIds.map(id => sql`${id}`), sql`,`)}) order by sid,aid nulls first`);
      const loaded: KnowledgeInput[] = [];
      // WHY：批次可能包含数千份原件；小批并发避免为逐行身份校验耗尽数据库连接。
      for (let offset = 0; offset < result.rows.length; offset += 24) {
        const group = result.rows.slice(offset, offset + 24);
        loaded.push(...(await Promise.all(group.map(row => loadInput(db, row.sid, row.aid)))).map(row => row.input));
      }
      const inputs = loaded.filter(input => input.availability === "ready").sort((a, b) => a.key.localeCompare(b.key));
      if (!inputs.length) throw new SourceDatasetError("invalid_state", "该采集批次没有可加工的已准入原件");
      return { inputs, total: loaded.length, excluded: loaded.length - inputs.length };
    },
  };
}

async function loadInput(db: WorkbenchDb, snapshotId: string, assetId: string | null) {
  const [row] = await db.select({ snapshot: sourceSnapshots, run: sourceCollectionRuns,
    object: sourceObjects, subject: sourceCaptureSubjects }).from(sourceSnapshots)
    .innerJoin(sourceCollectionRuns, eq(sourceCollectionRuns.id, sourceSnapshots.runId))
    .innerJoin(sourceObjects, eq(sourceObjects.id, sourceSnapshots.objectId))
    .leftJoin(sourceCaptureWorkItems, eq(sourceCaptureWorkItems.id, sourceSnapshots.captureWorkItemId))
    .leftJoin(sourceCaptureSubjects, eq(sourceCaptureSubjects.id, sourceCaptureWorkItems.subjectId))
    .where(eq(sourceSnapshots.id, snapshotId));
  if (!row) throw new SourceDatasetError("snapshot_not_found", "选料快照不存在");
  const snapshot = normalizeSnapshot(row.snapshot);
  const [asset] = assetId ? await db.select().from(sourceAssets).where(and(
    eq(sourceAssets.id, assetId), eq(sourceAssets.snapshotId, snapshotId))) : [];
  if (assetId && !asset) throw new SourceDatasetError("asset_not_found", "附件不属于选定快照");
  const payload = snapshot.payload;
  const text = !asset && payload?.kind === "inline_text" ? payload.text : undefined;
  const mediaType = (asset?.mediaType ?? (payload && "mediaType" in payload ? payload.mediaType : "")).split(";")[0]!.toLowerCase();
  const format = mediaType === "text/html" ? "html" : mediaType === "application/pdf" ? "pdf"
    : ["image/jpeg", "image/png", "image/webp"].includes(mediaType) ? "image"
      : mediaType === "text/plain" ? "text" : "unsupported";
  const bytes = asset?.bytes ?? (text === undefined ? 0 : Buffer.byteLength(text));
  const hash = asset?.contentHash ?? (payload && "contentHash" in payload ? payload.contentHash : sha(""));
  const url = asset?.sourceUrl ?? snapshot.observation.finalUrl ?? snapshot.observation.requestedUrl;
  const parsedUrl = new URL(url);
  const publicUrl = ["http:", "https:"].includes(parsedUrl.protocol) && !parsedUrl.username && !parsedUrl.password
    && ![...parsedUrl.searchParams.keys()].some(key => /token|auth|cookie|session|signature/i.test(key));
  const reason = row.run.status === "running" ? "来源执行结束后可选料"
    : !snapshot.lineage || !snapshot.captureWorkItemId ? "来源谱系尚未完整"
      : snapshot.observation.state !== "accessible" || snapshot.observation.contentAssessment?.status !== "accepted"
        ? "来源内容尚未通过原始采集准入"
        : !publicUrl ? "来源地址需要检查公开访问边界"
          : !bytes || bytes > 20 * 1024 * 1024 ? "单份原料须为 1 字节至 20 MiB"
            : format === "unsupported" ? "当前产线尚未支持此格式" : undefined;
  const ref = { taskId: row.run.taskId, runId: row.run.id, snapshotId, assetId: asset?.id, sha256: hash };
  const input = knowledgeInputSchema.parse({ ref, key: sha(canonicalize(ref)!),
    providerKey: row.run.providerKey, subjectKey: row.subject?.sourceEntityId ?? row.object.externalKey,
    subjectName: row.subject?.displayName ?? row.object.externalKey,
    label: asset?.filename ?? `${row.subject?.displayName ?? row.object.externalKey} · ${format}`,
    url, format, mediaType, bytes, capturedAt: snapshot.createdAt,
    availability: reason ? "blocked" : "ready", reason });
  return { input, asset, text };
}

async function collect(stream: AsyncIterable<Uint8Array>) {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of stream) {
    size += part.byteLength;
    if (size > 20 * 1024 * 1024) throw new SourceDatasetError("invalid_state", "原件超过单份加工预算");
    parts.push(part);
  }
  return Buffer.concat(parts);
}
