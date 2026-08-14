import { appendFile } from "node:fs/promises";

import { DBOS } from "@dbos-inc/dbos-sdk";

const [mode, workflowId, logPath] = process.argv.slice(2);
const databaseUrl = process.env.R017_DBOS_URL;
if (!databaseUrl || !mode || !workflowId || !logPath) throw new Error("DBOS 子进程参数不完整");

const workflow = DBOS.registerWorkflow(async (runId) => {
  await DBOS.runStep(() => appendFile(logPath, "collect\n"), { name: "collect" });
  await DBOS.setEvent("status", "waiting_review");
  // WHY：人工等待必须交给 DBOS 的持久消息，而不是占住本地 Promise 或线程。
  const approval = await DBOS.recv("approval", { timeoutSeconds: 300, pollingIntervalMs: 50 });
  if (!approval?.approved) throw new Error("审核未通过或超时");
  await DBOS.runStep(() => appendFile(logPath, "package\n"), { name: "package" });
  return { runId, status: "completed" };
}, { name: "r017Pipeline" });

DBOS.setConfig({
  name: "r017",
  systemDatabaseUrl: databaseUrl,
  systemDatabaseSchemaName: "r017_durable",
  runAdminServer: false,
  logLevel: "warn",
});

await DBOS.launch();
if (mode === "start") await DBOS.startWorkflow(workflow, { workflowID: workflowId })("dbos-run");

const status = await DBOS.getEvent(workflowId, "status", { timeoutSeconds: 10, pollingIntervalMs: 50 });
process.send?.({ type: mode === "start" ? status : "recovered" });

process.on("message", async (message) => {
  if (message?.type === "approve") {
    await DBOS.send(workflowId, { approved: true }, "approval", "r017-approval");
    const result = await DBOS.getResult(workflowId, { timeoutSeconds: 10, pollingIntervalMs: 50 });
    process.send?.({ type: "completed", result });
  }
  if (message?.type === "shutdown") {
    await DBOS.shutdown();
    process.exit(0);
  }
});
