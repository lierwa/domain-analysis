import { randomUUID } from "node:crypto";

import type {
  CaptureTaskContent,
  CategoryInterviewRuntimeOutput,
} from "@domain-analysis/shared";
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
} from "../src/categoryInterviewModule";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("抓取任务确认与修订", () => {
  let db: WorkbenchDb | undefined;
  let sessionId: string | undefined;

  afterEach(async () => {
    if (db && sessionId) await removeSession(db, sessionId);
    await db?.$client.end();
    db = undefined;
    sessionId = undefined;
  });

  it("将 question 归一化为待回答决定，确认建议项，并在确认后生成同一任务的新版本", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    const runtime = new QueueRuntime();
    const prefix = `revision-${randomUUID()}`;
    let idSequence = 0;
    const interviews = createCategoryInterviewModule(db, runtime, {
      createId: (kind) => `${prefix}-${kind}-${++idSequence}`,
    });
    let view = await interviews.start({ initialRequest: "抓冰箱" });
    sessionId = view.session.id;

    runtime.push(decisionOutput());
    await collect(interviews.runTurn({
      sessionId,
      trigger: "user_message",
      text: "抓冰箱",
      expectedRevision: view.session.revision,
    }));
    view = (await interviews.get(sessionId))!;
    const proposed = view.decisions.find((decision) => decision.status === "proposed")!;
    view = await interviews.confirmDecision({
      sessionId,
      decisionId: proposed.id,
      selection: "仅商品资料",
      expectedRevision: view.session.revision,
    });
    const confirmed = view.decisions.find((decision) => decision.status === "confirmed")!;
    expect(confirmed).toMatchObject({
      selection: "仅商品资料",
      rationale: "保留分类、店铺和商品详情，不抓评论。",
    });

    runtime.push(taskOutput(taskContent(confirmed.id, ["https://example.com/jd-fridge"])));
    await collect(interviews.runTurn({
      sessionId,
      trigger: "decision_confirmed",
      decisionId: confirmed.id,
      expectedRevision: view.session.revision,
    }));
    view = (await interviews.get(sessionId))!;
    const firstDraft = view.taskDrafts.find((draft) => draft.status === "draft")!;
    const first = await interviews.confirmTaskDraft({
      sessionId,
      draftId: firstDraft.id,
      expectedRevision: view.session.revision,
    });
    expect(first.task.revision).toBe(firstDraft.version);

    runtime.push(taskOutput(taskContent(confirmed.id, [
      "https://example.com/jd-fridge",
      "https://example.com/haier-fridge",
    ])));
    await collect(interviews.runTurn({
      sessionId,
      trigger: "user_message",
      text: "品牌官网太少，补充海尔官网",
      expectedRevision: first.interview.session.revision,
    }));
    view = (await interviews.get(sessionId))!;
    const revisedDraft = view.taskDrafts.find((draft) => draft.status === "draft")!;
    const revised = await interviews.confirmTaskDraft({
      sessionId,
      draftId: revisedDraft.id,
      expectedRevision: view.session.revision,
    });

    expect(revised.task.id).toBe(first.task.id);
    expect(revised.task.revision).toBe(revisedDraft.version);
    expect(revised.task.content.sourceCandidates).toHaveLength(2);
    expect(revised.interview.taskDrafts.filter((draft) => draft.status === "confirmed")).toHaveLength(2);
    await expect(interviews.getByTaskId(first.task.id)).resolves.toMatchObject({
      session: { id: sessionId, phase: "confirmed" },
    });
  });

  it("把 Composer 中不同于建议项的回答保存为用户消息和 confirmed Decision", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    const runtime = new QueueRuntime();
    const prefix = `custom-answer-${randomUUID()}`;
    let idSequence = 0;
    const interviews = createCategoryInterviewModule(db, runtime, {
      createId: (kind) => `${prefix}-${kind}-${++idSequence}`,
    });
    let view = await interviews.start({ initialRequest: "抓冰箱" });
    sessionId = view.session.id;

    runtime.push(decisionOutput());
    await collect(interviews.runTurn({
      sessionId,
      trigger: "user_message",
      text: "抓冰箱",
      expectedRevision: view.session.revision,
    }));
    view = (await interviews.get(sessionId))!;
    const proposed = view.decisions.find((decision) => decision.status === "proposed")!;
    const customAnswer = "纳入京东商品详情和说明书，但不抓评价";
    view = await interviews.confirmDecision({
      sessionId,
      decisionId: proposed.id,
      selection: customAnswer,
      expectedRevision: view.session.revision,
    });

    const userMessage = view.messages.at(-1)!;
    const confirmed = view.decisions.find((decision) => decision.status === "confirmed")!;
    expect(userMessage).toMatchObject({ role: "user", text: customAnswer });
    expect(confirmed).toMatchObject({
      selection: customAnswer,
      rationale: customAnswer,
      sourceMessageId: userMessage.id,
      supersedesDecisionId: proposed.id,
    });
  });

  it("将已展示的网页搜索与说明按顺序持久化，重新读取会话仍完整保留", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    const prefix = `timeline-${randomUUID()}`;
    let idSequence = 0;
    const interviews = createCategoryInterviewModule(db, new TimelineRuntime(), {
      createId: (kind) => `${prefix}-${kind}-${++idSequence}`,
    });
    const started = await interviews.start({ initialRequest: "抓电视机" });
    sessionId = started.session.id;

    await collect(interviews.runTurn({
      sessionId,
      trigger: "user_message",
      text: "抓电视机",
      expectedRevision: started.session.revision,
    }));

    const reloaded = await interviews.get(sessionId);
    expect(reloaded?.messages.at(-1)).toMatchObject({
      role: "assistant",
      timelineParts: [
        { type: "activity", activity: {
          id: "search-1",
          kind: "web_search",
          status: "completed",
          urls: ["https://www.jd.com/", "https://www.tcl.com/cn/zh/tvs"],
        } },
        { type: "text", text: "正在核对电视机来源。" },
        { type: "text", text: "请选择京东抓取范围。" },
      ],
    });
  });

  it("拒绝把待确认负责人问题和任务草稿写进同一轮", async () => {
    await migrateWorkbenchDatabase(databaseUrl!);
    db = createWorkbenchDb(databaseUrl!);
    const runtime = new QueueRuntime();
    const prefix = `invalid-draft-${randomUUID()}`;
    let idSequence = 0;
    const interviews = createCategoryInterviewModule(db, runtime, {
      createId: (kind) => `${prefix}-${kind}-${++idSequence}`,
    });
    const started = await interviews.start({ initialRequest: "抓电视机" });
    sessionId = started.session.id;
    runtime.push({
      ...decisionOutput(),
      proposedDecision: {
        key: "television.initial-data-scope",
        question: "首期电视机数据应采集到什么深度？",
        options: decisionOutput().question!.options,
        selection: "完整京东范围",
        rationale: "需要负责人决定。",
      },
      unresolvedItems: [{
        key: "television.initial-data-scope",
        description: "等待负责人确认首期范围。",
        owner: "user",
      }],
      taskCandidate: taskContent("television.initial-data-scope", ["https://example.com/tv"]),
    });

    const events = await collect(interviews.runTurn({
      sessionId,
      trigger: "user_message",
      text: "抓电视机",
      expectedRevision: started.session.revision,
    }));
    const reloaded = await interviews.get(sessionId);

    expect(events).toContainEqual(expect.objectContaining({ type: "turn.failed" }));
    expect(reloaded?.session).toMatchObject({ phase: "active", turnState: "failed" });
    expect(reloaded?.taskDrafts).toHaveLength(0);
    expect(reloaded?.decisions).toHaveLength(0);
    expect(reloaded?.unresolvedItems).toHaveLength(0);
  });
});

class QueueRuntime implements CategoryInterviewRuntime {
  private readonly outputs: CategoryInterviewRuntimeOutput[] = [];

  push(output: CategoryInterviewRuntimeOutput) {
    this.outputs.push(output);
  }

  async *run(): AsyncIterable<CategoryInterviewRuntimeEvent> {
    const output = this.outputs.shift();
    if (!output) throw new Error("测试没有准备采访输出");
    yield { type: "completed", output };
  }
}

class TimelineRuntime implements CategoryInterviewRuntime {
  async *run(): AsyncIterable<CategoryInterviewRuntimeEvent> {
    yield { type: "activity", activity: {
      id: "search-1", kind: "web_search", label: "搜索网页",
      urls: ["https://www.jd.com/"], status: "running",
    } };
    yield { type: "text_delta", delta: "正在核对电视机来源。" };
    yield { type: "activity", activity: {
      id: "search-1", kind: "web_search", label: "搜索网页",
      urls: ["https://www.tcl.com/cn/zh/tvs"], status: "completed",
    } };
    yield { type: "completed", output: decisionOutput() };
  }
}

function decisionOutput(): CategoryInterviewRuntimeOutput {
  const options = [
    { label: "完整京东范围", description: "包含评价样本和评分指标。", recommended: true },
    { label: "仅商品资料", description: "保留分类、店铺和商品详情，不抓评论。", recommended: false },
    { label: "不纳入京东", description: "只调查官网与标准来源。", recommended: false },
  ];
  return {
    assistantText: "请选择京东抓取范围。",
    question: { key: "jd.scope", text: "京东抓到什么范围？", options, rationale: "需要负责人决定。" },
    unresolvedItems: [],
    resolvedUnresolvedKeys: [],
  };
}

function taskOutput(taskCandidate: CaptureTaskContent): CategoryInterviewRuntimeOutput {
  return {
    assistantText: "已更新抓取任务草稿。",
    taskCandidate,
    unresolvedItems: [],
    resolvedUnresolvedKeys: [],
  };
}

function taskContent(decisionId: string, urls: string[]): CaptureTaskContent {
  return {
    originalRequest: "抓冰箱",
    category: { code: "refrigerator", label: "冰箱" },
    marketScope: "中国大陆普通消费者可以买到的家用冰箱",
    generalTopics: ["品牌、型号、商品详情和原始参数"],
    categoryTopics: ["能效、容量、制冷方式和核心部件"],
    jd: { applicable: true, disposition: "included", scope: ["product_details"], rationale: "已确认仅商品资料。" },
    sourceCandidates: urls.map((entryUrl, index) => ({
      id: `source-${index + 1}`,
      name: index === 0 ? "京东冰箱频道" : "海尔冰箱官网",
      publisher: index === 0 ? "京东" : "海尔",
      entryUrl,
      sourceKind: index === 0 ? "retailer" : "brand_official",
      expectedContents: ["冰箱商品资料"],
      observedFormats: ["HTML"],
      accessState: "public",
      observedAt: "2026-08-18T10:00:00+08:00",
    })),
    excludedContent: ["评论与评分"],
    unresolvedItems: [],
    decisionIds: [decisionId],
  };
}

async function collect<T>(events: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}

async function removeSession(db: WorkbenchDb, currentSessionId: string) {
  const drafts = await db.select({ taskId: captureTaskDraftVersions.taskId })
    .from(captureTaskDraftVersions)
    .where(eq(captureTaskDraftVersions.sessionId, currentSessionId));
  await db.delete(categoryInterviewDecisions).where(eq(categoryInterviewDecisions.sessionId, currentSessionId));
  await db.delete(categoryInterviewUnresolvedItems).where(eq(categoryInterviewUnresolvedItems.sessionId, currentSessionId));
  await db.delete(captureTaskDraftVersions).where(eq(captureTaskDraftVersions.sessionId, currentSessionId));
  await db.delete(categoryInterviewMessages).where(eq(categoryInterviewMessages.sessionId, currentSessionId));
  await db.delete(categoryInterviewSessions).where(eq(categoryInterviewSessions.id, currentSessionId));
  for (const taskId of new Set(drafts.map((draft) => draft.taskId).filter(Boolean))) {
    await db.delete(captureTasks).where(eq(captureTasks.id, taskId!));
  }
}
