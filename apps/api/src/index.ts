import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  createCodexCategoryInterviewRuntime,
  createCodexCrawlPlanningRuntime,
  openDataCollectionWorkbench,
} from "@domain-analysis/workbench";
import { createJdCatalogProvider, createPublicWebResourceProvider } from "@domain-analysis/worker";

import { loadConfig } from "./config";
import { buildServer } from "./server";

const config = loadConfig();
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const sourceProviders = new Map();
const publicProvider = createPublicWebResourceProvider();
sourceProviders.set(publicProvider.key, publicProvider);
if (config.jdCdpEndpoint) {
  const provider = createJdCatalogProvider({ endpointUrl: config.jdCdpEndpoint });
  sourceProviders.set(provider.key, provider);
}
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
const app = await buildServer({ workbench });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
