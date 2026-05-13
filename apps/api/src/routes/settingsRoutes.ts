import type { FastifyInstance } from "fastify";
import { getXLoginStatus, openXLoginBrowser, XChromeDevToolsUnavailableError } from "@domain-analysis/worker";
import { getAiProviderStatus } from "../services/aiProviderConfig";

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/api/settings/ai/status", async () => ({
    item: getAiProviderStatus(process.env)
  }));

  app.get("/api/settings/x-login/status", async () => ({
    item: await getXLoginStatus(process.env)
  }));

  app.post("/api/settings/x-login/open", async (request, reply) => {
    try {
      const status = await openXLoginBrowser(process.env);
      return reply.status(202).send({ item: status });
    } catch (error) {
      // WHY: 旧登录窗口占用 profile 时需要用户关闭窗口，不能被全局 500 掩盖成未知错误。
      if (error instanceof XChromeDevToolsUnavailableError) {
        throw Object.assign(error, { statusCode: 409 });
      }
      throw error;
    }
  });
}
