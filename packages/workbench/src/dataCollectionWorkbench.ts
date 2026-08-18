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
import { createSourceDatasetModule, type SourceDatasetModule } from "./sourceDatasetModule";

export interface DataCollectionWorkbench {
  categoryInterviews?: CategoryInterviewModule;
  captureTasks: CaptureTaskModule;
  sourceDatasets: SourceDatasetModule;
  close(): Promise<void>;
}

export interface OpenDataCollectionWorkbenchOptions {
  databaseUrl?: string;
  categoryInterviewRuntime?: CategoryInterviewRuntime;
  categoryInterviewModule?: { now?: () => Date; createId?: (kind: string) => string };
}

export async function openDataCollectionWorkbench(
  options: OpenDataCollectionWorkbenchOptions = {},
): Promise<DataCollectionWorkbench> {
  const databaseUrl = options.databaseUrl ?? defaultWorkbenchDatabaseUrl;
  await migrateWorkbenchDatabase(databaseUrl);
  const db = createWorkbenchDb(databaseUrl);
  return {
    captureTasks: createCaptureTaskModule(db),
    categoryInterviews: options.categoryInterviewRuntime
      ? createCategoryInterviewModule(db, options.categoryInterviewRuntime, options.categoryInterviewModule)
      : undefined,
    sourceDatasets: createSourceDatasetModule(db),
    close: () => db.$client.end(),
  };
}
