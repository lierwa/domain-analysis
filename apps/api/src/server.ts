import cors from "@fastify/cors";
import Fastify, { type FastifyServerOptions } from "fastify";
import { createDb, type AppDb } from "@domain-analysis/db";
import { registerHealthRoutes } from "./routes/health";
import { registerModuleRoutes } from "./routes/modules";
import { registerAnalysisRoutes } from "./routes/analysisRoutes";

// WHY: 业务流程由 analysisRoutes + analysisRunService 统一编排，避免再暴露工程对象 API。

export interface BuildServerOptions extends FastifyServerOptions {
  db?: AppDb;
}

// WHY: 开发环境用 pino-pretty 输出人类可读日志；生产环境用结构化 JSON 便于日志采集工具处理。
function buildLoggerConfig(options: BuildServerOptions) {
  if (options.logger !== undefined) return options.logger;
  const isDev = process.env.NODE_ENV !== "production";
  if (!isDev) return true;
  return {
    level: "warn", // WHY: 开发时只显示 warn/error，过滤掉每次请求的 info 日志噪音。
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" }
    }
  };
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: buildLoggerConfig(options) });
  const db = options.db ?? createDb();

  await app.register(cors, { origin: true });

  await registerHealthRoutes(app);
  await registerModuleRoutes(app, db);
  await registerAnalysisRoutes(app, db);

  // WHY: 统一错误出口，返回 requestId 方便前端展示/日志追踪；生产 500 不暴露堆栈。
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) {
      app.log.error({ requestId: request.id, err: error.message }, "internal error");
    }
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "internal_server_error" : "bad_request",
      message: statusCode >= 500 ? "Unexpected server error. Please try again." : error.message,
      requestId: request.id
    });
  });

  return app;
}
