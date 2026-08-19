import type { CaptureTaskModule } from "@domain-analysis/workbench";
import { CaptureTaskError } from "@domain-analysis/workbench";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const paramsSchema = z.object({ taskId: z.string().min(1) }).strict();

export async function registerCaptureTaskRoutes(app: FastifyInstance, tasks: CaptureTaskModule) {
  app.get("/api/capture-tasks", async () => ({ items: await tasks.list() }));
  app.delete("/api/capture-tasks/:taskId", async (request, reply) => {
    const { taskId } = paramsSchema.parse(request.params);
    await tasks.archive(taskId);
    return reply.status(204).send();
  });
  app.get("/api/capture-tasks/:taskId", async (request) => {
    const { taskId } = paramsSchema.parse(request.params);
    const item = await tasks.get(taskId);
    if (!item) throw new CaptureTaskError("not_found", `抓取任务不存在：${taskId}`);
    return { item };
  });
}
