import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  createCodexCategoryInterviewRuntime,
  createCodexCrawlPlanningStageRuntime,
  openDataCollectionWorkbench,
} from "@domain-analysis/workbench";
import { createPublicWebResourceProvider } from "@domain-analysis/worker";

import { loadConfig } from "./config";
import { buildServer } from "./server";
import { createSourceExecutionQueue } from "./sourceExecutionQueue";

const config = loadConfig();
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const sourceProviders = new Map();
const publicProvider = createPublicWebResourceProvider({
  queueStorageDirectory: path.join(repositoryRoot, "data", "source-queues"),
});
sourceProviders.set(publicProvider.key, publicProvider);
const workbench = await openDataCollectionWorkbench({
  databaseUrl: config.postgresDatabaseUrl,
  categoryInterviewRuntime: createCodexCategoryInterviewRuntime({
    repositoryRoot,
    model: config.interviewModelId,
    reasoningEffort: config.interviewReasoningEffort,
  }),
  crawlPlanningStageRuntime: createCodexCrawlPlanningStageRuntime({
    repositoryRoot,
    model: config.interviewModelId,
    reasoningEffort: config.interviewReasoningEffort,
    brandBatchSize: config.crawlPlanningBrandBatchSize,
  }),
  crawlPlanningDurability: {
    brandBatchSize: config.crawlPlanningBrandBatchSize,
  },
  sourceDatasetModule: { assetCachePath: path.join(repositoryRoot, "data", "source-assets") },
  sourceProviders,
});
if (!workbench.sourceExecution) throw new Error("Source Execution 未完成装配");
// WHY：Graphile 普通版在 SIGKILL 后不会立即释放 job；先用领域 lease 收口失联批次，
// 再启动 runner，避免旧 running 永久占据用户事实源或被误当成活动执行。
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
