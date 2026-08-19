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
  type CategoryInterviewModule,
  type CategoryInterviewRuntime,
  type CategoryInterviewRuntimeEvent,
  type CategoryInterviewRuntimeInput,
} from "../src/categoryInterviewModule";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;
type RuntimeTaskCandidate = NonNullable<CategoryInterviewRuntimeOutput["taskCandidate"]>;
type Harness = Awaited<ReturnType<typeof createHarness>>;
let db: WorkbenchDb | undefined;
let sessionId: string | undefined;

afterEach(async () => {
  if (db && sessionId) await removeSession(db, sessionId);
  await db?.$client.end();
  db = undefined;
  sessionId = undefined;
});

describeWithPostgres("抓取任务草稿生成与确认", () => {
  it("完整混合原文进入 Agent 并形成草稿，确认前没有 Capture Task", async () => {
    const harness = await createHarness("抓冰箱");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    harness.runtime.push(decisionOutput());
    await run(harness, "抓冰箱");
    let view = (await harness.interviews.get(sessionId))!;
    const proposed = view.decisions.find((item) => item.status === "proposed")!;
    const candidate = taskContent("refrigerator", "冰箱", proposed.id);
    candidate.excludedContent = ["二手商品"];
    const answer = "1，另外不包含二手商品";
    harness.runtime.push({
      assistantText: "已采用当前在售型号，并排除二手商品。",
      decisionResolution: {
        decisionId: proposed.id, selection: "仅当前在售型号",
        rationale: "序号回答与补充排除条件已一并理解。",
      },
      taskCandidate: candidate,
      unresolvedItems: [],
      resolvedUnresolvedKeys: ["catalog.lifecycle-scope"],
    });
    await run(harness, answer, view.session.revision);
    view = (await harness.interviews.get(sessionId))!;

    expect(harness.runtime.inputs.at(-1)?.trigger).toEqual({ type: "user_message", text: answer });
    expect(view.decisions).toContainEqual(expect.objectContaining({ status: "confirmed" }));
    expect(view.taskDrafts[0]?.content.excludedContent).toContain("二手商品");
    expect(await taskCount(db!, sessionId)).toBe(0);
  });

  it("只有显式确认最新草稿才创建 Capture Task，并应用京东默认范围", async () => {
    const harness = await createHarness("抓冰箱");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    const view = await createDraft(harness, taskContent("refrigerator", "冰箱"));
    expect(await taskCount(db!, sessionId)).toBe(0);

    const draft = view.taskDrafts.find((item) => item.status === "draft")!;
    const confirmed = await harness.interviews.confirmTaskDraft({
      sessionId, draftId: draft.id, expectedRevision: view.session.revision,
    });

    expect(await taskCount(db!, sessionId)).toBe(1);
    expect(confirmed.task).toMatchObject({
      revision: 1,
      content: { jd: { applicable: true, disposition: "included" } },
    });
    expect(confirmed.task.content.jd.scope).toContain("review_samples");
  });
});

describeWithPostgres("抓取任务草稿历史与最新版本", () => {
  it("修订产生新草稿但不覆盖历史，确认后更新同一 Capture Task 的版本", async () => {
    const harness = await createHarness("抓冰箱");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    let view = await createDraft(harness, taskContent("refrigerator", "冰箱"));
    const firstDraft = view.taskDrafts.find((item) => item.status === "draft")!;
    const first = await harness.interviews.confirmTaskDraft({
      sessionId, draftId: firstDraft.id, expectedRevision: view.session.revision,
    });
    const revision = taskContent("refrigerator", "冰箱");
    revision.sourceCandidates.push(brandSource());
    harness.runtime.push(taskOutput(revision));
    await run(harness, "补充品牌官网", first.interview.session.revision);
    view = (await harness.interviews.get(sessionId))!;

    expect(view.taskDrafts.find((item) => item.id === firstDraft.id)).toMatchObject({ status: "confirmed" });
    expect(view.taskDrafts.find((item) => item.id === firstDraft.id)?.content.sourceCandidates).toHaveLength(1);
    const latest = view.taskDrafts.find((item) => item.status === "draft")!;
    expect(latest.content.sourceCandidates).toHaveLength(2);
    const revised = await harness.interviews.confirmTaskDraft({
      sessionId, draftId: latest.id, expectedRevision: view.session.revision,
    });
    expect(revised.task).toMatchObject({ id: first.task.id, revision: 2 });
    expect(revised.interview.taskDrafts.filter((item) => item.status === "confirmed")).toHaveLength(2);
  });

  it("非最新草稿不能确认，也不会提前创建 Capture Task", async () => {
    const harness = await createHarness("抓显示器");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    let view = await createDraft(harness, taskContent("monitor", "显示器"));
    const oldDraft = view.taskDrafts.find((item) => item.status === "draft")!;
    const revision = taskContent("monitor", "显示器");
    revision.excludedContent = ["二手商品"];
    harness.runtime.push(taskOutput(revision));
    await run(harness, "排除二手商品", view.session.revision);
    view = (await harness.interviews.get(sessionId))!;

    await expect(harness.interviews.confirmTaskDraft({
      sessionId, draftId: oldDraft.id, expectedRevision: view.session.revision,
    })).rejects.toThrow("只有最新待确认草稿可以生成抓取任务");
    expect(await taskCount(db!, sessionId)).toBe(0);
  });
});

class RecordingRuntime implements CategoryInterviewRuntime {
  readonly inputs: CategoryInterviewRuntimeInput[] = [];
  private readonly outputs: CategoryInterviewRuntimeOutput[] = [];
  push(output: CategoryInterviewRuntimeOutput) { this.outputs.push(output); }
  async *run(input: CategoryInterviewRuntimeInput): AsyncIterable<CategoryInterviewRuntimeEvent> {
    this.inputs.push(input);
    const output = this.outputs.shift();
    if (!output) throw new Error("测试没有准备采访输出");
    yield { type: "completed", output };
  }
}

async function createHarness(initialRequest: string) {
  await migrateWorkbenchDatabase(databaseUrl!);
  const db = createWorkbenchDb(databaseUrl!);
  const runtime = new RecordingRuntime();
  const prefix = `interview-${randomUUID()}`;
  let idSequence = 0;
  const interviews = createCategoryInterviewModule(db, runtime, {
    createId: (kind) => `${prefix}-${kind}-${++idSequence}`,
    now: () => new Date("2026-08-19T14:00:00.000Z"),
  });
  return { db, runtime, interviews, view: await interviews.start({ initialRequest }) };
}

async function run(harness: Harness, text: string, revision = harness.view.session.revision) {
  return collect(harness.interviews.runTurn({
    sessionId: harness.view.session.id, trigger: "user_message", text, expectedRevision: revision,
  }));
}

async function createDraft(harness: Harness, content: RuntimeTaskCandidate) {
  harness.runtime.push(taskOutput(content));
  await run(harness, content.originalRequest);
  return (await harness.interviews.get(harness.view.session.id))!;
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

function taskOutput(taskCandidate: RuntimeTaskCandidate): CategoryInterviewRuntimeOutput {
  return { assistantText: "已更新抓取任务草稿。", taskCandidate, unresolvedItems: [], resolvedUnresolvedKeys: [] };
}

function taskContent(code: string, label: string, decisionId?: string): RuntimeTaskCandidate {
  return {
    originalRequest: `抓${label}`,
    category: { code, label },
    marketScope: "中国大陆当前在售新机",
    generalTopics: ["品牌、型号、商品详情和参数"],
    categoryTopics: ["品类关键参数"],
    jd: { applicable: true, disposition: "pending", scope: [], rationale: "由平台默认策略补全。" },
    sourceCandidates: [{
      id: `jd-${code}`, name: `京东${label}频道`, publisher: "京东",
      entryUrl: "https://www.jd.com/", sourceKind: "retailer",
      expectedContents: ["在售商品与参数"], observedFormats: ["网页"],
      accessState: "public", observedAt: "2026-08-19",
    }],
    excludedContent: [],
    decisionIds: decisionId ? [decisionId] : [],
  };
}

function brandSource(): RuntimeTaskCandidate["sourceCandidates"][number] {
  return {
    id: "brand-site", name: "品牌官网", publisher: "品牌方",
    entryUrl: "https://example.com/products", sourceKind: "brand_official",
    expectedContents: ["官方型号与规格"], observedFormats: ["网页"],
    accessState: "public", observedAt: "2026-08-19",
  };
}

async function taskCount(db: WorkbenchDb, currentSessionId: string) {
  return (await db.select({ id: captureTasks.id }).from(captureTasks)
    .innerJoin(captureTaskDraftVersions, eq(captureTaskDraftVersions.taskId, captureTasks.id))
    .where(eq(captureTaskDraftVersions.sessionId, currentSessionId))).length;
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
