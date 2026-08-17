import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  SourceCollectionPipelineRun,
  SourceCollectionRunView,
} from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithDbos = databaseUrl ? describe : describe.skip;
const workerUrl = new URL("./fixtures/sourceCollectionPipelineRecoveryWorker.ts", import.meta.url);

describeWithDbos("SourceCollectionPipeline process recovery", () => {
  it("首条落库后 SIGKILL，恢复时不重复访问并继续剩余工作项", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "source-collection-recovery-"));
    const evidenceRoot = path.join(directory, "evidence");
    const accessLogPath = path.join(directory, "access.log");
    const schemaName = `domain_analysis_source_recovery_${process.pid}_${Date.now()}`;
    try {
      const first = spawnWorker("start", "", "", evidenceRoot, accessLogPath, schemaName);
      const waiting = await waitForMessage(first, "first_committed");
      first.kill("SIGKILL");
      await waitForExit(first);

      const recovered = spawnWorker(
        "recover",
        waiting.sourceRunId,
        waiting.executionId,
        evidenceRoot,
        accessLogPath,
        schemaName,
      );
      const completed = await waitForMessage(recovered, "completed");
      await waitForExit(recovered);

      expect(completed.execution).toMatchObject({
        lifecycleStatus: "succeeded",
        totalItems: 3,
        completedItems: 3,
      });
      expect(completed.sourceView?.run).toMatchObject({
        status: "completed",
        snapshotCount: 3,
        accessibleCount: 3,
      });
      expect((await readFile(accessLogPath, "utf8")).trim().split("\n"))
        .toEqual(["item-A", "item-B", "item-C"]);
      expectPacedStarts(completed.execution.recentRequestStartedAt);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 45_000);
});

function spawnWorker(
  mode: "start" | "recover",
  sourceRunId: string,
  executionId: string,
  evidenceRoot: string,
  accessLogPath: string,
  schemaName: string,
) {
  return fork(workerUrl, [mode, sourceRunId, executionId, evidenceRoot, accessLogPath], {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, POSTGRES_DATABASE_URL: databaseUrl, DBOS_TEST_SCHEMA: schemaName },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
}

function waitForMessage(child: ChildProcess, type: "first_committed"):
  Promise<{ type: "first_committed"; sourceRunId: string; executionId: string }>;
function waitForMessage(child: ChildProcess, type: "completed"):
  Promise<{
    type: "completed";
    execution: SourceCollectionPipelineRun;
    sourceView: SourceCollectionRunView | null;
  }>;
function waitForMessage(child: ChildProcess, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => reject(
      new Error(`等待 Source Collection recovery worker 消息超时：${type}\n${stderr}`),
    ), 35_000);
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("message", (message: any) => {
      if (message?.type === type) {
        clearTimeout(timeout);
        resolve(message);
      }
    });
    child.once("exit", (code, signal) => {
      if (type !== "exit" && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`recovery worker 提前退出 code=${code} signal=${signal}: ${stderr}`));
      }
    });
  });
}

function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

function expectPacedStarts(timestamps: string[]) {
  expect(timestamps).toHaveLength(3);
  const starts = timestamps.map(Date.parse);
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(2_900);
  expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(2_900);
}
