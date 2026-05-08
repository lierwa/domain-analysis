import { getDefaultDatabaseUrl } from "@domain-analysis/db";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkerConfig {
  databaseUrl: string;
  redisUrl: string;
  concurrency: number;
  browserProfilePath: string;
}

export function getDefaultBrowserProfilePath() {
  const workerPackageDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(workerPackageDir, "../../..");
  return resolve(repoRoot, "data/browser-profile");
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const redisUrl = env.REDIS_URL;
  if (!redisUrl) throw new Error("missing_REDIS_URL");

  return {
    databaseUrl: env.DATABASE_URL ?? getDefaultDatabaseUrl(),
    redisUrl,
    // WHY: 2C2G 服务器默认单 worker，后续只通过显式环境变量提升并发。
    concurrency: Number(env.CRAWL_WORKER_CONCURRENCY ?? 1),
    browserProfilePath: env.BROWSER_PROFILE_PATH ?? getDefaultBrowserProfilePath()
  };
}
