import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  createCodexCategoryInterviewRuntime,
  createCodexCrawlPlanningRuntime,
  openDataCollectionWorkbench,
} from "@domain-analysis/workbench";
import { createAnonymousJdHttpAccessFactory, createJdCatalogProvider,
  createPublicWebResourceProvider } from "@domain-analysis/worker";

import { loadConfig } from "./config";
import { buildServer } from "./server";
import { createSourceExecutionQueue } from "./sourceExecutionQueue";

const config = loadConfig();
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const sourceProviders = new Map();
const publicProvider = createPublicWebResourceProvider();
sourceProviders.set(publicProvider.key, publicProvider);
// WHY：能力装配不等于出网；启动和 Prepare 都是零请求，只有已确认计划的显式 Start 才会使用此 access。
const jdProvider = createJdCatalogProvider({
  storageDirectory: path.join(repositoryRoot, "data", "jd-request-queues"),
  ...(config.jdRealHttpEnabled ? { openHttpAccess: createAnonymousJdHttpAccessFactory() } : {}),
});
sourceProviders.set(jdProvider.key, jdProvider);
const workbench = await openDataCollectionWorkbench({
  databaseUrl: config.postgresDatabaseUrl,
  categoryInterviewRuntime: createCodexCategoryInterviewRuntime({
    repositoryRoot,
    model: config.interviewModelId,
    reasoningEffort: config.interviewReasoningEffort,
  }),
  crawlPlanningRuntime: createCodexCrawlPlanningRuntime({
    repositoryRoot,
    model: config.interviewModelId,
    reasoningEffort: config.interviewReasoningEffort,
  }),
  sourceDatasetModule: { assetCachePath: path.join(repositoryRoot, "data", "source-assets") },
  sourceProviders,
});
if (!workbench.sourceExecution) throw new Error("Source Execution 未完成装配");
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
