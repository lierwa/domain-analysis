import { count, desc, eq } from "drizzle-orm";
import type { AppDb } from "./client";
import type { PageInput, PageMeta } from "./repositories";
import { analyzedContents } from "./schema";

type AnalyzedContentRow = typeof analyzedContents.$inferSelect;

export interface CreateAnalyzedContentInput {
  rawContentId: string;
  analysisRunId: string;
  summary: string;
  contentType: string;
  topics: string[];
  entities: string[];
  intent: string;
  sentiment: string;
  insightScore: number;
  opportunityScore: number;
  contentOpportunity?: string;
  reason: string;
  modelName: string;
  analysisJson?: Record<string, unknown>;
}

// WHY: analyzed_contents 已是 schema 的结构化分析层；单独仓储避免继续撑大 analysisRepositories。
// TRADE-OFF: 当前按 run 全量替换，适合 500 条以内 MVP；增量分析稳定后再做 upsert。
export function createAnalyzedContentRepository(db: AppDb) {
  return {
    async replaceRunInsights(runId: string, inputs: CreateAnalyzedContentInput[]) {
      await db.delete(analyzedContents).where(eq(analyzedContents.analysisRunId, runId));
      const items = [];
      for (const input of inputs) {
        const [row] = await db
          .insert(analyzedContents)
          .values({
            id: createId("insight"),
            rawContentId: input.rawContentId,
            analysisRunId: input.analysisRunId,
            summary: input.summary,
            contentType: input.contentType,
            topics: input.topics,
            entities: input.entities,
            intent: input.intent,
            sentiment: input.sentiment,
            insightScore: input.insightScore,
            opportunityScore: input.opportunityScore,
            contentOpportunity: input.contentOpportunity,
            reason: input.reason,
            modelName: input.modelName,
            analysisJson: input.analysisJson
          })
          .returning();
        if (row) items.push(mapAnalyzedContent(row));
      }
      return items;
    },

    async listByRun(runId: string) {
      const rows = await db
        .select()
        .from(analyzedContents)
        .where(eq(analyzedContents.analysisRunId, runId))
        .orderBy(desc(analyzedContents.opportunityScore));
      return rows.map(mapAnalyzedContent);
    },

    async listByRunPage(runId: string, input: PageInput) {
      const [countRow] = await db
        .select({ total: count() })
        .from(analyzedContents)
        .where(eq(analyzedContents.analysisRunId, runId));
      const rows = await db
        .select()
        .from(analyzedContents)
        .where(eq(analyzedContents.analysisRunId, runId))
        .orderBy(desc(analyzedContents.opportunityScore))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      return { items: rows.map(mapAnalyzedContent), page: createPageMeta(input, countRow?.total ?? 0) };
    }
  };
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
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

function mapAnalyzedContent(row: AnalyzedContentRow) {
  return {
    id: row.id,
    rawContentId: row.rawContentId,
    analysisRunId: row.analysisRunId ?? undefined,
    summary: row.summary,
    contentType: row.contentType,
    topics: row.topics as string[],
    entities: row.entities as string[],
    intent: row.intent,
    sentiment: row.sentiment,
    insightScore: row.insightScore,
    opportunityScore: row.opportunityScore,
    contentOpportunity: row.contentOpportunity ?? undefined,
    reason: row.reason,
    modelName: row.modelName,
    analysisJson: row.analysisJson as Record<string, unknown> | null,
    createdAt: normalizeDateTime(row.createdAt) ?? row.createdAt
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
