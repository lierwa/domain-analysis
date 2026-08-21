import { createWorkbenchDb } from "@domain-analysis/db";

import { acquireSourceRunLease } from "../../src/sourceRequestAdmission";

const [databaseUrl, runId] = process.argv.slice(2);
if (!databaseUrl || !runId) throw new Error("缺少 databaseUrl 或 runId");

const db = createWorkbenchDb(databaseUrl);
await acquireSourceRunLease(db, runId);
process.stdout.write(`LEASED:${runId}\n`);
setInterval(() => undefined, 1_000);
