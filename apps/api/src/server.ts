import cors from "@fastify/cors";
import Fastify, { type FastifyServerOptions } from "fastify";
import { createDb, type AppDb } from "@domain-analysis/db";
import { registerHealthRoutes } from "./routes/health";
import { registerModuleRoutes } from "./routes/modules";
import { registerCrawlRoutes } from "./routes/crawlRoutes";
import { registerTopicQuerySourceRoutes } from "./routes/topicQuerySourceRoutes";

export interface BuildServerOptions extends FastifyServerOptions {
  db?: AppDb;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? true
  });
  const db = options.db ?? createDb();

  await app.register(cors, {
    origin: true
  });

  await registerHealthRoutes(app);
  await registerModuleRoutes(app);
  await registerTopicQuerySourceRoutes(app, db);
  await registerCrawlRoutes(app, db);

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "internal_server_error" : "bad_request",
      message: statusCode >= 500 ? "Unexpected API error" : error.message
    });
  });

  return app;
}
