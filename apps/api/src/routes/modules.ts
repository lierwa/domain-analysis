import type { FastifyInstance } from "fastify";

const modules = [
  { key: "workspace", label: "Workspace", description: "Create and inspect analysis runs" },
  { key: "library", label: "Library", description: "Run-scoped content samples" },
  { key: "reports", label: "Reports", description: "Generated analysis reports" },
  { key: "settings", label: "Settings", description: "Runtime and provider settings" }
];

export async function registerModuleRoutes(app: FastifyInstance) {
  app.get("/api/modules", async () => ({
    modules
  }));
}
