import cors from "@fastify/cors";
import Fastify, { type FastifyServerOptions } from "fastify";
import { createDb, type AppDb } from "@domain-analysis/db";
import { registerHealthRoutes } from "./routes/health";
import { registerModuleRoutes } from "./routes/modules";
import { registerAnalysisRoutes } from "./routes/analysisRoutes";
import { registerSettingsRoutes } from "./routes/settingsRoutes";
import { registerRequestLogging } from "./requestLogging";
import type { AiInsightAnalyzer } from "./services/analysisInsightService";

// WHY: 业务流程由 analysisRoutes + analysisRunService 统一编排，避免再暴露工程对象 API。

export interface BuildServerOptions extends FastifyServerOptions {
  db?: AppDb;
  aiInsightAnalyzer?: AiInsightAnalyzer;
  requestLogSummaryIntervalMs?: number;
  requestLogSummaryMinCount?: number;
  requestLogSlowThresholdMs?: number;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const {
    db: providedDb,
    aiInsightAnalyzer,
    requestLogSummaryIntervalMs,
    requestLogSummaryMinCount,
    requestLogSlowThresholdMs,
    ...fastifyOptions
  } = options;
  const app = Fastify({
    ...fastifyOptions,
    logger: fastifyOptions.logger ?? true,
    disableRequestLogging: fastifyOptions.disableRequestLogging ?? true
  });
  const db = providedDb ?? createDb();

  // WHY: Fastify 默认访问日志会被高频 GET 刷屏；保留 app.log，并用聚合摘要承载请求观测。
  registerRequestLogging(app, {
    summaryIntervalMs: requestLogSummaryIntervalMs,
    summaryMinCount: requestLogSummaryMinCount,
    slowThresholdMs: requestLogSlowThresholdMs
  });

  await app.register(cors, {
    origin: true
  });

  await registerHealthRoutes(app);
  await registerModuleRoutes(app, db);
  await registerAnalysisRoutes(app, db, { aiInsightAnalyzer, logger: app.log });
  await registerSettingsRoutes(app);

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "internal_server_error" : "bad_request",
      message: statusCode === 502 ? error.message : statusCode >= 500 ? "Unexpected API error" : error.message
    });
  });

  return app;
}
