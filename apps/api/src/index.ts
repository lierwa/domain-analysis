import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  createCodexCategoryInterviewRuntime,
  openDataCollectionWorkbench,
} from "@domain-analysis/workbench";

import { loadConfig } from "./config";
import { buildServer } from "./server";

const config = loadConfig();
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const workbench = await openDataCollectionWorkbench({
  databaseUrl: config.postgresDatabaseUrl,
  categoryInterviewRuntime: createCodexCategoryInterviewRuntime({
    repositoryRoot,
    model: config.interviewModelId,
    reasoningEffort: config.interviewReasoningEffort,
  }),
  sourceDatasetModule: { assetCachePath: path.join(repositoryRoot, "data", "source-assets") },
});
const app = await buildServer({ workbench });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
