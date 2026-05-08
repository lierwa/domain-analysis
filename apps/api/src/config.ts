import { z } from "zod";
import { getDefaultDatabaseUrl } from "@domain-analysis/db";

const configSchema = z.object({
  nodeEnv: z.string().default("development"),
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65535).default(4000),
  databaseUrl: z.string().default(getDefaultDatabaseUrl())
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): AppConfig {
  return configSchema.parse({
    nodeEnv: env.NODE_ENV,
    host: env.API_HOST,
    port: env.API_PORT,
    databaseUrl: env.DATABASE_URL
  });
}
