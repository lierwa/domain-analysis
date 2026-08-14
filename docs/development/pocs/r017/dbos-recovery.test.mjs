import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const databaseUrl = process.env.R017_DBOS_URL;
if (!databaseUrl) throw new Error("缺少 R017_DBOS_URL");

test("DBOS 进程崩溃后等待消息并且不重复完成步骤", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "r017-dbos-"));
  const logPath = path.join(directory, "steps.log");
  const workflowId = `r017-${Date.now()}`;

  const firstProcess = startWorker({ databaseUrl, logPath, workflowId, mode: "start" });
  await waitForMessage(firstProcess, "waiting_review");
  firstProcess.kill("SIGKILL");
  await waitForExit(firstProcess);
  assert.deepEqual(await readSteps(logPath), ["collect"]);

  const secondProcess = startWorker({ databaseUrl, logPath, workflowId, mode: "recover" });
  try {
    await waitForMessage(secondProcess, "recovered");
    secondProcess.send({ type: "approve" });
    const completed = await waitForMessage(secondProcess, "completed");
    assert.deepEqual(completed.result, { runId: "dbos-run", status: "completed" });
    assert.deepEqual(await readSteps(logPath), ["collect", "package"]);
  } finally {
    if (secondProcess.connected) secondProcess.send({ type: "shutdown" });
    await waitForExit(secondProcess);
  }
});

function startWorker({ databaseUrl, logPath, workflowId, mode }) {
  return fork(new URL("./dbos-worker.mjs", import.meta.url), [mode, workflowId, logPath], {
    env: { ...process.env, R017_DBOS_URL: databaseUrl },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
}

function waitForMessage(child, type, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const output = [];
    const timer = setTimeout(() => finish(new Error(`等待 DBOS 子进程消息超时：${type}`)), timeoutMs);
    const onMessage = (message) => message?.type === type && finish(undefined, message);
    const onExit = (code, signal) => finish(new Error(
      `DBOS 子进程提前退出：code=${code} signal=${signal}\n${output.join("")}`,
    ));
    child.stdout?.on("data", (chunk) => output.push(chunk));
    child.stderr?.on("data", (chunk) => output.push(chunk));
    child.on("message", onMessage);
    child.on("exit", onExit);

    function finish(error, message) {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(message);
    }
  });
}

function waitForExit(child, timeoutMs = 30_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待 DBOS 子进程退出超时")), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function readSteps(filePath) {
  return (await readFile(filePath, "utf8")).trim().split("\n");
}
