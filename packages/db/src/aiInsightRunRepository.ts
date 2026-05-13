import { and, count, desc, eq } from "drizzle-orm";
import type { AppDb } from "./client";
import { aiInsightBatches, aiInsightCandidates, aiInsightRuns } from "./schema";
import type { PageInput, PageMeta } from "./repositories";

type AiInsightRunRow = typeof aiInsightRuns.$inferSelect;
type AiInsightCandidateRow = typeof aiInsightCandidates.$inferSelect;
type AiInsightBatchRow = typeof aiInsightBatches.$inferSelect;

export interface CreateAiInsightRunInput {
  analysisRunId: string;
  status: string;
  modelName: string;
  configSnapshot: Record<string, unknown>;
  startedAt?: string | null;
}

export interface UpdateAiInsightRunInput {
  status?: string;
  totalRawCount?: number;
  eligibleCount?: number;
  selectedCandidateCount?: number;
  excludedCandidateCount?: number;
  batchCount?: number;
  outputInsightCount?: number;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface CreateAiInsightCandidateInput {
  aiInsightRunId: string;
  analysisRunId: string;
  rawContentId: string;
  selected: boolean;
  selectionScore: number;
  selectionReasons: string[];
  excludedReason?: string | null;
  batchIndex?: number | null;
  inputTextPreview: string;
}

export interface CreateAiInsightBatchInput {
  aiInsightRunId: string;
  analysisRunId: string;
  batchIndex: number;
  status: string;
  rawContentIds: string[];
  candidateCount: number;
}

export interface UpdateAiInsightBatchInput {
  status?: string;
  outputInsightCount?: number;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

// WHY: AI insights 需要可观测运行记录；独立仓储让分析结果表继续只承载正式业务洞察。
// TRADE-OFF: v1 保留 run 级 append-only diagnostics，不做跨 run 清理，便于复盘失败批次。
export function createAiInsightRunRepository(db: AppDb) {
  return {
    async createRun(input: CreateAiInsightRunInput) {
      const [row] = await db
        .insert(aiInsightRuns)
        .values({
          id: createId("airun"),
          analysisRunId: input.analysisRunId,
          status: input.status,
          modelName: input.modelName,
          configSnapshot: input.configSnapshot,
          startedAt: input.startedAt ?? null
        })
        .returning();
      return mapRun(requireRow(row, "ai_insight_run_create_failed"));
    },

    async updateRun(id: string, input: UpdateAiInsightRunInput) {
      const [row] = await db
        .update(aiInsightRuns)
        .set({ ...input, updatedAt: new Date().toISOString() })
        .where(eq(aiInsightRuns.id, id))
        .returning();
      return row ? mapRun(row) : null;
    },

    async getLatestRun(analysisRunId: string) {
      const [row] = await db
        .select()
        .from(aiInsightRuns)
        .where(eq(aiInsightRuns.analysisRunId, analysisRunId))
        .orderBy(desc(aiInsightRuns.startedAt), desc(aiInsightRuns.createdAt))
        .limit(1);
      return row ? mapRun(row) : null;
    },

    async createCandidates(inputs: CreateAiInsightCandidateInput[]) {
      const items = [];
      for (const input of inputs) {
        const [row] = await db
          .insert(aiInsightCandidates)
          .values({
            id: createId("aicand"),
            aiInsightRunId: input.aiInsightRunId,
            analysisRunId: input.analysisRunId,
            rawContentId: input.rawContentId,
            selected: input.selected,
            selectionScore: input.selectionScore,
            selectionReasons: input.selectionReasons,
            excludedReason: input.excludedReason ?? null,
            batchIndex: input.batchIndex ?? null,
            inputTextPreview: input.inputTextPreview
          })
          .returning();
        if (row) items.push(mapCandidate(row));
      }
      return items;
    },

    async listCandidatesByLatestRun(analysisRunId: string, input: PageInput, selected?: boolean) {
      const latest = await this.getLatestRun(analysisRunId);
      if (!latest) return { items: [], page: createPageMeta(input, 0) };
      const baseCondition = eq(aiInsightCandidates.aiInsightRunId, latest.id);
      const condition = selected === undefined ? baseCondition : and(baseCondition, eq(aiInsightCandidates.selected, selected));
      const [countRow] = await db.select({ total: count() }).from(aiInsightCandidates).where(condition);
      const rows = await db
        .select()
        .from(aiInsightCandidates)
        .where(condition)
        .orderBy(desc(aiInsightCandidates.selectionScore))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      return { items: rows.map(mapCandidate), page: createPageMeta(input, countRow?.total ?? 0) };
    },

    async createBatch(input: CreateAiInsightBatchInput) {
      const [row] = await db
        .insert(aiInsightBatches)
        .values({
          id: createId("aibatch"),
          aiInsightRunId: input.aiInsightRunId,
          analysisRunId: input.analysisRunId,
          batchIndex: input.batchIndex,
          status: input.status,
          rawContentIds: input.rawContentIds,
          candidateCount: input.candidateCount
        })
        .returning();
      return mapBatch(requireRow(row, "ai_insight_batch_create_failed"));
    },

    async updateBatch(id: string, input: UpdateAiInsightBatchInput) {
      const [row] = await db
        .update(aiInsightBatches)
        .set({ ...input, updatedAt: new Date().toISOString() })
        .where(eq(aiInsightBatches.id, id))
        .returning();
      return row ? mapBatch(row) : null;
    },

    async listBatchesByLatestRun(analysisRunId: string) {
      const latest = await this.getLatestRun(analysisRunId);
      if (!latest) return [];
      const rows = await db
        .select()
        .from(aiInsightBatches)
        .where(eq(aiInsightBatches.aiInsightRunId, latest.id))
        .orderBy(aiInsightBatches.batchIndex);
      return rows.map(mapBatch);
    }
  };
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function requireRow<T>(row: T | undefined, message: string) {
  if (!row) throw new Error(message);
  return row;
}

function createPageMeta(input: PageInput, total: number): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  return {
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages,
    hasNextPage: input.page < totalPages,
    hasPreviousPage: input.page > 1
  };
}

function mapRun(row: AiInsightRunRow) {
  return {
    id: row.id,
    analysisRunId: row.analysisRunId,
    status: row.status,
    totalRawCount: row.totalRawCount,
    eligibleCount: row.eligibleCount,
    selectedCandidateCount: row.selectedCandidateCount,
    excludedCandidateCount: row.excludedCandidateCount,
    batchCount: row.batchCount,
    outputInsightCount: row.outputInsightCount,
    modelName: row.modelName,
    configSnapshot: row.configSnapshot as Record<string, unknown>,
    errorMessage: row.errorMessage ?? undefined,
    startedAt: normalizeDateTime(row.startedAt),
    finishedAt: normalizeDateTime(row.finishedAt),
    createdAt: normalizeDateTime(row.createdAt) ?? row.createdAt,
    updatedAt: normalizeDateTime(row.updatedAt) ?? row.updatedAt
  };
}

function mapCandidate(row: AiInsightCandidateRow) {
  return {
    id: row.id,
    aiInsightRunId: row.aiInsightRunId,
    analysisRunId: row.analysisRunId,
    rawContentId: row.rawContentId,
    selected: row.selected,
    selectionScore: row.selectionScore,
    selectionReasons: row.selectionReasons as string[],
    excludedReason: row.excludedReason ?? undefined,
    batchIndex: row.batchIndex ?? undefined,
    inputTextPreview: row.inputTextPreview,
    createdAt: normalizeDateTime(row.createdAt) ?? row.createdAt
  };
}

function mapBatch(row: AiInsightBatchRow) {
  return {
    id: row.id,
    aiInsightRunId: row.aiInsightRunId,
    analysisRunId: row.analysisRunId,
    batchIndex: row.batchIndex,
    status: row.status,
    rawContentIds: row.rawContentIds as string[],
    candidateCount: row.candidateCount,
    outputInsightCount: row.outputInsightCount,
    errorMessage: row.errorMessage ?? undefined,
    startedAt: normalizeDateTime(row.startedAt),
    finishedAt: normalizeDateTime(row.finishedAt),
    createdAt: normalizeDateTime(row.createdAt) ?? row.createdAt,
    updatedAt: normalizeDateTime(row.updatedAt) ?? row.updatedAt
  };
}

function normalizeDateTime(value: string | null | undefined) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value.replace(" ", "T")}Z`).toISOString();
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}
