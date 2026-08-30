import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  createCodexCategoryInterviewRuntime,
  createZolCategoryPlanningRuntime,
  openDataCollectionWorkbench,
} from "@domain-analysis/workbench";
import {
  createZolBrandRankingReader,
  createZolCatalogGalleryProvider,
} from "@domain-analysis/worker";

import { loadConfig } from "./config";
import { buildServer } from "./server";
import { createSourceExecutionQueue } from "./sourceExecutionQueue";

const config = loadConfig();
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const zolProvider = createZolCatalogGalleryProvider();
const zolBrandRankingReader = createZolBrandRankingReader();
const sourceProviders = new Map([[zolProvider.key, zolProvider]]);
const workbench = await openDataCollectionWorkbench({
  databaseUrl: config.postgresDatabaseUrl,
  categoryInterviewRuntime: createCodexCategoryInterviewRuntime({
    repositoryRoot,
    model: config.interviewModelId,
    reasoningEffort: config.interviewReasoningEffort,
  }),
  crawlPlanningRuntime: createZolCategoryPlanningRuntime({
    rankingReader: zolBrandRankingReader,
  }),
  sourceDatasetModule: { assetCachePath: path.join(repositoryRoot, "data", "source-assets") },
  sourceProviders,
});
if (!workbench.sourceExecution) throw new Error("Source Execution 未完成装配");
await workbench.sourceDatasets.recoverInterruptedBatches();
const sourceExecutionQueue = await createSourceExecutionQueue({
  connectionString: config.postgresDatabaseUrl,
  execution: workbench.sourceExecution,
});
const app = await buildServer({ workbench, sourceExecutionQueue });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
