import {
  computeNextRunAt,
  createAnalysisProjectRepository,
  createCollectionPlanRepository,
  type AppDb
} from "@domain-analysis/db";
import type { CollectionCadence } from "@domain-analysis/shared";

export function createCollectionPlanService(db: AppDb) {
  const projectRepo = createAnalysisProjectRepository(db);
  const planRepo = createCollectionPlanRepository(db);

  return {
    async createPlan(input: {
      projectId: string;
      name: string;
      platform: "reddit";
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

    async pausePlan(id: string) {
      return planRepo.update(id, { status: "paused" });
    },

    async resumePlan(id: string) {
      const nextRunAt = computeNextRunAt(new Date(), "daily");
      return planRepo.update(id, { status: "active", nextRunAt });
    }
  };
}
