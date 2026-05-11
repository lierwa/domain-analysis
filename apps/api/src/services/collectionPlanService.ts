import {
  computeNextRunAt,
  createAnalysisProjectRepository,
  createAnalysisRunRepository,
  createCollectionPlanRepository,
  type AppDb
} from "@domain-analysis/db";
import type { CollectionCadence, Platform } from "@domain-analysis/shared";

export function createCollectionPlanService(db: AppDb) {
  const projectRepo = createAnalysisProjectRepository(db);
  const runRepo = createAnalysisRunRepository(db);
  const planRepo = createCollectionPlanRepository(db);

  return {
    async createPlan(input: {
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
    }) {
      const project = await projectRepo.getById(input.projectId);
      if (!project) throw Object.assign(new Error("project_not_found"), { statusCode: 404 });
      return planRepo.create(input);
    },

    async listByProject(projectId: string) {
      return planRepo.listByProject(projectId);
    },

    async listDuePlans(nowIso: string, limit: number) {
      return planRepo.listDue(nowIso, limit);
    },

    async pausePlan(id: string) {
      return planRepo.update(id, { status: "paused" });
    },

    async resumePlan(id: string) {
      const nextRunAt = computeNextRunAt(new Date(), "daily");
      return planRepo.update(id, { status: "active", nextRunAt });
    },

    async createScheduledRun(planId: string) {
      const plan = await planRepo.getById(planId);
      if (!plan) throw Object.assign(new Error("collection_plan_not_found"), { statusCode: 404 });
      if (plan.status !== "active") {
        throw Object.assign(new Error("collection_plan_not_active"), { statusCode: 400 });
      }

      // WHY: 每次调度生成一个小批次 run，避免长期任务没有清晰的内容和报告上下文。
      const run = await runRepo.create({
        projectId: plan.projectId,
        name: `${plan.name} - ${new Date().toISOString().slice(0, 10)}`,
        goal: `Scheduled collection for ${plan.name}`,
        platform: plan.platform,
        includeKeywords: plan.includeKeywords,
        excludeKeywords: plan.excludeKeywords,
        language: plan.language,
        market: plan.market,
        limit: plan.batchLimit,
        collectionPlanId: plan.id,
        runTrigger: "scheduled"
      });

      await planRepo.update(plan.id, {
        lastRunAt: new Date().toISOString(),
        nextRunAt: computeNextRunAt(new Date(), plan.cadence)
      });

      return run;
    }
  };
}
