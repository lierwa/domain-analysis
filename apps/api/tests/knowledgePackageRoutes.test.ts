import type { KnowledgePackageModule } from "@domain-analysis/workbench";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerKnowledgePackageRoutes } from "../src/routes/knowledgePackageRoutes";

describe("Knowledge Package HTTP contract", () => {
  it("构建、列出、激活和回滚内容寻址知识包", async () => {
    const descriptor = {
      schemaVersion: "knowledge-package-v1",
      packageId: "knowledge-package-1",
      versionHash: "a".repeat(64),
      projectId: "project-1",
      categoryDefinitionVersionId: "definition-1",
      createdAt: "2026-08-17T12:00:00.000Z",
      stateCount: 2,
      evidenceCount: 1,
      filePath: "/tmp/packages/a.sqlite",
      databaseSha256: "b".repeat(64),
      bytes: 4096,
    } as const;
    const packages = {
      build: vi.fn(async () => descriptor),
      list: vi.fn(async () => [descriptor]),
      active: vi.fn(async () => descriptor),
      activate: vi.fn(async () => descriptor),
      rollback: vi.fn(async () => descriptor),
    } as unknown as KnowledgePackageModule & Record<"build" | "list" | "active" | "activate" | "rollback", ReturnType<typeof vi.fn>>;
    const app = Fastify();
    await registerKnowledgePackageRoutes(app, packages);

    const built = await app.inject({ method: "POST", url: "/api/product-projects/project-1/knowledge-packages" });
    expect(built.statusCode).toBe(201);
    const listed = await app.inject({ method: "GET", url: "/api/product-projects/project-1/knowledge-packages" });
    expect(listed.json()).toMatchObject({ items: [{ packageId: descriptor.packageId }], active: { versionHash: descriptor.versionHash } });
    await app.inject({ method: "POST", url: `/api/product-projects/project-1/knowledge-packages/${descriptor.versionHash}/activate` });
    await app.inject({ method: "POST", url: "/api/product-projects/project-1/knowledge-packages/rollback" });
    expect(packages.activate).toHaveBeenCalledWith("project-1", descriptor.versionHash);
    expect(packages.rollback).toHaveBeenCalledWith("project-1");
    await app.close();
  });
});
