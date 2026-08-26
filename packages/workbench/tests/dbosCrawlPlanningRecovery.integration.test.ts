import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  captureTasks,
  crawlPlanningRuns,
  createWorkbenchDb,
  sourceCollectionPlans,
} from "@domain-analysis/db";
import { execa } from "execa";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;
const workerPath = fileURLToPath(new URL("./dbosCrawlPlanningRecoveryWorker.ts", import.meta.url));

describeWithPostgres("DBOS Crawl Planning 强杀恢复", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("页面投影进程强杀后只重做在途品牌批次并生成一个草稿", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "domain-analysis-dbos-planning-"));
    const suffix = randomUUID().replaceAll("-", "");
    const taskId = `task-dbos-recovery-${suffix}`;
    const schemaName = `crawl_planning_test_${suffix}`;
    const markerPath = path.join(root, "in-flight.marker");
    const logPath = path.join(root, "stages.log");
    const resultPath = path.join(root, "result.json");
    cleanups.push(() => cleanup(databaseUrl!, schemaName, taskId, root));
    const commonEnv = {
      ...process.env,
      POSTGRES_DATABASE_URL: databaseUrl!,
      DBOS_SCHEMA_NAME: schemaName,
      PLANNING_TASK_ID: taskId,
      RECOVERY_MARKER_PATH: markerPath,
      RECOVERY_LOG_PATH: logPath,
      RECOVERY_RESULT_PATH: resultPath,
    };

    const first = execa(process.execPath, ["--import=tsx", workerPath], {
      env: { ...commonEnv, RECOVERY_MODE: "start" }, reject: false,
    });
    await waitForFile(markerPath, 20_000);
    first.kill("SIGKILL");
    const firstResult = await first;
    expect(firstResult.signal).toBe("SIGKILL");

    const recovered = await execa(process.execPath, ["--import=tsx", workerPath], {
      env: { ...commonEnv, RECOVERY_MODE: "recover" }, timeout: 40_000,
    });
    expect(recovered.stderr).not.toContain("already exists in queue");
    const log = (await readFile(logPath, "utf8")).trim().split("\n");
    const count = (entry: string) => log.filter((line) => line === entry).length;
    expect(count("brand-discovery:start")).toBe(1);
    expect(count("brand-saturation:1:start")).toBe(1);
    expect(count("brand-saturation:2:start")).toBe(1);
    expect(count("market-catalog:start")).toBe(1);
    expect(count("brand-mapping:0:1:start")).toBe(2);
    expect(count("brand-mapping:0:1:done")).toBe(1);
    expect(count("brand-mapping:0:2:start")).toBe(1);
    expect(count("knowledge-sources:start")).toBe(1);
    expect(JSON.parse(await readFile(resultPath, "utf8"))).toMatchObject({
      status: "completed", planCount: 1, planId: expect.any(String),
    });
  }, 70_000);
});

async function waitForFile(filePath: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await readFile(filePath);
      return;
    } catch {
      if (Date.now() >= deadline) throw new Error(`等待文件超时：${filePath}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function cleanup(database: string, schemaName: string, taskId: string, root: string) {
  const db = createWorkbenchDb(database);
  try {
    await db.delete(sourceCollectionPlans).where(eq(sourceCollectionPlans.taskId, taskId));
    await db.delete(crawlPlanningRuns).where(eq(crawlPlanningRuns.taskId, taskId));
    await db.delete(captureTasks).where(eq(captureTasks.id, taskId));
    if (!/^crawl_planning_test_[a-f0-9]+$/.test(schemaName)) throw new Error("拒绝删除未校验测试 schema");
    await db.execute(sql.raw(`drop schema if exists "${schemaName}" cascade`));
  } finally {
    await db.$client.end();
    await rm(root, { recursive: true, force: true });
  }
}
