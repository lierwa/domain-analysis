import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  createCodexCategoryInterviewRuntime,
  createCodexKnowledgeAiReviewer,
  createCodexPublicSourcePlanningResearcher,
  createMultiSourceCategoryPlanningRuntime,
  createZolCategoryPlanningRuntime,
  openDataCollectionWorkbench,
} from "@domain-analysis/workbench";
import {
  createPublicWebResourceProvider,
  createZolBrandRankingReader,
  createZolCatalogGalleryProvider,
} from "@domain-analysis/worker";

import { loadConfig } from "./config";
import { buildServer } from "./server";
import { createSourceExecutionQueue } from "./sourceExecutionQueue";
import { createKnowledgeProcessingQueue } from "./knowledgeProcessingQueue";

const config = loadConfig();
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
// WHY：数据库可由多个本地 checkout 读取，但内容寻址资产仍只保留一份；显式路径避免复制原始附件。
const assetCachePath = config.sourceAssetCachePath
  ? path.resolve(config.sourceAssetCachePath)
  : path.join(repositoryRoot, "data", "source-assets");
const zolProvider = createZolCatalogGalleryProvider();
const publicProvider = createPublicWebResourceProvider({
  queueStorageDirectory: path.join(repositoryRoot, "data", "source-queues"),
});
const zolBrandRankingReader = createZolBrandRankingReader();
const catalogPlanningRuntime = createZolCategoryPlanningRuntime({ rankingReader: zolBrandRankingReader });
const publicSourceResearcher = createCodexPublicSourcePlanningResearcher({
  repositoryRoot,
  model: config.interviewModelId,
  reasoningEffort: config.interviewReasoningEffort,
});
const knowledgeAiReviewer = createCodexKnowledgeAiReviewer({
  repositoryRoot,
  model: config.knowledgeReviewModelId,
  reasoningEffort: config.knowledgeReviewReasoningEffort,
});
// WHY：Crawl Plan 中的商品目录与公开网页/PDF 是同级来源；生产注册表必须能按 source.provider
// 分发给各自已验证的 Provider，不能让 ZOL 垂直链隐式垄断全部来源。
const sourceProviders = new Map([
  [zolProvider.key, zolProvider],
  [publicProvider.key, publicProvider],
]);
const workbench = await openDataCollectionWorkbench({
  databaseUrl: config.postgresDatabaseUrl,
  categoryInterviewRuntime: createCodexCategoryInterviewRuntime({
    repositoryRoot,
    model: config.interviewModelId,
    reasoningEffort: config.interviewReasoningEffort,
  }),
  crawlPlanningRuntime: createMultiSourceCategoryPlanningRuntime({
    catalogRuntime: catalogPlanningRuntime,
    publicSourceResearcher,
  }),
  sourceDatasetModule: { assetCachePath },
  knowledgeProcessing: {
    cachePath: path.join(repositoryRoot, "data", "knowledge-processing", "cache"),
    artifactPath: path.join(repositoryRoot, "data", "knowledge-processing", "artifacts"),
    workPath: path.join(repositoryRoot, "data", "knowledge-processing", "work"),
    pythonPath: process.env.KNOWLEDGE_PYTHON_PATH,
    modelRoot: process.env.KNOWLEDGE_MODEL_ROOT,
    aiReviewer: knowledgeAiReviewer,
  },
  sourceProviders,
});
if (!workbench.sourceExecution) throw new Error("Source Execution 未完成装配");
await workbench.sourceDatasets.recoverInterruptedBatches();
const sourceExecutionQueue = await createSourceExecutionQueue({
  connectionString: config.postgresDatabaseUrl,
  execution: workbench.sourceExecution,
  datasets: workbench.sourceDatasets,
});
const knowledgeProcessingQueue = await createKnowledgeProcessingQueue(config.postgresDatabaseUrl, workbench.knowledgeProcessing!);
const app = await buildServer({ workbench, sourceExecutionQueue, knowledgeProcessingQueue });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
