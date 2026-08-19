import { randomUUID } from "node:crypto";

import type { CaptureTaskMaterialization, CategoryInterviewRuntimeOutput } from "@domain-analysis/shared";
import {
  captureTaskDraftVersions, captureTasks, categoryInterviewDecisions, categoryInterviewMessages,
  categoryInterviewSessions, categoryInterviewUnresolvedItems, createWorkbenchDb,
  migrateWorkbenchDatabase, type WorkbenchDb,
} from "@domain-analysis/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCategoryInterviewModule,
  type CategoryInterviewMaterializationInput,
  type CategoryInterviewRuntime,
  type CategoryInterviewRuntimeEvent,
  type CategoryInterviewRuntimeInput,
} from "../src/categoryInterviewModule";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;
let db: WorkbenchDb | undefined;
let sessionId: string | undefined;

afterEach(async () => {
  if (db && sessionId) await removeSession(db, sessionId);
  await db?.$client.end();
  db = undefined;
  sessionId = undefined;
});

describeWithPostgres("采访输入理解与纠正", () => {
  it("完整保留回答、排除项与平台能力纠正，只写入 Markdown 草案", async () => {
    const harness = await createHarness("抓显示器");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    harness.runtime.push(decisionOutput());
    await run(harness, "抓显示器");
    let view = (await harness.interviews.get(sessionId))!;
    const proposed = view.decisions.find((item) => item.status === "proposed")!;
    const answer = "1，另外排除二手；淘宝只是后续同级平台，不代表已经有淘宝爬虫";
    harness.runtime.push({
      assistantText: "已记录仅在售、排除二手，以及淘宝当前没有爬虫的纠正。",
      decisionResolution: {
        decisionId: proposed.id, selection: "仅当前在售型号",
        rationale: "完整原文同时包含回答、排除项和平台能力纠正。",
      },
      draftMarkdown: [
        "# 显示器采访范围", "", "- 仅当前在售型号", "- 排除二手商品",
        "- 淘宝是后续同级候选平台，当前没有可执行的淘宝 crawler/Provider",
      ].join("\n"),
      unresolvedItems: [],
      resolvedUnresolvedKeys: ["catalog.lifecycle-scope"],
    });
    await run(harness, answer, view.session.revision);
    view = (await harness.interviews.get(sessionId))!;

    expect(harness.runtime.inputs.at(-1)?.trigger).toEqual({ type: "user_message", text: answer });
    expect(view.taskDrafts[0]?.markdown).toContain("排除二手商品");
    expect(view.taskDrafts[0]?.markdown).toContain("当前没有可执行的淘宝 crawler/Provider");
    expect(harness.runtime.materializationInputs).toHaveLength(0);
  });

  it("用户纠正问题前提时撤回 proposal，不伪造 confirmed Decision", async () => {
    const harness = await createHarness("抓显示器");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    harness.runtime.push(decisionOutput());
    await run(harness, "抓显示器");
    let view = (await harness.interviews.get(sessionId))!;
    const proposed = view.decisions.find((item) => item.status === "proposed")!;
    const correction = "这个问题不该让我选，应由系统按公开在售事实判断";
    harness.runtime.push({
      assistantText: "纠正成立；问题已撤回，并按公开事实形成草案。",
      decisionWithdrawal: { decisionId: proposed.id, rationale: "该问题应按可调查事实处理。" },
      draftMarkdown: "# 显示器采访范围\n\n型号范围按公开在售事实判断。",
      unresolvedItems: [],
      resolvedUnresolvedKeys: ["catalog.lifecycle-scope"],
    });
    await run(harness, correction, view.session.revision);
    view = (await harness.interviews.get(sessionId))!;

    expect(view.decisions.find((item) => item.id === proposed.id)?.status).toBe("superseded");
    expect(view.decisions.some((item) => item.status === "confirmed")).toBe(false);
    expect(view.taskDrafts[0]?.markdown).toContain("公开在售事实");
  });
});

describeWithPostgres("采访失败重试与平台问题", () => {
  it("失败保留最新用户原文，精确重试不重复保存消息", async () => {
    const harness = await createHarness("抓显示器");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    harness.runtime.failNext("Codex 临时失败");
    const failed = await run(harness, "抓显示器");
    let view = (await harness.interviews.get(sessionId))!;
    const original = view.messages.find((item) => item.role === "user")!;
    expect(failed).toContainEqual(expect.objectContaining({ type: "turn.failed" }));

    harness.runtime.push(draftOutput("# 显示器采访范围"));
    const retried = await collect(harness.interviews.runTurn({
      sessionId, trigger: "user_message", text: original.text, retryMessageId: original.id,
      expectedRevision: view.session.revision,
    }));
    view = (await harness.interviews.get(sessionId))!;

    expect(retried).toContainEqual(expect.objectContaining({ type: "turn.completed" }));
    expect(view.taskDrafts).toHaveLength(1);
    expect(view.messages.filter((item) => item.role === "user" && item.id === original.id)).toHaveLength(1);
  });

  it("拒绝把淘宝等平台覆盖伪装成负责人问题", async () => {
    const harness = await createHarness("抓显示器");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    harness.runtime.push(platformQuestionOutput());
    const events = await run(harness, "抓显示器");
    const view = await harness.interviews.get(sessionId);

    expect(events).toContainEqual(expect.objectContaining({
      type: "turn.failed", error: expect.stringContaining("来源平台、网站与渠道属于系统调查事实"),
    }));
    expect(view?.decisions).toHaveLength(0);
  });
});

class RecordingRuntime implements CategoryInterviewRuntime {
  readonly inputs: CategoryInterviewRuntimeInput[] = [];
  readonly materializationInputs: CategoryInterviewMaterializationInput[] = [];
  private readonly results: Array<CategoryInterviewRuntimeOutput | Error> = [];

  push(output: CategoryInterviewRuntimeOutput) { this.results.push(output); }
  failNext(message: string) { this.results.push(new Error(message)); }

  async *run(input: CategoryInterviewRuntimeInput): AsyncIterable<CategoryInterviewRuntimeEvent> {
    this.inputs.push(input);
    const result = this.results.shift();
    if (!result) throw new Error("测试没有准备采访输出");
    if (result instanceof Error) throw result;
    yield { type: "completed", output: result };
  }

  async materialize(input: CategoryInterviewMaterializationInput): Promise<CaptureTaskMaterialization> {
    this.materializationInputs.push(input);
    throw new Error("本组测试不应触发正式结构化");
  }
}

async function createHarness(initialRequest: string) {
  await migrateWorkbenchDatabase(databaseUrl!);
  const db = createWorkbenchDb(databaseUrl!);
  const runtime = new RecordingRuntime();
  const prefix = `input-${randomUUID()}`;
  let idSequence = 0;
  const interviews = createCategoryInterviewModule(db, runtime, {
    createId: (kind) => `${prefix}-${kind}-${++idSequence}`,
    now: () => new Date("2026-08-19T14:00:00.000Z"),
  });
  return { db, runtime, interviews, view: await interviews.start({ initialRequest }) };
}

async function run(
  harness: Awaited<ReturnType<typeof createHarness>>,
  text: string,
  revision = harness.view.session.revision,
) {
  return collect(harness.interviews.runTurn({
    sessionId: harness.view.session.id, trigger: "user_message", text, expectedRevision: revision,
  }));
}

function decisionOutput(): CategoryInterviewRuntimeOutput {
  return {
    assistantText: "请确认首期型号生命周期范围。",
    proposedDecision: {
      key: "catalog.lifecycle-scope", question: "首期是否纳入已停售型号？",
      options: [
        { label: "仅当前在售型号", description: "范围清楚，适合首版。", recommended: true },
        { label: "包含近三年停售型号", description: "覆盖历史型号，成本更高。", recommended: false },
      ],
      rationale: "该范围会直接改变来源和抓取量。",
    },
    unresolvedItems: [{ key: "catalog.lifecycle-scope", description: "等待确认型号生命周期范围。", owner: "user" }],
    resolvedUnresolvedKeys: [],
  };
}

function platformQuestionOutput(): CategoryInterviewRuntimeOutput {
  return {
    assistantText: "请选择是否纳入淘宝。",
    proposedDecision: {
      key: "platform.taobao", question: "是否纳入淘宝？",
      options: [
        { label: "纳入淘宝", description: "增加平台覆盖。", recommended: true },
        { label: "不纳入淘宝", description: "只保留其他来源。", recommended: false },
      ],
      rationale: "等待负责人决定。",
    },
    unresolvedItems: [{ key: "platform.taobao", description: "等待确认淘宝范围。", owner: "user" }],
    resolvedUnresolvedKeys: [],
  };
}

function draftOutput(draftMarkdown: string): CategoryInterviewRuntimeOutput {
  return { assistantText: "已形成采访范围草案。", draftMarkdown, unresolvedItems: [], resolvedUnresolvedKeys: [] };
}

async function collect<T>(events: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}

async function removeSession(currentDb: WorkbenchDb, currentSessionId: string) {
  const drafts = await currentDb.select({ taskId: captureTaskDraftVersions.taskId })
    .from(captureTaskDraftVersions).where(eq(captureTaskDraftVersions.sessionId, currentSessionId));
  await currentDb.delete(categoryInterviewDecisions).where(eq(categoryInterviewDecisions.sessionId, currentSessionId));
  await currentDb.delete(categoryInterviewUnresolvedItems).where(eq(categoryInterviewUnresolvedItems.sessionId, currentSessionId));
  await currentDb.delete(captureTaskDraftVersions).where(eq(captureTaskDraftVersions.sessionId, currentSessionId));
  await currentDb.delete(categoryInterviewMessages).where(eq(categoryInterviewMessages.sessionId, currentSessionId));
  await currentDb.delete(categoryInterviewSessions).where(eq(categoryInterviewSessions.id, currentSessionId));
  for (const taskId of new Set(drafts.map((item) => item.taskId).filter(Boolean))) {
    await currentDb.delete(captureTasks).where(eq(captureTasks.id, taskId!));
  }
}
