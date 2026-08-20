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
  createCrawlPlanningModule,
  type CrawlPlanningModule,
  type CrawlPlanningRuntime,
} from "./crawlPlanningModule";
import { createSourceDatasetModule, type SourceDatasetModule } from "./sourceDatasetModule";
import { createSourceExecutionModule, type SourceExecutionModule, type SourceProvider } from "./sourceExecutionModule";

export interface DataCollectionWorkbench {
  categoryInterviews?: CategoryInterviewModule;
  crawlPlanning?: CrawlPlanningModule;
  captureTasks: CaptureTaskModule;
  sourceDatasets: SourceDatasetModule;
  sourceExecution?: SourceExecutionModule;
  close(): Promise<void>;
}

export interface OpenDataCollectionWorkbenchOptions {
  databaseUrl?: string;
  categoryInterviewRuntime?: CategoryInterviewRuntime;
  categoryInterviewModule?: { now?: () => Date; createId?: (kind: string) => string };
  crawlPlanningRuntime?: CrawlPlanningRuntime;
  crawlPlanningModule?: { now?: () => Date; createId?: (kind: string) => string };
  sourceDatasetModule?: { assetCachePath?: string };
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
  const crawlPlanningRuntime = options.crawlPlanningRuntime;
  const sourceDatasets = createSourceDatasetModule(db, options.sourceDatasetModule);
  const resolveSourceProvider = options.sourceProviders ? (source: Parameters<SourceProvider["validate"]>[0]) => {
    const provider = options.sourceProviders!.get(source.provider.key);
    if (!provider || provider.version !== source.provider.version) throw new Error(`Provider 不可用：${source.provider.key}@${source.provider.version}`);
    return provider;
  } : undefined;
  const providerValidation = resolveSourceProvider ? (source: Parameters<SourceProvider["validate"]>[0]) => {
    resolveSourceProvider(source).validate(source);
  } : undefined;
  const providerPreflight = resolveSourceProvider ? async (source: Parameters<SourceProvider["validate"]>[0]) => {
    const provider = resolveSourceProvider(source);
    provider.validate(source);
    await provider.preflight(source);
  } : undefined;
  const crawlPlanning = options.crawlPlanningRuntime
    ? createCrawlPlanningModule(db, captureTasks, options.crawlPlanningRuntime,
      { ...options.crawlPlanningModule, validateSource: providerValidation, preflightSource: providerPreflight })
    : undefined;
  return {
    captureTasks,
    categoryInterviews: options.categoryInterviewRuntime
      ? createCategoryInterviewModule(db, options.categoryInterviewRuntime, options.categoryInterviewModule)
      : undefined,
    crawlPlanning,
    sourceDatasets,
    sourceExecution: crawlPlanning && options.sourceProviders
      ? createSourceExecutionModule(crawlPlanning, sourceDatasets, options.sourceProviders)
      : undefined,
    close: async () => {
      await Promise.all([
        categoryInterviewRuntime?.close?.(),
        crawlPlanningRuntime?.close?.(),
      ]);
      await db.$client.end();
    },
  };
}
