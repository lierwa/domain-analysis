import { pipelineStages, type StartPipelineInput } from "@domain-analysis/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openDbosPipelineModule,
  type OpenedDbosPipelineModule,
  type PipelineStageHandlers,
} from "./dbosPipelineModule";

const databaseUrl = process.env.DBOS_SYSTEM_DATABASE_URL;
const describeWithDbos = databaseUrl ? describe.sequential : describe.skip;
const calls: Array<{ revision: number; stage: string }> = [];
let retryShouldFail = true;
let opened: OpenedDbosPipelineModule;

describeWithDbos("DbosPipelineModule integration", () => {
  beforeAll(async () => {
    opened = await openDbosPipelineModule({
      systemDatabaseUrl: databaseUrl!,
      systemDatabaseSchemaName: `domain_analysis_test_${process.pid}_${Date.now()}`,
      workflowName: `testPipeline${process.pid}`,
      stageHandlers: createStageHandlers(),
      maxStepAttempts: 3,
      retryIntervalSeconds: 0.01,
      commandTimeoutSeconds: 15,
    });
  }, 30_000);

  afterAll(async () => {
    await opened?.close();
  });

  it("uses durable messages for pause, resume and human intervention", async () => {
    const started = await opened.pipeline.start(startInput(1));
    const paused = await opened.pipeline.command(started.id, {
      type: "pause",
      reason: "检查采集范围",
    });
    expect(paused.lifecycleStatus).toBe("paused");

    const resumed = await opened.pipeline.command(started.id, { type: "resume" });
    expect(resumed.lifecycleStatus).not.toBe("paused");
    const waiting = await waitFor(started.id, (view) => view.lifecycleStatus === "waiting_user");
    const intervention = waiting.interventions.find((item) => item.status === "open")!;

    await opened.pipeline.command(started.id, {
      type: "resolve_intervention",
      interventionId: intervention.id,
      resolutionId: "review-decision-1",
    });
    const succeeded = await waitFor(started.id, (view) => view.lifecycleStatus === "succeeded");
    expect(succeeded.stages.every((stage) => stage.status === "succeeded")).toBe(true);

    const duplicate = await opened.pipeline.start(startInput(1));
    expect(duplicate.id).toBe(started.id);
    expect(calls.filter((call) => call.revision === 1 && call.stage === "acquire")).toHaveLength(1);
  }, 30_000);

  it("projects DBOS cancellation without copying execution history", async () => {
    const started = await opened.pipeline.start(startInput(2));
    const cancelled = await opened.pipeline.command(started.id, {
      type: "cancel",
      reason: "用户停止",
    });

    expect(cancelled.lifecycleStatus).toBe("cancelled");
    expect((await opened.pipeline.get(started.id))?.lifecycleStatus).toBe("cancelled");
  }, 30_000);

  it("resumes a failed DBOS step for an explicit stage retry", async () => {
    const started = await opened.pipeline.start(startInput(3));
    const failed = await waitFor(started.id, (view) => view.lifecycleStatus === "failed");
    const failedStage = failed.stages.find((stage) => stage.status === "failed")!;
    expect(failedStage.attemptCount).toBe(3);

    retryShouldFail = false;
    const retried = await opened.pipeline.command(started.id, {
      type: "retry_stage",
      stageExecutionId: failedStage.id,
    });
    const succeeded = await waitFor(retried.id, (view) => view.lifecycleStatus === "succeeded");

    expect(succeeded.lifecycleStatus).toBe("succeeded");
    expect(succeeded.forkedFromRunId).toBe(started.id);
    expect(calls.filter((call) => call.revision === 3 && call.stage === "produce_candidates"))
      .toHaveLength(4);
  }, 30_000);
});

function createStageHandlers(): PipelineStageHandlers {
  return Object.fromEntries(pipelineStages.map((stage) => [stage, async (context) => {
    calls.push({ revision: context.input.projectRevision, stage });
    if (stage === "acquire") await new Promise((resolve) => setTimeout(resolve, 150));
    if (context.input.projectRevision === 3 && stage === "produce_candidates" && retryShouldFail) {
      throw new Error("模拟阶段失败");
    }
    if (context.input.projectRevision === 1 && stage === "review") {
      return { intervention: { kind: "review", prompt: "请确认候选知识" } };
    }
    return {};
  }])) as PipelineStageHandlers;
}

function startInput(projectRevision: number): StartPipelineInput {
  const hash = String(projectRevision).repeat(64);
  return {
    requestedBy: "user-1",
    input: {
      projectId: "project-1",
      projectRevision,
      categoryDefinitionVersionId: `definition-${projectRevision}`,
      categoryDefinitionHash: hash,
      confirmedScopeVersionId: `scope-${projectRevision}`,
      confirmedScopeHash: hash,
      collectionBoardVersionId: `board-${projectRevision}`,
      collectionBoardHash: hash,
    },
  };
}

async function waitFor(
  runId: string,
  predicate: (view: NonNullable<Awaited<ReturnType<typeof opened.pipeline.get>>>) => boolean,
) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const view = await opened.pipeline.get(runId);
    if (view && predicate(view)) return view;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待测试流水线状态超时：${runId}`);
}
