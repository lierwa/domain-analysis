import { randomUUID } from "node:crypto";

import type { CategoryInterviewRuntimeOutput } from "@domain-analysis/shared";
import {
  captureTaskDraftVersions,
  captureTasks,
  categoryInterviewDecisions,
  categoryInterviewMessages,
  categoryInterviewSessions,
  categoryInterviewUnresolvedItems,
  createWorkbenchDb,
  migrateWorkbenchDatabase,
  type WorkbenchDb,
} from "@domain-analysis/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCategoryInterviewModule,
  type CategoryInterviewRuntime,
  type CategoryInterviewRuntimeEvent,
  type CategoryInterviewRuntimeInput,
} from "../src/categoryInterviewModule";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;
type RuntimeTaskCandidate = NonNullable<CategoryInterviewRuntimeOutput["taskCandidate"]>;
let db: WorkbenchDb | undefined;
let sessionId: string | undefined;

afterEach(async () => {
  if (db && sessionId) await removeSession(db, sessionId);
  await db?.$client.end();
  db = undefined;
  sessionId = undefined;
});

describeWithPostgres("采访输入理解与纠正", () => {
  it("完整理解回答、排除项与淘宝能力纠正，淘宝只作为未来候选而不伪造爬虫", async () => {
    const harness = await createHarness("抓显示器");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    harness.runtime.push(decisionOutput());
    await run(harness, "抓显示器");
    let view = (await harness.interviews.get(sessionId))!;
    const proposed = view.decisions.find((item) => item.status === "proposed")!;
    const answer = "1，另外排除二手；淘宝只是后续同级平台，不代表已经有淘宝爬虫";
    const candidate = taskContent(proposed.id);
    candidate.sourceCandidates.push({
      id: "taobao-future", name: "淘宝显示器候选入口", publisher: "淘宝",
      entryUrl: "https://www.taobao.com/", sourceKind: "retailer",
      expectedContents: ["后续多平台商品覆盖候选"], observedFormats: [],
      accessState: "unknown", observedAt: "2026-08-19",
    });
    harness.runtime.push({
      assistantText: "已记录仅在售、排除二手，以及淘宝当前没有爬虫的纠正。",
      decisionResolution: {
        decisionId: proposed.id, selection: "仅当前在售型号",
        rationale: "完整原文同时包含回答、排除项和平台能力纠正。",
      },
      taskCandidate: candidate,
      unresolvedItems: [],
      resolvedUnresolvedKeys: ["catalog.lifecycle-scope"],
    });
    await run(harness, answer, view.session.revision);
    view = (await harness.interviews.get(sessionId))!;

    expect(harness.runtime.inputs.at(-1)?.trigger).toEqual({ type: "user_message", text: answer });
    expect(view.taskDrafts[0]?.content.jd.disposition).toBe("included");
    expect(view.taskDrafts[0]?.content.sourceCandidates).toContainEqual(expect.objectContaining({
      id: "taobao-future", accessState: "unknown",
    }));
    expect(view.taskDrafts[0]?.content.excludedContent.join(" ")).not.toContain("淘宝爬虫");
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
      assistantText: "纠正成立；问题已撤回，并按公开事实形成草稿。",
      decisionWithdrawal: {
        decisionId: proposed.id, rationale: "该问题应按可调查事实处理。",
      },
      taskCandidate: taskContent(proposed.id),
      unresolvedItems: [],
      resolvedUnresolvedKeys: ["catalog.lifecycle-scope"],
    });
    await run(harness, correction, view.session.revision);
    view = (await harness.interviews.get(sessionId))!;

    expect(harness.runtime.inputs.at(-1)?.trigger.text).toBe(correction);
    expect(view.decisions.find((item) => item.id === proposed.id)?.status).toBe("superseded");
    expect(view.decisions.some((item) => item.status === "confirmed")).toBe(false);
    expect(view.taskDrafts[0]?.content.decisionIds).toEqual([]);
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
    expect(view.session.turnState).toBe("failed");

    harness.runtime.push(taskOutput(taskContent()));
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
      type: "turn.failed",
      error: expect.stringContaining("来源平台、网站与渠道属于系统调查事实"),
    }));
    expect(view?.decisions).toHaveLength(0);
  });
});

class RecordingRuntime implements CategoryInterviewRuntime {
  readonly inputs: CategoryInterviewRuntimeInput[] = [];
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

async function run(harness: Awaited<ReturnType<typeof createHarness>>, text: string, revision = harness.view.session.revision) {
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
      selection: "仅当前在售型号", rationale: "该范围会直接改变来源和抓取量。",
    },
    unresolvedItems: [{
      key: "catalog.lifecycle-scope", description: "等待确认型号生命周期范围。", owner: "user",
    }],
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
      selection: "纳入淘宝", rationale: "等待负责人决定。",
    },
    unresolvedItems: [{ key: "platform.taobao", description: "等待确认淘宝范围。", owner: "user" }],
    resolvedUnresolvedKeys: [],
  };
}

function taskOutput(taskCandidate: RuntimeTaskCandidate): CategoryInterviewRuntimeOutput {
  return { assistantText: "已形成抓取任务草稿。", taskCandidate, unresolvedItems: [], resolvedUnresolvedKeys: [] };
}

function taskContent(decisionId?: string): RuntimeTaskCandidate {
  return {
    originalRequest: "抓显示器；排除二手；淘宝仅为后续平台，当前没有淘宝爬虫",
    category: { code: "monitor", label: "显示器" },
    marketScope: "中国大陆当前在售新机",
    generalTopics: ["品牌、型号、商品详情和参数"],
    categoryTopics: ["尺寸、面板、分辨率和刷新率"],
    jd: { applicable: true, disposition: "pending", scope: [], rationale: "由平台默认策略补全。" },
    sourceCandidates: [{
      id: "jd-monitor", name: "京东显示器频道", publisher: "京东",
      entryUrl: "https://www.jd.com/", sourceKind: "retailer",
      expectedContents: ["在售商品与参数"], observedFormats: ["网页"],
      accessState: "public", observedAt: "2026-08-19",
    }],
    excludedContent: ["二手、翻新及非全新商品"],
    decisionIds: decisionId ? [decisionId] : [],
  };
}

async function collect<T>(events: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}

async function removeSession(db: WorkbenchDb, currentSessionId: string) {
  const drafts = await db.select({ taskId: captureTaskDraftVersions.taskId })
    .from(captureTaskDraftVersions).where(eq(captureTaskDraftVersions.sessionId, currentSessionId));
  await db.delete(categoryInterviewDecisions).where(eq(categoryInterviewDecisions.sessionId, currentSessionId));
  await db.delete(categoryInterviewUnresolvedItems).where(eq(categoryInterviewUnresolvedItems.sessionId, currentSessionId));
  await db.delete(captureTaskDraftVersions).where(eq(captureTaskDraftVersions.sessionId, currentSessionId));
  await db.delete(categoryInterviewMessages).where(eq(categoryInterviewMessages.sessionId, currentSessionId));
  await db.delete(categoryInterviewSessions).where(eq(categoryInterviewSessions.id, currentSessionId));
  for (const taskId of new Set(drafts.map((item) => item.taskId).filter(Boolean))) {
    await db.delete(captureTasks).where(eq(captureTasks.id, taskId!));
  }
}
