import {
  createWorkbenchDb,
  defaultWorkbenchDatabaseUrl,
  migrateWorkbenchDatabase,
} from "@domain-analysis/db";

import {
  createCaptureTaskModule,
  type CaptureTaskModule,
} from "./captureTaskModule";
import {
  createCategoryInterviewModule,
  type CategoryInterviewModule,
  type CategoryInterviewRuntime,
} from "./categoryInterviewModule";
import {
  createCrawlPlanModule,
  type CrawlPlanModule,
} from "./crawlPlanModule";
import { createCrawlPlanningModule, type CrawlPlanningModule,
  type CrawlPlanningRuntime } from "./crawlPlanningModule";
import { createSourceDatasetModule, type SourceDatasetModule } from "./sourceDatasetModule";
import { createSourceCoverageModule } from "./sourceCoverageModule";
import { createKnowledgeProcessingModule, type KnowledgeProcessingModule,
  type KnowledgeProcessingOptions } from "./knowledgeProcessingModule";
import { createSourceExecutionModule, type SourceExecutionModule, type SourceProvider } from "./sourceExecutionModule";

export interface DataCollectionWorkbench {
  categoryInterviews?: CategoryInterviewModule;
  captureTasks: CaptureTaskModule;
  crawlPlans: CrawlPlanModule;
  crawlPlanning?: CrawlPlanningModule;
  sourceDatasets: SourceDatasetModule;
  sourceExecution?: SourceExecutionModule;
  knowledgeProcessing?: KnowledgeProcessingModule;
  close(): Promise<void>;
}

export interface OpenDataCollectionWorkbenchOptions {
  databaseUrl?: string;
  categoryInterviewRuntime?: CategoryInterviewRuntime;
  crawlPlanningRuntime?: CrawlPlanningRuntime;
  categoryInterviewModule?: { now?: () => Date; createId?: (kind: string) => string };
  sourceDatasetModule?: { assetCachePath?: string };
  knowledgeProcessing?: KnowledgeProcessingOptions;
  sourceProviders?: ReadonlyMap<string, SourceProvider>;
}

export async function openDataCollectionWorkbench(
  options: OpenDataCollectionWorkbenchOptions = {},
): Promise<DataCollectionWorkbench> {
  const databaseUrl = options.databaseUrl ?? defaultWorkbenchDatabaseUrl;
  await migrateWorkbenchDatabase(databaseUrl);
  const db = createWorkbenchDb(databaseUrl);
  const captureTasks = createCaptureTaskModule(db);
  const categoryInterviewRuntime = options.categoryInterviewRuntime;
  const sourceCoverage = createSourceCoverageModule(db);
  const sourceDatasets = createSourceDatasetModule(db, {
    ...options.sourceDatasetModule,
    coverageModule: sourceCoverage,
  });
  const crawlPlans = createCrawlPlanModule(db, captureTasks);
  const crawlPlanningRuntime = options.crawlPlanningRuntime;
  const crawlPlanning = crawlPlanningRuntime
    ? createCrawlPlanningModule(db, captureTasks, crawlPlans, crawlPlanningRuntime, sourceCoverage, (source) => {
      const provider = options.sourceProviders?.get(source.provider.key);
      if (!provider || provider.version !== source.provider.version) {
        throw new Error(`计划引用了当前未装配的 Provider：${source.provider.key}@${source.provider.version}`);
      }
      provider.validate(source);
    })
    : undefined;
  const sourceExecution = options.sourceProviders
    ? createSourceExecutionModule(crawlPlans, sourceDatasets, options.sourceProviders)
    : undefined;
  return {
    captureTasks,
    crawlPlans,
    crawlPlanning,
    categoryInterviews: options.categoryInterviewRuntime
      ? createCategoryInterviewModule(db, options.categoryInterviewRuntime, options.categoryInterviewModule)
      : undefined,
    sourceDatasets,
    sourceExecution,
    knowledgeProcessing: options.knowledgeProcessing
      ? createKnowledgeProcessingModule(db, sourceDatasets, options.knowledgeProcessing) : undefined,
    close: async () => {
      await categoryInterviewRuntime?.close?.();
      await crawlPlanningRuntime?.close?.();
      await options.knowledgeProcessing?.aiReviewer?.close();
      await Promise.all([...new Set(options.sourceProviders?.values() ?? [])]
        .map((provider) => provider.close?.()));
      await db.$client.end();
    },
  };
}
