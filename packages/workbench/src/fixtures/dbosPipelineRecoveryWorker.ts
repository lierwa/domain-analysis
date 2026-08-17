import { appendFile, writeFile } from "node:fs/promises";

import { pipelineStages, type StartPipelineInput } from "@domain-analysis/shared";

import {
  openDbosPipelineModule,
  type PipelineStageHandlers,
} from "../dbosPipelineModule";

const [mode, runId, materialPath, executionLogPath] = process.argv.slice(2);
const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const schemaName = process.env.DBOS_TEST_SCHEMA;
if (!databaseUrl || !schemaName || !mode || !materialPath || !executionLogPath) {
  throw new Error("DBOS recovery worker 参数不完整");
}

const opened = await openDbosPipelineModule({
  systemDatabaseUrl: databaseUrl,
  systemDatabaseSchemaName: schemaName,
  workflowName: "productionAdapterRecoveryPipeline",
  stageHandlers: createHandlers(materialPath, executionLogPath),
  retryIntervalSeconds: 0.01,
  commandTimeoutSeconds: 20,
});

if (mode === "start") {
  const started = await opened.pipeline.start(startInput());
  const waiting = await waitFor(started.id, "waiting_user");
  process.send?.({ type: "waiting", runId: waiting.id });
  await new Promise(() => undefined);
} else if (mode === "recover" && runId) {
  const waiting = await waitFor(runId, "waiting_user");
  const intervention = waiting.interventions.find((item) => item.status === "open");
  if (!intervention) throw new Error("恢复后缺少待处理人工事项");
  await opened.pipeline.command(runId, {
    type: "resolve_intervention",
    interventionId: intervention.id,
    resolutionId: "recovery-review-decision",
  });
  const completed = await waitFor(runId, "succeeded");
  process.send?.({ type: "completed", view: completed });
  await opened.close();
} else {
  throw new Error(`未知 recovery worker 模式：${mode}`);
}

function createHandlers(materialPath: string, logPath: string): PipelineStageHandlers {
  const runStage = async (stage: (typeof pipelineStages)[number]) => {
    if (stage === "acquire") {
      // WHY：fixture 用独占创建模拟不可变资料提交；恢复后重复执行会立刻暴露为 EEXIST。
      await writeFile(materialPath, JSON.stringify({
        sourceObjectId: "official-product-page-1",
        contentHash: "c".repeat(64),
        capturedAt: "2026-08-14T12:00:00.000Z",
      }), { flag: "wx" });
    }
    await appendFile(logPath, `${stage}\n`);
    if (stage === "review") {
      return { intervention: { kind: "review" as const, prompt: "请确认恢复测试资料" } };
    }
    return {};
  };
  return {
    acquire: () => runStage("acquire"),
    project_material: () => runStage("project_material"),
    produce_candidates: () => runStage("produce_candidates"),
    review: () => runStage("review"),
    evaluate: () => runStage("evaluate"),
    build_package: () => runStage("build_package"),
  };
}

function startInput(): StartPipelineInput {
  const hash = "c".repeat(64);
  return {
    requestedBy: "recovery-test-user",
    input: {
      projectId: "recovery-project",
      projectRevision: 1,
      categoryDefinitionVersionId: "recovery-definition-1",
      categoryDefinitionHash: hash,
      confirmedScopeVersionId: "recovery-scope-1",
      confirmedScopeHash: hash,
      collectionBoardVersionId: "recovery-board-1",
      collectionBoardHash: hash,
    },
  };
}

async function waitFor(run: string, lifecycleStatus: "waiting_user" | "succeeded") {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const view = await opened.pipeline.get(run);
    if (view?.lifecycleStatus === lifecycleStatus) return view;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`恢复 worker 等待状态超时：${lifecycleStatus}`);
}
