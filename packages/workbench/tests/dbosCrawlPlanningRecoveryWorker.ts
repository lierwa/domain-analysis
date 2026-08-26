import { appendFile, access, writeFile } from "node:fs/promises";

import { captureTasks } from "@domain-analysis/db";
import type { CrawlPlanningRuntimeEvent } from "../src/crawlPlanningModule";
import {
  openDataCollectionWorkbench,
  type CrawlPlanningStageCommand,
  type CrawlPlanningStageRuntime,
} from "../src";

import {
  knowledge,
  landscape,
  marketCatalog,
  plannedMapping,
  saturation,
  task,
  unresolvedMapping,
} from "./codexCrawlPlanningRuntimeTestSupport";

const databaseUrl = required("POSTGRES_DATABASE_URL");
const schemaName = required("DBOS_SCHEMA_NAME");
const taskId = required("PLANNING_TASK_ID");
const mode = required("RECOVERY_MODE");
const markerPath = required("RECOVERY_MARKER_PATH");
const logPath = required("RECOVERY_LOG_PATH");
const resultPath = required("RECOVERY_RESULT_PATH");

const stageRuntime = createStageRuntime();
const workbench = await openDataCollectionWorkbench({
  databaseUrl,
  crawlPlanningStageRuntime: stageRuntime,
  crawlPlanningDurability: {
    brandBatchSize: 1,
    applicationName: `domain-analysis-crawl-planning-test-${taskId}`,
    systemDatabaseSchemaName: schemaName,
    streamPollIntervalMs: 20,
  },
});
if (!workbench.crawlPlanning) throw new Error("测试没有装配 Crawl Planning");

if (mode === "start") {
  const value = task();
  value.id = taskId;
  value.name = "DBOS 恢复测试";
  await workbench.captureTasks.get(taskId).then(async (existing) => {
    if (existing) return;
    const db = (await import("@domain-analysis/db")).createWorkbenchDb(databaseUrl);
    try {
      await db.insert(captureTasks).values({
        id: value.id, name: value.name, originalRequest: value.content.originalRequest,
        marketScope: value.content.marketScope, status: value.status, revision: value.revision,
        content: value.content, createdAt: value.createdAt, updatedAt: value.updatedAt,
        confirmedAt: value.confirmedAt,
      });
    } finally {
      await db.$client.end();
    }
  });
  for await (const event of workbench.crawlPlanning.run({
    taskId, expectedTaskRevision: 1,
  })) {
    if (event.type === "run.failed") throw new Error(event.error);
  }
} else {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const view = await workbench.crawlPlanning.get(taskId);
    const run = view?.runs[0];
    if (run?.status === "completed") {
      await writeFile(resultPath, JSON.stringify({
        status: run.status, planCount: view!.plans.length, planId: run.planId,
      }));
      break;
    }
    if (run?.status === "failed") throw new Error(run.error);
    if (Date.now() >= deadline) throw new Error("恢复后的 Crawl Planning 未在时限内完成");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

await workbench.close();

function createStageRuntime(): CrawlPlanningStageRuntime {
  const run = (async function* (command: CrawlPlanningStageCommand) {
    await appendFile(logPath, `${command.key}:start\n`);
    if (command.key === "brand-mapping:0:1" && !(await exists(markerPath))) {
      await writeFile(markerPath, "in-flight");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
    yield { type: "text_delta", delta: `\n${command.label}完成` } satisfies CrawlPlanningRuntimeEvent;
    await appendFile(logPath, `${command.key}:done\n`);
    if (command.kind === "brand_discovery") return { interrupted: false as const, value: landscape() };
    if (command.kind === "brand_saturation") {
      const index = Number(command.key.split(":").at(-1));
      return { interrupted: false as const, value: saturation(index) };
    }
    if (command.kind === "market_catalog") return { interrupted: false as const, value: marketCatalog() };
    if (command.kind === "brand_mapping") {
      const name = command.brands[0]!.name;
      return { interrupted: false as const,
        value: name === "品牌一" ? plannedMapping(name) : unresolvedMapping(name) };
    }
    return { interrupted: false as const, value: knowledge() };
  }) as CrawlPlanningStageRuntime["run"];
  return { run };
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function required(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`缺少测试环境变量：${key}`);
  return value;
}
