import cors from "@fastify/cors";
import { FastifySSEPlugin } from "fastify-sse-v2";
import Fastify, { type FastifyServerOptions } from "fastify";
import {
  CaptureTaskError,
  CategoryInterviewError,
  CrawlPlanError,
  CrawlPlanningError,
  SourceExecutionError,
  SourceDatasetError,
  KnowledgeProcessingError,
  type DataCollectionWorkbench,
} from "@domain-analysis/workbench";
import { ZodError } from "zod";

import { registerCaptureTaskRoutes } from "./routes/captureTaskRoutes";
import { registerCategoryInterviewRoutes } from "./routes/categoryInterviewRoutes";
import { registerCrawlPlanningRoutes } from "./routes/crawlPlanningRoutes";
import { registerHealthRoutes } from "./routes/health";
import { registerSourceDatasetRoutes } from "./routes/sourceDatasetRoutes";
import { registerSourceExecutionRoutes } from "./routes/sourceExecutionRoutes";
import type { SourceExecutionQueue } from "./sourceExecutionQueue";
import { registerKnowledgeProcessingRoutes } from "./routes/knowledgeProcessingRoutes";

export interface BuildServerOptions extends FastifyServerOptions {
  workbench?: DataCollectionWorkbench;
  sourceExecutionQueue?: SourceExecutionQueue;
  knowledgeProcessingQueue?: { close(): Promise<void> };
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode = resolveStatusCode(error);
    reply.status(statusCode).send({
      error: error instanceof CaptureTaskError || error instanceof CategoryInterviewError
        || error instanceof CrawlPlanError || error instanceof CrawlPlanningError || error instanceof SourceExecutionError
        || error instanceof SourceDatasetError || error instanceof KnowledgeProcessingError
        ? error.code
        : statusCode >= 500 ? "internal_server_error" : "bad_request",
      message: statusCode >= 500 ? "Unexpected API error" : error.message,
    });
  });
  await app.register(cors, { origin: true });
  await registerHealthRoutes(app);
  if (options.workbench) {
    app.addHook("onClose", async () => {
      await options.sourceExecutionQueue?.close();
      await options.knowledgeProcessingQueue?.close();
      await options.workbench!.close();
    });
    await registerCaptureTaskRoutes(app, options.workbench.captureTasks);
    await registerSourceDatasetRoutes(app, options.workbench.sourceDatasets);
    if (options.workbench.knowledgeProcessing) {
      await registerKnowledgeProcessingRoutes(app, options.workbench.knowledgeProcessing);
    }
    if (options.workbench.sourceExecution && options.sourceExecutionQueue) {
      await registerSourceExecutionRoutes(app, options.workbench.sourceExecution, options.sourceExecutionQueue);
    }
    if (options.workbench.categoryInterviews) {
      await app.register(FastifySSEPlugin, { retryDelay: false });
    }
    if (options.workbench.categoryInterviews) {
      await registerCategoryInterviewRoutes(app, options.workbench.categoryInterviews);
    }
    if (options.workbench.crawlPlanning) {
      await registerCrawlPlanningRoutes(app, options.workbench.crawlPlanning);
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
  if (error instanceof CrawlPlanError || error instanceof CrawlPlanningError || error instanceof SourceExecutionError) {
    if (error.code === "not_found") return 404;
    if (error.code === "revision_conflict") return 409;
    return 422;
  }
  if (error instanceof SourceDatasetError) return error.code.endsWith("not_found") ? 404 : 422;
  if (error instanceof KnowledgeProcessingError) {
    return error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 422;
  }
  return error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
}
