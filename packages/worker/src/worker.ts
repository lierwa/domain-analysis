import { createDb, initializeDatabase } from "@domain-analysis/db";
import { loadWorkerConfig } from "./config";
import { createCrawlWorker } from "./queue/bullmqQueue";
import { processCrawlJob } from "./runner/crawlWorker";
import { recoverStaleCollectionRuns } from "./runner/recovery";

const config = loadWorkerConfig();
await initializeDatabase(config.databaseUrl);
const db = createDb(config.databaseUrl);

const recovery = await recoverStaleCollectionRuns(db, {
  now: new Date(),
  staleAfterMs: Number(process.env.STALE_COLLECTION_RECOVERY_MS ?? 2 * 60 * 1000)
});

createCrawlWorker({
  redisUrl: config.redisUrl,
  concurrency: config.concurrency,
  processor: async ({ runId, taskId }) => {
    await processCrawlJob({ db, runId, taskId });
  }
});

console.log(
  `crawl worker started concurrency=${config.concurrency} recoveredRuns=${recovery.recoveredRuns} recoveredTasks=${recovery.recoveredTasks}`
);
