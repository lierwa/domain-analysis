import type { FastifyInstance } from "fastify";
import { getXLoginStatus, openXLoginBrowser } from "@domain-analysis/worker";

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/api/settings/x-login/status", async () => ({
    item: await getXLoginStatus(process.env)
  }));

  app.post("/api/settings/x-login/open", async (request, reply) => {
    const status = await openXLoginBrowser(process.env);
    return reply.status(202).send({ item: status });
  });
}
