import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { pipelineStages, type PipelineRunView } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithDbos = databaseUrl ? describe : describe.skip;
const workerUrl = new URL("./fixtures/dbosPipelineRecoveryWorker.ts", import.meta.url);

describeWithDbos("DbosPipelineModule process recovery", () => {
  it("continues after SIGKILL without repeating committed stages or material", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dbos-pipeline-recovery-"));
    const materialPath = path.join(directory, "material.json");
    const logPath = path.join(directory, "executions.log");
    const schemaName = `domain_analysis_recovery_${process.pid}_${Date.now()}`;

    const first = spawnWorker("start", "", materialPath, logPath, schemaName);
    const waiting = await waitForMessage(first, "waiting");
    const hashBeforeKill = await fileHash(materialPath);
    first.kill("SIGKILL");
    await waitForExit(first);

    const recovered = spawnWorker("recover", waiting.runId, materialPath, logPath, schemaName);
    const completed = await waitForMessage(recovered, "completed");
    await waitForExit(recovered);

    expect(completed.view.lifecycleStatus).toBe("succeeded");
    expect(await fileHash(materialPath)).toBe(hashBeforeKill);
    expect((await readFile(logPath, "utf8")).trim().split("\n")).toEqual(pipelineStages);
  }, 45_000);
});

function spawnWorker(
  mode: "start" | "recover",
  runId: string,
  materialPath: string,
  logPath: string,
  schemaName: string,
) {
  return fork(workerUrl, [mode, runId, materialPath, logPath], {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, POSTGRES_DATABASE_URL: databaseUrl, DBOS_TEST_SCHEMA: schemaName },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
}

function waitForMessage(child: ChildProcess, type: "waiting"): Promise<{ type: "waiting"; runId: string }>;
function waitForMessage(child: ChildProcess, type: "completed"):
  Promise<{ type: "completed"; view: PipelineRunView }>;
function waitForMessage(child: ChildProcess, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("message", (message: any) => {
      if (message?.type === type) resolve(message);
    });
    child.once("exit", (code, signal) => {
      if (type !== "exit" && code !== 0) reject(new Error(
        `recovery worker 提前退出 code=${code} signal=${signal}: ${stderr}`,
      ));
    });
    setTimeout(() => reject(new Error(`等待 recovery worker 消息超时：${type}\n${stderr}`)), 30_000);
  });
}

function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

async function fileHash(filePath: string) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}
