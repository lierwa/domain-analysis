import { createDb, initializeDatabase } from "@domain-analysis/db";
import { loadConfig } from "./config";
import { buildServer } from "./server";

const config = loadConfig();
await initializeDatabase(config.databaseUrl);
const app = await buildServer({ db: createDb(config.databaseUrl) });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
