import { createDb, initializeDatabase } from "@domain-analysis/db";
import { openProductKnowledgeWorkbench } from "@domain-analysis/workbench";
import { loadConfig } from "./config";
import { buildServer } from "./server";

const config = loadConfig();
await initializeDatabase(config.databaseUrl);
const workbench = await openProductKnowledgeWorkbench({
  databaseUrl: config.productKnowledgeDatabaseUrl,
});
const app = await buildServer({ db: createDb(config.databaseUrl), workbench });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
