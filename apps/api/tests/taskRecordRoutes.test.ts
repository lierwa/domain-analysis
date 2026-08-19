import Fastify from "fastify";
import type { CaptureTaskModule, CategoryInterviewModule } from "@domain-analysis/workbench";
import { describe, expect, it, vi } from "vitest";

import { registerCaptureTaskRoutes } from "../src/routes/captureTaskRoutes";
import { registerCategoryInterviewRoutes } from "../src/routes/categoryInterviewRoutes";

describe("任务记录删除路由", () => {
  it("删除正式任务时调用领域归档并返回空响应", async () => {
    const archive = vi.fn().mockResolvedValue(undefined);
    const tasks = {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      archive,
    } as CaptureTaskModule & { archive(taskId: string): Promise<void> };
    const app = Fastify({ logger: false });
    await registerCaptureTaskRoutes(app, tasks);

    const response = await app.inject({ method: "DELETE", url: "/api/capture-tasks/task-1" });

    expect(response.statusCode).toBe(204);
    expect(archive).toHaveBeenCalledWith("task-1");
    await app.close();
  });

  it("删除未完成采访时调用领域删除并返回空响应", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const interviews = {
      list: vi.fn().mockResolvedValue([]),
      remove,
    } as unknown as CategoryInterviewModule & { remove(sessionId: string): Promise<void> };
    const app = Fastify({ logger: false });
    await registerCategoryInterviewRoutes(app, interviews);

    const response = await app.inject({ method: "DELETE", url: "/api/category-interviews/session-1" });

    expect(response.statusCode).toBe(204);
    expect(remove).toHaveBeenCalledWith("session-1");
    await app.close();
  });
});
