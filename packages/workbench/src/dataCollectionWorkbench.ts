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

export interface DataCollectionWorkbench {
  categoryInterviews?: CategoryInterviewModule;
  crawlPlanning?: CrawlPlanningModule;
  captureTasks: CaptureTaskModule;
  sourceDatasets: SourceDatasetModule;
  close(): Promise<void>;
}

export interface OpenDataCollectionWorkbenchOptions {
  databaseUrl?: string;
  categoryInterviewRuntime?: CategoryInterviewRuntime;
  categoryInterviewModule?: { now?: () => Date; createId?: (kind: string) => string };
  crawlPlanningRuntime?: CrawlPlanningRuntime;
  crawlPlanningModule?: { now?: () => Date; createId?: (kind: string) => string };
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
  return {
    captureTasks,
    categoryInterviews: options.categoryInterviewRuntime
      ? createCategoryInterviewModule(db, options.categoryInterviewRuntime, options.categoryInterviewModule)
      : undefined,
    crawlPlanning: options.crawlPlanningRuntime
      ? createCrawlPlanningModule(db, captureTasks, options.crawlPlanningRuntime, options.crawlPlanningModule)
      : undefined,
    sourceDatasets: createSourceDatasetModule(db),
    close: async () => {
      await Promise.all([
        categoryInterviewRuntime?.close?.(),
        crawlPlanningRuntime?.close?.(),
      ]);
      await db.$client.end();
    },
  };
}
