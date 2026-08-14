import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DBOS } from "@dbos-inc/dbos-sdk";

const databaseUrl = process.env.R017_DBOS_URL;
if (!databaseUrl) throw new Error("缺少 R017_DBOS_URL");

test("DBOS 官方能力覆盖幂等、步骤重试、取消和恢复", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "r017-dbos-controls-"));
  const retryLog = path.join(directory, "retry.log");
  const controlLog = path.join(directory, "control.log");
  const retryWorkflow = registerRetryWorkflow(retryLog);
  const controlledWorkflow = registerControlledWorkflow(controlLog);

  DBOS.setConfig({
    name: "r017-controls",
    systemDatabaseUrl: databaseUrl,
    systemDatabaseSchemaName: "r017_durable",
    runAdminServer: false,
    logLevel: "warn",
  });

  try {
    await DBOS.launch();
    await verifyIdempotencyAndRetry(retryWorkflow, retryLog);
    await verifyCancelAndResume(controlledWorkflow, controlLog);
  } finally {
    if (DBOS.isInitialized()) await DBOS.shutdown();
  }
});

function registerRetryWorkflow(logPath) {
  return DBOS.registerWorkflow(async () => {
    await DBOS.runStep(async () => {
      await appendFile(logPath, "attempt\n");
      const attempts = (await readLines(logPath)).length;
      if (attempts < 3) throw new Error("模拟瞬时失败");
      await appendFile(logPath, "completed\n");
    }, {
      name: "retryable",
      retriesAllowed: true,
      intervalSeconds: 0.01,
      maxAttempts: 3,
    });
    return "ok";
  }, { name: "r017RetryPipeline" });
}

function registerControlledWorkflow(logPath) {
  return DBOS.registerWorkflow(async () => {
    await DBOS.runStep(() => appendFile(logPath, "collect\n"), { name: "collect" });
    await DBOS.setEvent("status", "waiting_review");
    const approval = await DBOS.recv("approval", { timeoutSeconds: 300, pollingIntervalMs: 20 });
    if (!approval?.approved) throw new Error("审核未通过或超时");
    await DBOS.runStep(() => appendFile(logPath, "package\n"), { name: "package" });
    return "completed";
  }, { name: "r017ControlledPipeline" });
}

async function verifyIdempotencyAndRetry(workflow, logPath) {
  const workflowId = `r017-retry-${Date.now()}`;
  const first = await DBOS.startWorkflow(workflow, { workflowID: workflowId })();
  const duplicate = await DBOS.startWorkflow(workflow, { workflowID: workflowId })();
  assert.deepEqual(await Promise.all([first.getResult(), duplicate.getResult()]), ["ok", "ok"]);
  // WHY：同一个业务输入必须只产生一个运行；workflowID 直接复用 DBOS 的幂等键。
  assert.deepEqual(await readLines(logPath), ["attempt", "attempt", "attempt", "completed"]);
  assert.equal((await DBOS.listWorkflowSteps(workflowId))?.length, 1);
}

async function verifyCancelAndResume(workflow, logPath) {
  const workflowId = `r017-control-${Date.now()}`;
  await DBOS.startWorkflow(workflow, { workflowID: workflowId })();
  assert.equal(await DBOS.getEvent(workflowId, "status", { timeoutSeconds: 10, pollingIntervalMs: 20 }),
    "waiting_review");
  await DBOS.cancelWorkflow(workflowId);
  await waitForStatus(workflowId, "CANCELLED");
  assert.deepEqual(await readLines(logPath), ["collect"]);

  const resumed = await DBOS.resumeWorkflow(workflowId);
  await DBOS.send(workflowId, { approved: true }, "approval", `approval-${workflowId}`);
  assert.equal(await resumed.getResult(), "completed");
  assert.deepEqual(await readLines(logPath), ["collect", "package"]);
}

async function waitForStatus(workflowId, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await DBOS.getWorkflowStatus(workflowId))?.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`DBOS 未进入状态：${expected}`);
}

async function readLines(filePath) {
  try {
    return (await readFile(filePath, "utf8")).trim().split("\n").filter(Boolean);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
