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
type Harness = Awaited<ReturnType<typeof createHarness>>;
let db: WorkbenchDb | undefined;
let sessionId: string | undefined;

afterEach(async () => {
  if (db && sessionId) await removeSession(db, sessionId);
  await db?.$client.end();
  db = undefined;
  sessionId = undefined;
});

describeWithPostgres("采访草案与正式抓取任务的阶段边界", () => {
  it("混合回答只形成 Markdown 草案，确认前不创建 Capture Task", async () => {
    const harness = await createHarness("抓冰箱");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    harness.runtime.push(decisionOutput());
    await run(harness, "抓冰箱");
    let view = (await harness.interviews.get(sessionId))!;
    const proposed = view.decisions.find((item) => item.status === "proposed")!;
    const answer = "1，另外不包含二手商品";
    harness.runtime.push({
      ...draftOutput("# 冰箱采访范围\n\n- 仅当前在售型号\n- 排除二手商品"),
      assistantText: "已采用当前在售型号，并排除二手商品。",
      decisionResolution: {
        decisionId: proposed.id, selection: "仅当前在售型号",
        rationale: "序号回答与补充排除条件已一并理解。",
      },
      resolvedUnresolvedKeys: ["catalog.lifecycle-scope"],
    });
    await run(harness, answer, view.session.revision);
    view = (await harness.interviews.get(sessionId))!;

    expect(harness.runtime.inputs.at(-1)?.trigger).toEqual({ type: "user_message", text: answer });
    expect(view.decisions).toContainEqual(expect.objectContaining({ status: "confirmed" }));
    expect(view.taskDrafts[0]?.markdown).toContain("排除二手商品");
    expect(harness.runtime.materializationInputs).toHaveLength(0);
    expect(await taskCount(db!, sessionId)).toBe(0);
  });

  it("显式确认后才结构化并创建 Capture Task", async () => {
    const harness = await createHarness("抓冰箱");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    const view = await createDraft(harness, "# 冰箱采访范围\n\n覆盖中国大陆当前在售新机。", "冰箱");
    const draft = view.taskDrafts.find((item) => item.status === "draft")!;
    harness.runtime.pushMaterialization(taskMaterialization("refrigerator", "冰箱"));

    const confirmed = await harness.interviews.confirmTaskDraft({
      sessionId, draftId: draft.id, expectedRevision: view.session.revision,
    });

    expect(harness.runtime.materializationInputs[0]?.draftMarkdown).toBe(draft.markdown);
    expect(await taskCount(db!, sessionId)).toBe(1);
    expect(confirmed.task).toMatchObject({ revision: 1 });
    expect(confirmed.task.content.sourceCandidates[0]?.observedAt).toBe("2026-08-19T14:00:00.000Z");
  });

  it("确认草案时允许来源种子不完整，完整来源留给 Planning Run 调查", async () => {
    const harness = await createHarness("抓电视");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    const view = await createDraft(harness, "# 电视采访范围\n\n只列出两个品牌官网。", "电视");
    const draft = view.taskDrafts.find((item) => item.status === "draft")!;
    const incomplete = taskMaterialization("television", "电视");
    incomplete.sourceCandidates = incomplete.sourceCandidates.filter((item) => item.sourceKind === "brand_official");
    harness.runtime.pushMaterialization(incomplete);

    const confirmed = await harness.interviews.confirmTaskDraft({
      sessionId, draftId: draft.id, expectedRevision: view.session.revision,
    });
    expect(confirmed.task.content).toMatchObject({
      sourceCandidates: [{ sourceKind: "brand_official" }, { sourceKind: "brand_official" }],
    });
    expect(await taskCount(db!, sessionId)).toBe(1);
  });
});

describeWithPostgres("Markdown 草案版本历史", () => {
  it("未经过四类来源证据门的历史待确认草案保留文本但降回继续采访", async () => {
    const harness = await createHarness("抓微波炉");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    const draftId = `legacy-draft-${randomUUID()}`;
    await db!.update(categoryInterviewSessions).set({ phase: "task_ready" })
      .where(eq(categoryInterviewSessions.id, sessionId));
    await db!.insert(captureTaskDraftVersions).values({
      id: draftId, sessionId, version: 1, status: "draft", contentHash: "0".repeat(64),
      briefMarkdown: "# 微波炉采访范围\n\n只有公开市场目录和两个品牌官网。",
      createdAt: "2026-08-19T14:00:00.000Z",
    });

    const view = (await harness.interviews.get(sessionId))!;

    expect(view.session.phase).toBe("active");
    expect(view.taskDrafts).toContainEqual(expect.objectContaining({
      id: draftId, status: "superseded", markdown: expect.stringContaining("只有公开市场目录和两个品牌官网"),
    }));
    await expect(harness.interviews.confirmTaskDraft({
      sessionId, draftId, expectedRevision: view.session.revision,
    })).rejects.toThrow("只有当前待确认草稿可以生成抓取任务");
  });

  it("修订保留历史，并在再次确认后更新同一 Capture Task", async () => {
    const harness = await createHarness("抓冰箱");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    let view = await createDraft(harness, "# 冰箱范围 v1", "冰箱");
    const firstDraft = view.taskDrafts.find((item) => item.status === "draft")!;
    harness.runtime.pushMaterialization(taskMaterialization("refrigerator", "冰箱"));
    const first = await harness.interviews.confirmTaskDraft({
      sessionId, draftId: firstDraft.id, expectedRevision: view.session.revision,
    });

    harness.runtime.push(draftOutput("# 冰箱范围 v2\n\n补充品牌官网。"));
    await run(harness, "补充品牌官网", first.interview.session.revision);
    view = (await harness.interviews.get(sessionId))!;
    expect(view.taskDrafts.find((item) => item.id === firstDraft.id)).toMatchObject({
      status: "confirmed", markdown: expect.stringContaining("# 冰箱范围 v1"),
    });
    const latest = view.taskDrafts.find((item) => item.status === "draft")!;
    expect(latest.markdown).toContain("品牌官网");

    const materialization = taskMaterialization("refrigerator", "冰箱");
    materialization.sourceCandidates.push(brandSource());
    harness.runtime.pushMaterialization(materialization);
    const revised = await harness.interviews.confirmTaskDraft({
      sessionId, draftId: latest.id, expectedRevision: view.session.revision,
    });
    expect(revised.task).toMatchObject({ id: first.task.id, revision: 2 });
    expect(revised.task.content.sourceCandidates).toHaveLength(6);
    expect(revised.interview.taskDrafts.filter((item) => item.status === "confirmed")).toHaveLength(2);
  });

  it("非最新 Markdown 草案不能确认，也不会触发结构化", async () => {
    const harness = await createHarness("抓显示器");
    ({ db } = harness);
    sessionId = harness.view.session.id;
    let view = await createDraft(harness, "# 显示器范围 v1", "显示器");
    const oldDraft = view.taskDrafts.find((item) => item.status === "draft")!;
    harness.runtime.push(draftOutput("# 显示器范围 v2\n\n排除二手商品。"));
    await run(harness, "排除二手商品", view.session.revision);
    view = (await harness.interviews.get(sessionId))!;

    await expect(harness.interviews.confirmTaskDraft({
      sessionId, draftId: oldDraft.id, expectedRevision: view.session.revision,
    })).rejects.toThrow("只有最新待确认草稿可以生成抓取任务");
    expect(harness.runtime.materializationInputs).toHaveLength(0);
    expect(await taskCount(db!, sessionId)).toBe(0);
  });
});

class RecordingRuntime implements CategoryInterviewRuntime {
  readonly inputs: CategoryInterviewRuntimeInput[] = [];
  readonly materializationInputs: CategoryInterviewMaterializationInput[] = [];
  private readonly outputs: CategoryInterviewRuntimeOutput[] = [];
  private readonly materializations: CaptureTaskMaterialization[] = [];

  push(output: CategoryInterviewRuntimeOutput) { this.outputs.push(output); }
  pushMaterialization(output: CaptureTaskMaterialization) { this.materializations.push(output); }

  async *run(input: CategoryInterviewRuntimeInput): AsyncIterable<CategoryInterviewRuntimeEvent> {
    this.inputs.push(input);
    const output = this.outputs.shift();
    if (!output) throw new Error("测试没有准备采访输出");
    if (output.draftCoverage) {
      yield { type: "activity", activity: completedCoverageSearch(output.draftCoverage) };
    }
    yield { type: "completed", output };
  }

  async materialize(input: CategoryInterviewMaterializationInput) {
    this.materializationInputs.push(input);
    const output = this.materializations.shift();
    if (!output) throw new Error("测试没有准备结构化输出");
    return output;
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

async function createDraft(harness: Harness, markdown: string, label: string) {
  harness.runtime.push(draftOutput(markdown));
  await run(harness, `抓${label}`);
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
      rationale: "该范围会直接改变来源和抓取量。",
    },
    unresolvedItems: [{ key: "catalog.lifecycle-scope", description: "等待确认型号生命周期范围。", owner: "user" }],
    resolvedUnresolvedKeys: [],
  };
}

function draftOutput(draftMarkdown: string): CategoryInterviewRuntimeOutput {
  const draftCoverage = completeCoverage();
  return {
    assistantText: "已更新采访范围草案。",
    draftMarkdown: `${draftMarkdown}\n\n${coverageMarkdown(draftCoverage)}`,
    draftCoverage,
    unresolvedItems: [],
    resolvedUnresolvedKeys: [],
  };
}

function taskMaterialization(code: string, label: string): CaptureTaskMaterialization {
  return {
    originalRequest: `抓${label}`,
    category: { code, label },
    marketScope: "中国大陆当前在售新机",
    brandSelectionPolicy: { mode: "source_brand_ranking", scoreField: "comprehensive_score",
      minimumScoreExclusive: 0, maxBrands: 20 },
    executionCadencePolicy: { mode: "fixed", brandBatchSize: 3, modelsPerBrandPerRound: 10 },
    modelCoveragePolicy: { mode: "max_models_per_brand", maxModelsPerBrand: 20 },
    generalTopics: ["品牌、型号、商品详情和参数"],
    categoryTopics: ["品类关键参数"],
    sourceCandidates: [{
      id: `market-${code}`, name: `${label}公开市场目录`, publisher: "市场目录出版方",
      entryUrl: "https://catalog.example.com/", sourceKind: "retailer",
      expectedContents: ["在售商品与参数"], observedFormats: ["网页"], accessState: "public",
    }, {
      id: `brand-${code}`, name: `${label}品牌官网`, publisher: "品牌方",
      entryUrl: "https://brand.example.com/products", sourceKind: "brand_official",
      expectedContents: ["官方型号、配置参数与说明书"], observedFormats: ["网页"], accessState: "public",
    }, {
      id: `brand-secondary-${code}`, name: `第二${label}品牌官网`, publisher: "第二品牌方",
      entryUrl: "https://second-brand.example.com/products", sourceKind: "brand_official",
      expectedContents: ["第二品牌型号、配置参数与说明书"], observedFormats: ["网页"], accessState: "public",
    }, {
      id: `standard-${code}`, name: `${label}国家标准`, publisher: "标准机构",
      entryUrl: "https://standard.example.com/document", sourceKind: "standards_body",
      expectedContents: ["标准、能效与认证"], observedFormats: ["网页"], accessState: "public",
    }, {
      id: `technical-${code}`, name: `${label}技术原理资料`, publisher: "专业技术机构",
      entryUrl: "https://technical.example.com/principles", sourceKind: "technical_publisher",
      expectedContents: ["关键部件与底层工作原理"], observedFormats: ["网页"], accessState: "public",
    }],
    excludedContent: [],
  };
}

function completeCoverage() {
  return {
    scopeEvidenceUrls: ["https://industry.example.com/category-scope"],
  };
}

function coverageMarkdown(coverage: ReturnType<typeof completeCoverage>) {
  return [
    "## 已调查来源",
    ...Object.values(coverage).flat().map((url) => `- ${url}`),
  ].join("\n");
}

function completedCoverageSearch(coverage: ReturnType<typeof completeCoverage>) {
  return {
    id: "search-professional-coverage", kind: "web_search" as const,
    label: "搜索品类范围依据", urls: Object.values(coverage).flat(), status: "completed" as const,
  };
}

function brandSource(): CaptureTaskMaterialization["sourceCandidates"][number] {
  return {
    id: "brand-site", name: "品牌官网", publisher: "品牌方",
    entryUrl: "https://example.com/products", sourceKind: "brand_official",
    expectedContents: ["官方型号与规格"], observedFormats: ["网页"], accessState: "public",
  };
}

async function taskCount(currentDb: WorkbenchDb, currentSessionId: string) {
  return (await currentDb.select({ id: captureTasks.id }).from(captureTasks)
    .innerJoin(captureTaskDraftVersions, eq(captureTaskDraftVersions.taskId, captureTasks.id))
    .where(eq(captureTaskDraftVersions.sessionId, currentSessionId))).length;
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
