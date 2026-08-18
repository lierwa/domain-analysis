import cors from "@fastify/cors";
import { FastifySSEPlugin } from "fastify-sse-v2";
import Fastify, { type FastifyServerOptions } from "fastify";
import { closeDb, createDb, type AppDb } from "@domain-analysis/db";
import {
  type ProductPipelineModule,
  CategoryInterviewError,
  EvidenceError,
  KnowledgeFactoryError,
  KnowledgeReviewError,
  KnowledgePackageError,
  MarketUniverseError,
  MarketUniverseRegulatoryPipelineError,
  type MarketUniverseRegulatoryPipelineModule,
  ProductProjectError,
  SourceCollectionPlannerError,
  type SourceCollectionPlannerModule,
  SourceDatasetError,
  SourceDatasetExportError,
  type ProductKnowledgeWorkbench,
} from "@domain-analysis/workbench";
import {
  SourceAccessError,
  type CnisRegistryTableSource,
  type DocumentExcerptSource,
  type EnergyLabelRecordSource,
  type OfficialCatalogSource,
  type PublicWebTextSource,
} from "@domain-analysis/worker";
import { ZodError } from "zod";
import { registerHealthRoutes } from "./routes/health";
import { registerModuleRoutes } from "./routes/modules";
import { registerAnalysisRoutes } from "./routes/analysisRoutes";
import { registerProductProjectRoutes } from "./routes/productProjectRoutes";
import { registerCategoryInterviewRoutes } from "./routes/categoryInterviewRoutes";
import { registerEvidenceRoutes } from "./routes/evidenceRoutes";
import { registerMarketUniverseRoutes } from "./routes/marketUniverseRoutes";
import { registerSourceDatasetRoutes } from "./routes/sourceDatasetRoutes";
import { registerKnowledgeRoutes } from "./routes/knowledgeRoutes";
import { registerKnowledgePackageRoutes } from "./routes/knowledgePackageRoutes";

// WHY: 业务流程由 analysisRoutes + analysisRunService 统一编排，避免再暴露工程对象 API。

export interface BuildServerOptions extends FastifyServerOptions {
  db?: AppDb;
  workbench?: ProductKnowledgeWorkbench;
  productPipeline?: ProductPipelineModule;
  sourceCollectionPlanner?: SourceCollectionPlannerModule;
  localUserId?: string;
  publicWebTextSource?: PublicWebTextSource;
  energyLabelRecordSource?: EnergyLabelRecordSource;
  documentExcerptSource?: DocumentExcerptSource;
  cnisRegistryTableSource?: CnisRegistryTableSource;
  haierOfficialCatalog?: OfficialCatalogSource;
  leaderOfficialCatalog?: OfficialCatalogSource;
  mideaOfficialCatalog?: OfficialCatalogSource;
  tclOfficialCatalog?: OfficialCatalogSource;
  hisenseGroupOfficialCatalog?: OfficialCatalogSource;
  meilingOfficialCatalog?: OfficialCatalogSource;
  konkaFrestecOfficialCatalog?: OfficialCatalogSource;
  siemensOfficialCatalog?: OfficialCatalogSource;
  royalstarOfficialChannel?: OfficialCatalogSource;
  jdOfficialRetailCatalog?: OfficialCatalogSource;
  marketUniverseRegulatoryPipeline?: MarketUniverseRegulatoryPipelineModule;
  closeProductKnowledgePipelines?: () => Promise<void>;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? true
  });
  const db = options.db ?? createDb();
  app.addHook("onClose", async () => {
    // WHY：Fastify 拥有注册到路由的 legacy SQLite 连接；先关闭连接才能在 Windows 安全发布或清理文件。
    closeDb(db);
  });

  // WHY：Fastify error handler 受注册顺序和封装作用域影响，必须先于业务路由设置。
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode = resolveStatusCode(error);
    reply.status(statusCode).send({
      error: error instanceof ProductProjectError
        || error instanceof CategoryInterviewError
        || error instanceof EvidenceError
        || error instanceof KnowledgeFactoryError
        || error instanceof KnowledgeReviewError
        || error instanceof KnowledgePackageError
        || error instanceof MarketUniverseError
        || error instanceof MarketUniverseRegulatoryPipelineError
        || error instanceof SourceDatasetError
        || error instanceof SourceDatasetExportError
        || error instanceof SourceCollectionPlannerError
        || error instanceof SourceAccessError
        ? error.code
        : statusCode >= 500 ? "internal_server_error" : "bad_request",
      message: statusCode >= 500 ? "Unexpected API error" : error.message
    });
  });

  if (options.workbench) {
    app.addHook("onClose", async () => {
      // WHY：先停执行器，再断开业务事实库，避免关闭期间的在途 workflow 写向已关闭连接池。
      await options.closeProductKnowledgePipelines?.();
      await options.workbench!.close();
    });
    if (options.workbench.categoryInterviews) {
      await app.register(FastifySSEPlugin, { retryDelay: false });
      await registerCategoryInterviewRoutes(app, options.workbench.categoryInterviews);
    }
    await registerProductProjectRoutes(
      app,
      options.workbench.productProjects,
      {
        pipeline: options.productPipeline
          ? { module: options.productPipeline, requestedBy: options.localUserId ?? "local-user" }
          : undefined,
        sourceCollectionPlanner: options.sourceCollectionPlanner,
      },
    );
    await registerSourceDatasetRoutes(
      app,
      options.workbench.sourceDatasets,
      options.workbench.sourceEvidence,
    );
    await registerKnowledgeRoutes(
      app,
      options.workbench.knowledgeFactory,
      options.workbench.knowledgeReview,
    );
    await registerKnowledgePackageRoutes(app, options.workbench.knowledgePackages);
    if (options.publicWebTextSource) {
      await registerEvidenceRoutes(app, {
        projects: options.workbench.productProjects,
        evidence: options.workbench.evidence,
        source: options.publicWebTextSource,
        regulatorySource: options.energyLabelRecordSource,
        documentSource: options.documentExcerptSource,
        registryTableSource: options.cnisRegistryTableSource,
      });
    }
    if (options.haierOfficialCatalog && options.leaderOfficialCatalog
      && options.mideaOfficialCatalog && options.tclOfficialCatalog
      && options.hisenseGroupOfficialCatalog && options.meilingOfficialCatalog
      && options.konkaFrestecOfficialCatalog && options.siemensOfficialCatalog
      && options.royalstarOfficialChannel && options.jdOfficialRetailCatalog) {
      await registerMarketUniverseRoutes(app, {
        projects: options.workbench.productProjects,
        marketUniverses: options.workbench.marketUniverses,
        haierCatalog: options.haierOfficialCatalog,
        leaderCatalog: options.leaderOfficialCatalog,
        mideaCatalog: options.mideaOfficialCatalog,
        tclCatalog: options.tclOfficialCatalog,
        hisenseGroupCatalog: options.hisenseGroupOfficialCatalog,
        meilingCatalog: options.meilingOfficialCatalog,
        konkaFrestecCatalog: options.konkaFrestecOfficialCatalog,
        siemensCatalog: options.siemensOfficialCatalog,
        royalstarCatalog: options.royalstarOfficialChannel,
        jdCatalog: options.jdOfficialRetailCatalog,
        regulatoryPipeline: options.marketUniverseRegulatoryPipeline,
        requestedBy: options.localUserId ?? "local-user",
      });
    }
  }

  await app.register(cors, {
    origin: true
  });

  await registerHealthRoutes(app);
  await registerModuleRoutes(app, db);
  await registerAnalysisRoutes(app, db);

  return app;
}

function resolveStatusCode(error: Error & { statusCode?: number }) {
  if (error instanceof ZodError) return 400;
  if (error instanceof ProductProjectError) {
    if (error.code === "not_found") return 404;
    if (error.code === "revision_conflict") return 409;
    return 422;
  }
  if (error instanceof CategoryInterviewError) {
    if (error.code === "not_found") return 404;
    if (error.code === "revision_conflict") return 409;
    return 422;
  }
  if (error instanceof EvidenceError) {
    if (error.code === "not_found") return 404;
    if (error.code === "integrity_mismatch") return 500;
    return 422;
  }
  if (error instanceof KnowledgeFactoryError) {
    if (error.code === "request_not_found") return 404;
    return 422;
  }
  if (error instanceof KnowledgeReviewError) {
    if (error.code === "batch_not_found" || error.code === "target_not_found") return 404;
    if (error.code === "target_already_decided") return 409;
    return 422;
  }
  if (error instanceof KnowledgePackageError) {
    if (error.code === "package_not_found") return 404;
    return 422;
  }
  if (error instanceof MarketUniverseError) {
    if (error.code === "candidate_changed") return 409;
    return 422;
  }
  if (error instanceof MarketUniverseRegulatoryPipelineError) {
    if (error.code === "not_found") return 404;
    if (error.code === "timeout") return 504;
    return 422;
  }
  if (error instanceof SourceAccessError) {
    if (error.code === "source_abnormal") return 502;
    return 422;
  }
  if (error instanceof SourceDatasetError) {
    if (error.code === "run_not_found" || error.code === "snapshot_not_found") return 404;
    if (error.code === "idempotency_conflict" || error.code === "run_closed") return 409;
    return 422;
  }
  if (error instanceof SourceDatasetExportError) return 422;
  if (error instanceof SourceCollectionPlannerError) return 422;
  return error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
}
