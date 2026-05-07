import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppDb } from "@domain-analysis/db";
import { createAnalysisRunInputSchema } from "@domain-analysis/shared";
import { z } from "zod";
import { createAnalysisRunService } from "../services/analysisRunService";
import { createContentService } from "../services/contentService";

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

const runListQuerySchema = pageQuerySchema.extend({
  projectId: z.string().optional(),
  status: z.string().optional()
});

const contentListQuerySchema = pageQuerySchema.extend({
  search: z.string().optional(),
  author: z.string().optional(),
  publishedFrom: z.string().optional(),
  publishedTo: z.string().optional()
});

const reportListQuerySchema = pageQuerySchema.extend({
  projectId: z.string().optional()
});

const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  goal: z.string().min(1).max(1000),
  language: z.string().min(2).max(12),
  market: z.string().min(2).max(64),
  defaultLimit: z.number().int().min(1).max(500).optional()
});

// WHY: 所有 analysis 路由集中在一个文件，便于统一管理 service 生命周期和错误处理。
export async function registerAnalysisRoutes(app: FastifyInstance, db: AppDb) {
  const runService = createAnalysisRunService(db);
  const contentService = createContentService(db);

  // ─── Analysis Projects ────────────────────────────────────────────────────

  app.get<{ Querystring: unknown }>("/api/analysis-projects", async (request, reply) => {
    const query = parseQuery(pageQuerySchema, request.query, reply);
    if (!query) return reply;
    return runService.listProjects(query.page, query.pageSize);
  });

  app.post("/api/analysis-projects", async (request, reply) => {
    const input = parseBody(createProjectSchema, request.body, reply);
    if (!input) return reply;
    const project = await runService.createProject(input);
    return reply.status(201).send({ item: project });
  });

  app.get<{ Params: { id: string } }>("/api/analysis-projects/:id", async (request, reply) => {
    const project = await runService.getProjectById(request.params.id);
    if (!project) return reply.status(404).send({ error: "project_not_found" });
    return { item: project };
  });

  app.post<{ Params: { id: string } }>(
    "/api/analysis-projects/:id/archive",
    async (request, reply) => {
      const project = await runService.archiveProject(request.params.id);
      if (!project) return reply.status(404).send({ error: "project_not_found" });
      return { item: project };
    }
  );

  // ─── Analysis Runs ────────────────────────────────────────────────────────

  app.get<{ Querystring: unknown }>("/api/analysis-runs", async (request, reply) => {
    const query = parseQuery(runListQuerySchema, request.query, reply);
    if (!query) return reply;
    return runService.listRuns(query.page, query.pageSize, {
      projectId: query.projectId,
      status: query.status
    });
  });

  app.post("/api/analysis-runs", async (request, reply) => {
    const input = parseBody(createAnalysisRunInputSchema, request.body, reply);
    if (!input) return reply;
    const run = await runService.createRun(input);
    return reply.status(201).send({ item: run });
  });

  app.get<{ Params: { id: string } }>("/api/analysis-runs/:id", async (request, reply) => {
    const run = await runService.getRunById(request.params.id);
    if (!run) return reply.status(404).send({ error: "run_not_found" });
    return { item: run };
  });

  app.post<{ Params: { id: string } }>(
    "/api/analysis-runs/:id/start",
    async (request, reply) => {
      const run = await runService.startRun(request.params.id);
      return reply.status(202).send({ item: run });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/analysis-runs/:id/retry",
    async (request, reply) => {
      const run = await runService.retryRun(request.params.id);
      return reply.status(202).send({ item: run });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/analysis-runs/:id/delete",
    async (request, reply) => {
      const run = await runService.deleteRun(request.params.id);
      if (!run) return reply.status(404).send({ error: "run_not_found" });
      return { ok: true };
    }
  );

  // ─── Run Contents ─────────────────────────────────────────────────────────

  app.get<{ Params: { id: string }; Querystring: unknown }>(
    "/api/analysis-runs/:id/contents",
    async (request, reply) => {
      const query = parseQuery(contentListQuerySchema, request.query, reply);
      if (!query) return reply;
      return contentService.listRunContents(request.params.id, query.page, query.pageSize, {
        search: query.search,
        author: query.author,
        publishedFrom: query.publishedFrom,
        publishedTo: query.publishedTo
      });
    }
  );

  // ─── Run Crawl Tasks ──────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    "/api/analysis-runs/:id/crawl-tasks",
    async (request) => {
      return { items: await runService.listRunCrawlTasks(request.params.id) };
    }
  );

  // ─── Run Report ───────────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    "/api/analysis-runs/:id/report",
    async (request, reply) => {
      const report = await runService.generateReport(request.params.id);
      return reply.status(201).send({ item: report });
    }
  );

  // ─── Reports Library ──────────────────────────────────────────────────────

  app.get<{ Querystring: unknown }>("/api/reports", async (request, reply) => {
    const query = parseQuery(reportListQuerySchema, request.query, reply);
    if (!query) return reply;
    return contentService.listReports(query.page, query.pageSize, { projectId: query.projectId });
  });

  app.get<{ Params: { id: string } }>("/api/reports/:id", async (request, reply) => {
    const report = await contentService.getReport(request.params.id);
    if (!report) return reply.status(404).send({ error: "report_not_found" });
    return { item: report };
  });
}

// ─── 解析工具 ─────────────────────────────────────────────────────────────────

function parseBody<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  body: unknown,
  reply: FastifyReply
): z.infer<TSchema> | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    reply.status(400).send({ error: "validation_error", issues: result.error.issues });
    return null;
  }
  return result.data;
}

function parseQuery<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  query: unknown,
  reply: FastifyReply
): z.infer<TSchema> | null {
  const result = schema.safeParse(query);
  if (!result.success) {
    reply.status(400).send({ error: "validation_error", issues: result.error.issues });
    return null;
  }
  return result.data;
}
