import type { FastifyInstance } from "fastify";

const stageOneModules = [
  { key: "topics", label: "Topics", description: "Topic project management" },
  { key: "queries", label: "Queries", description: "Keyword and source query setup" },
  { key: "sources", label: "Sources", description: "Crawler source configuration" },
  { key: "tasks", label: "Tasks", description: "Crawl task status and operations" },
  { key: "contents", label: "Content Library", description: "Raw and analyzed content" },
  { key: "analytics", label: "Analytics", description: "Trend and insight snapshots" },
  { key: "reports", label: "Reports", description: "Markdown and web reports" },
  { key: "settings", label: "Settings", description: "Runtime and AI provider settings" }
];

export async function registerModuleRoutes(app: FastifyInstance) {
  app.get("/api/modules", async () => ({
    modules: stageOneModules
  }));
}
