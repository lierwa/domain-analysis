import cors from "@fastify/cors";
import { FastifySSEPlugin } from "fastify-sse-v2";
import Fastify, { type FastifyServerOptions } from "fastify";
import {
  CaptureTaskError,
  CategoryInterviewError,
  SourceDatasetError,
  type DataCollectionWorkbench,
} from "@domain-analysis/workbench";
import { ZodError } from "zod";

import { registerCaptureTaskRoutes } from "./routes/captureTaskRoutes";
import { registerCategoryInterviewRoutes } from "./routes/categoryInterviewRoutes";
import { registerHealthRoutes } from "./routes/health";
import { registerSourceDatasetRoutes } from "./routes/sourceDatasetRoutes";

export interface BuildServerOptions extends FastifyServerOptions {
  workbench?: DataCollectionWorkbench;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode = resolveStatusCode(error);
    reply.status(statusCode).send({
      error: error instanceof CaptureTaskError || error instanceof CategoryInterviewError
        || error instanceof SourceDatasetError
        ? error.code
        : statusCode >= 500 ? "internal_server_error" : "bad_request",
      message: statusCode >= 500 ? "Unexpected API error" : error.message,
    });
  });
  await app.register(cors, { origin: true });
  await registerHealthRoutes(app);
  if (options.workbench) {
    app.addHook("onClose", () => options.workbench!.close());
    await registerCaptureTaskRoutes(app, options.workbench.captureTasks);
    await registerSourceDatasetRoutes(app, options.workbench.sourceDatasets);
    if (options.workbench.categoryInterviews) {
      await app.register(FastifySSEPlugin, { retryDelay: false });
      await registerCategoryInterviewRoutes(app, options.workbench.categoryInterviews);
    }
  }
  return app;
}

function resolveStatusCode(error: Error & { statusCode?: number }) {
  if (error instanceof ZodError) return 400;
  if (error instanceof CaptureTaskError) return error.code === "not_found" ? 404 : 422;
  if (error instanceof CategoryInterviewError) {
    if (error.code === "not_found") return 404;
    if (error.code === "revision_conflict") return 409;
    return 422;
  }
  if (error instanceof SourceDatasetError) return error.code.endsWith("not_found") ? 404 : 422;
  return error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
}
