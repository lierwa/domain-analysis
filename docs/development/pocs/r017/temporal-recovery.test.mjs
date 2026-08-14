import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, stat } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";

import { approveSignal, statusQuery } from "./temporal-workflow.mjs";

const temporalExecutable = process.env.R017_TEMPORAL_EXECUTABLE
  ?? "/private/var/folders/sw/ltswvbpd55s5g88xywtg42jr0000gn/T/temporal-sdk-typescript-1.22.0";

test("Temporal 服务与 Worker 重启后继续且不重复步骤", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "r017-temporal-"));
  const logPath = path.join(directory, "steps.log");
  const databasePath = path.join(directory, "temporal.db");
  const port = await reservePort();
  const address = `127.0.0.1:${port}`;
  const taskQueue = `r017-${Date.now()}`;
  const workflowId = `r017-${Date.now()}`;
  const activities = { recordStage: (_runId, stage) => appendFile(logPath, `${stage}\n`) };

  let firstServer;
  let firstEnvironment;
  let firstWorker;
  try {
    firstServer = await startServer(port, databasePath);
    firstEnvironment = await TestWorkflowEnvironment.createFromExistingServer({ address });
    firstWorker = await createWorker(firstEnvironment, taskQueue, activities);
    const firstRun = firstWorker.run();
    const handle = await firstEnvironment.client.workflow.start("pipelineWorkflow", {
      taskQueue,
      workflowId,
      args: [{ runId: "temporal-run" }],
    });
    await waitForStatus(handle, "waiting_review");
    firstWorker.shutdown();
    await firstRun;
    await firstEnvironment.teardown();
    firstEnvironment = undefined;
    await stopServer(firstServer);
    firstServer = undefined;
    assert.deepEqual(await readSteps(logPath), ["collect"]);
    assert.ok((await stat(databasePath)).size > 0);

    const secondServer = await startServer(port, databasePath);
    const secondEnvironment = await TestWorkflowEnvironment.createFromExistingServer({ address });
    const secondWorker = await createWorker(secondEnvironment, taskQueue, activities);
    try {
      const secondRun = secondWorker.run();
      const restoredHandle = secondEnvironment.client.workflow.getHandle(workflowId);
      await restoredHandle.signal(approveSignal);
      assert.deepEqual(await restoredHandle.result(), { runId: "temporal-run", status: "completed" });
      secondWorker.shutdown();
      await secondRun;
      assert.deepEqual(await readSteps(logPath), ["collect", "package"]);
    } finally {
      shutdownIfRunning(secondWorker);
      await secondEnvironment.teardown();
      await stopServer(secondServer);
    }
  } finally {
    shutdownIfRunning(firstWorker);
    if (firstEnvironment) await firstEnvironment.teardown();
    if (firstServer) await stopServer(firstServer);
  }
});

async function startServer(port, databasePath) {
  const child = spawn(temporalExecutable, [
    "server", "start-dev", "--headless", "--ip", "127.0.0.1",
    "--port", String(port), "--db-filename", databasePath,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  await waitForPort(port, child);
  return child;
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Temporal 服务停止超时")), 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForPort(port, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Temporal 服务提前退出：${child.exitCode}`);
    if (await canConnect(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Temporal 服务启动超时");
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function createWorker(environment, taskQueue, activities) {
  return Worker.create({
    connection: environment.nativeConnection,
    namespace: environment.namespace,
    taskQueue,
    workflowsPath: new URL("./temporal-workflow.mjs", import.meta.url).pathname,
    activities,
  });
}

function shutdownIfRunning(worker) {
  if (worker && !["STOPPING", "DRAINING", "DRAINED", "STOPPED"].includes(worker.getState())) {
    worker.shutdown();
  }
}

async function waitForStatus(handle, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await handle.query(statusQuery).catch(() => undefined) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Temporal 未进入状态：${expected}`);
}

async function readSteps(filePath) {
  return (await readFile(filePath, "utf8")).trim().split("\n");
}
