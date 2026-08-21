import { createPersistentCrawleeConfiguration, openPersistentRequestQueue } from "../../src/ephemeralCrawleeConfiguration";

const [storageDirectory, queueName] = process.argv.slice(2);
if (!storageDirectory || !queueName) throw new Error("缺少 storageDirectory 或 queueName");

const configuration = createPersistentCrawleeConfiguration(storageDirectory);
const queue = await openPersistentRequestQueue(queueName, configuration, 2);
await queue.addRequest({ url: "https://fixture.invalid/catalog", uniqueKey: "catalog:1" });
await queue.addRequest({ url: "https://fixture.invalid/detail/1", uniqueKey: "detail:1" });
const completed = await queue.fetchNextRequest();
if (!completed) throw new Error("缺少首个工作项");
await queue.markRequestHandled(completed);
const locked = await queue.fetchNextRequest();
if (!locked) throw new Error("缺少待强杀工作项");
process.stdout.write(`LOCKED:${locked.uniqueKey}\n`);
setInterval(() => undefined, 1_000);
