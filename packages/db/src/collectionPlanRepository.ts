import { and, asc, eq, lte } from "drizzle-orm";
import type { CollectionCadence, CollectionPlanStatus, Platform } from "@domain-analysis/shared";
import type { AppDb } from "./client";
import { collectionPlans } from "./schema";

export interface CreateCollectionPlanInput {
  projectId: string;
  name: string;
  platform: Platform;
  includeKeywords: string[];
  excludeKeywords: string[];
  language: string;
  market: string;
  cadence: CollectionCadence;
  batchLimit: number;
  maxRunsPerDay: number;
}

export interface UpdateCollectionPlanInput {
  status?: CollectionPlanStatus;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

export function createCollectionPlanRepository(db: AppDb) {
  return {
    async create(input: CreateCollectionPlanInput) {
      const now = new Date();
      const [row] = await db
        .insert(collectionPlans)
        .values({
          id: createId("plan"),
          projectId: input.projectId,
          name: input.name,
          status: "active",
          platform: input.platform,
          includeKeywords: input.includeKeywords,
          excludeKeywords: input.excludeKeywords,
          language: input.language,
          market: input.market,
          cadence: input.cadence,
          batchLimit: input.batchLimit,
          maxRunsPerDay: input.maxRunsPerDay,
          nextRunAt: computeNextRunAt(now, input.cadence)
        })
        .returning();
      return mapPlan(requireRow(row, "collection_plan_create_failed"));
    },

    async getById(id: string) {
      const [row] = await db.select().from(collectionPlans).where(eq(collectionPlans.id, id));
      return row ? mapPlan(row) : null;
    },

    async listByProject(projectId: string) {
      const rows = await db
        .select()
        .from(collectionPlans)
        .where(eq(collectionPlans.projectId, projectId))
        .orderBy(asc(collectionPlans.createdAt));
      return rows.map(mapPlan);
    },

    async listDue(nowIso: string, limit: number) {
      const rows = await db
        .select()
        .from(collectionPlans)
        .where(and(eq(collectionPlans.status, "active"), lte(collectionPlans.nextRunAt, nowIso)))
        .orderBy(asc(collectionPlans.nextRunAt))
        .limit(limit);
      return rows.map(mapPlan);
    },

    async update(id: string, input: UpdateCollectionPlanInput) {
      const [row] = await db
        .update(collectionPlans)
        .set({ ...input, updatedAt: new Date().toISOString() })
        .where(eq(collectionPlans.id, id))
        .returning();
      return row ? mapPlan(row) : null;
    }
  };
}

export function computeNextRunAt(from: Date, cadence: CollectionCadence): string | null {
  if (cadence === "manual") return null;
  const next = new Date(from);
  if (cadence === "hourly") next.setHours(next.getHours() + 1);
  if (cadence === "daily") next.setDate(next.getDate() + 1);
  if (cadence === "weekly") next.setDate(next.getDate() + 7);
  return next.toISOString();
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function requireRow<TRow>(row: TRow | undefined, message: string): TRow {
  if (!row) throw new Error(message);
  return row;
}

function mapPlan(row: typeof collectionPlans.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status as CollectionPlanStatus,
    platform: row.platform as Platform,
    includeKeywords: row.includeKeywords as string[],
    excludeKeywords: row.excludeKeywords as string[],
    language: row.language,
    market: row.market,
    cadence: row.cadence as CollectionCadence,
    batchLimit: row.batchLimit,
    maxRunsPerDay: row.maxRunsPerDay,
    lastRunAt: row.lastRunAt ?? undefined,
    nextRunAt: row.nextRunAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
