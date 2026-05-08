import type { FastifyInstance } from "fastify";
import { createSourceRepository, type AppDb } from "@domain-analysis/db";
import { registerCollectionPlanRoutes } from "./collectionPlanRoutes";

const modules = [
  { key: "workspace", label: "Workspace", description: "Create and inspect analysis runs" },
  { key: "library", label: "Library", description: "Run-scoped content samples" },
  { key: "reports", label: "Reports", description: "Generated analysis reports" },
  { key: "settings", label: "Settings", description: "Runtime and provider settings" }
];

export async function registerModuleRoutes(app: FastifyInstance, db: AppDb) {
  const sourceRepo = createSourceRepository(db);

  app.get("/api/modules", async () => ({
    modules
  }));

  app.get("/api/sources", async () => {
    await sourceRepo.seedDefaults();
    return { items: await sourceRepo.list() };
  });

  await registerCollectionPlanRoutes(app, db);
}
