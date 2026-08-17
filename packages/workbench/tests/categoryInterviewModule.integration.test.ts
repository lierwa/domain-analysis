import { randomUUID } from "node:crypto";

import type {
  CategoryInterviewRuntimeOutput,
  CategoryResearchBriefContent,
} from "@domain-analysis/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  type CategoryInterviewRuntime,
  type CategoryInterviewRuntimeEvent,
} from "../src/categoryInterviewModule";
import { openProductKnowledgeWorkbench, type ProductKnowledgeWorkbench } from "../src/productKnowledgeWorkbench";

const databaseUrl = process.env.POSTGRES_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe.sequential : describe.skip;

describeWithPostgres("CategoryInterviewModule integration", () => {
  let workbench: ProductKnowledgeWorkbench | undefined;

  afterEach(async () => {
    await workbench?.close();
    workbench = undefined;
  });

  it("persists model proposals separately and only explicit confirmation creates project facts", async () => {
    const categoryLabel = `冰箱-${randomUUID()}`;
    const runtime = new QueueRuntime();
    workbench = await openProductKnowledgeWorkbench({
      databaseUrl: databaseUrl!,
      categoryInterviewRuntime: runtime,
      categoryInterviewModule: deterministic(),
    });
    const module = workbench.categoryInterviews!;
    const session = await module.start({ categoryHint: "冰箱" });

    runtime.push({
      assistantText: "建议首期聚焦中国大陆家用市场。首期是否按这个范围推进？",
      unresolvedItems: [],
      resolvedUnresolvedKeys: [],
      question: {
        key: "market",
        text: "首期是否按中国大陆家用市场推进？",
        recommendation: "中国大陆家用市场",
        rationale: "公开官方资料足够支撑第一条真实纵切片。",
      },
      proposedDecision: {
        key: "market",
        question: "首期是否按中国大陆家用市场推进？",
        selection: "中国大陆家用市场",
        rationale: "公开官方资料足够支撑第一条真实纵切片。",
      },
    });
    const firstEvents = await collect(module.runTurn({
      sessionId: session.session.id,
      trigger: "user_message",
      expectedRevision: session.session.revision,
      text: "开启冰箱品类，按你推荐的方案。",
    }));
    expect(firstEvents.map((event) => event.type)).toContain("assistant.delta");
    let view = await module.get(session.session.id);
    expect(view?.messages).toHaveLength(2);
    expect(view?.decisions).toEqual([expect.objectContaining({ status: "proposed" })]);

    view = await module.confirmDecision({
      sessionId: session.session.id,
      decisionId: view!.decisions[0]!.id,
      expectedRevision: view!.session.revision,
    });
    expect(view.decisions.map((decision) => decision.status)).toEqual(["proposed", "confirmed"]);

    runtime.push({
      assistantText: "负责人取舍已充分，已形成可确认的冰箱调研任务书。",
      unresolvedItems: [],
      resolvedUnresolvedKeys: [],
      briefCandidate: briefContent(view.decisions[1]!.id, categoryLabel),
    });
    await collect(module.runTurn({
      sessionId: session.session.id,
      trigger: "decision_confirmed",
      expectedRevision: view.session.revision,
      decisionId: view.decisions[1]!.id,
    }));
    view = await module.get(session.session.id);
    expect(view?.session.phase).toBe("brief_ready");
    expect(view?.briefs[0]?.status).toBe("draft");
    expect(await workbench.productProjects.list()).not.toContainEqual(expect.objectContaining({
      name: `${categoryLabel}品类知识项目`,
    }));

    const confirmed = await module.confirmBrief({
      sessionId: session.session.id,
      briefId: view!.briefs[0]!.id,
      expectedRevision: view!.session.revision,
    });
    expect(confirmed.interview.session.phase).toBe("confirmed");
    expect(confirmed.brief.status).toBe("confirmed");
    expect(confirmed.project.project.status).toBe("draft");
    expect(confirmed.project.confirmedScope.targets[0]?.evidenceReferenceIds).toEqual([confirmed.brief.id]);
  });

  it("rejects a new brief that does not assign every source entrypoint to knowledge needs", async () => {
    const categoryLabel = `冰箱-${randomUUID()}`;
    const runtime = new QueueRuntime();
    workbench = await openProductKnowledgeWorkbench({
      databaseUrl: databaseUrl!,
      categoryInterviewRuntime: runtime,
      categoryInterviewModule: deterministic(),
    });
    const module = workbench.categoryInterviews!;
    const session = await module.start({ categoryHint: "冰箱" });
    runtime.push({
      assistantText: "建议首期聚焦中国大陆家用市场。",
      unresolvedItems: [],
      resolvedUnresolvedKeys: [],
      proposedDecision: {
        key: "market",
        question: "首期市场？",
        selection: "中国大陆家用市场",
        rationale: "公开官方资料足够支撑第一条真实纵切片。",
      },
    });
    await collect(module.runTurn({
      sessionId: session.session.id,
      trigger: "user_message",
      expectedRevision: session.session.revision,
      text: "开启冰箱品类。",
    }));
    let view = (await module.get(session.session.id))!;
    view = await module.confirmDecision({
      sessionId: session.session.id,
      decisionId: view.decisions[0]!.id,
      expectedRevision: view.session.revision,
    });
    runtime.push({
      assistantText: "生成一份缺少来源分配的任务书，用于验证失败关闭。",
      unresolvedItems: [],
      resolvedUnresolvedKeys: [],
      briefCandidate: { ...briefContent(view.decisions[1]!.id, categoryLabel), sourceAssignments: [] },
    });
    await collect(module.runTurn({
      sessionId: session.session.id,
      trigger: "decision_confirmed",
      decisionId: view.decisions[1]!.id,
      expectedRevision: view.session.revision,
    }));
    view = (await module.get(session.session.id))!;

    await expect(module.confirmBrief({
      sessionId: session.session.id,
      briefId: view.briefs[0]!.id,
      expectedRevision: view.session.revision,
    })).rejects.toThrow("任务书必须把每个正式来源入口显式分配给路线和知识需求");
    // WHY：全仓集成测试共享同一隔离库；用本测试唯一名称保护“失败不得创建项目”的不变量，
    // 避免把其他并发测试的合法写入误判成本模块副作用。
    expect(await workbench.productProjects.list()).not.toContainEqual(expect.objectContaining({
      name: `${categoryLabel}品类知识项目`,
    }));
  });

  it("records an interrupted partial answer without promoting any decision", async () => {
    const runtime = new QueueRuntime();
    runtime.interruptNext();
    workbench = await openProductKnowledgeWorkbench({
      databaseUrl: databaseUrl!,
      categoryInterviewRuntime: runtime,
      categoryInterviewModule: deterministic(),
    });
    const module = workbench.categoryInterviews!;
    const session = await module.start({ categoryHint: "冰箱" });

    const events = await collect(module.runTurn({
      sessionId: session.session.id,
      trigger: "user_message",
      expectedRevision: session.session.revision,
      text: "开启冰箱品类",
    }));
    const view = await module.get(session.session.id);

    expect(events.at(-1)?.type).toBe("turn.interrupted");
    expect(view?.session.turnState).toBe("interrupted");
    expect(view?.messages.at(-1)).toMatchObject({ role: "assistant", deliveryStatus: "interrupted" });
    expect(view?.decisions).toEqual([]);
  });

  it("retries the same user message without creating a second user fact", async () => {
    const runtime = new QueueRuntime();
    runtime.interruptNext();
    workbench = await openProductKnowledgeWorkbench({
      databaseUrl: databaseUrl!,
      categoryInterviewRuntime: runtime,
      categoryInterviewModule: deterministic(),
    });
    const module = workbench.categoryInterviews!;
    const session = await module.start({ categoryHint: "冰箱" });
    await collect(module.runTurn({
      sessionId: session.session.id,
      trigger: "user_message",
      expectedRevision: session.session.revision,
      text: "开启冰箱品类",
    }));
    const interrupted = await module.get(session.session.id);
    const userMessage = interrupted!.messages.find((message) => message.role === "user")!;
    runtime.push({
      assistantText: "已从同一条用户消息恢复。",
      unresolvedItems: [],
      resolvedUnresolvedKeys: [],
    });

    await collect(module.runTurn({
      sessionId: session.session.id,
      trigger: "user_message",
      expectedRevision: interrupted!.session.revision,
      text: userMessage.text,
      retryMessageId: userMessage.id,
    }));
    const recovered = await module.get(session.session.id);

    expect(recovered?.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(recovered?.messages.at(-1)).toMatchObject({ role: "assistant", deliveryStatus: "completed" });
  });

  it("advances after confirmation without inserting a fake continue message", async () => {
    const runtime = new QueueRuntime();
    workbench = await openProductKnowledgeWorkbench({
      databaseUrl: databaseUrl!,
      categoryInterviewRuntime: runtime,
      categoryInterviewModule: deterministic(),
    });
    const module = workbench.categoryInterviews!;
    const session = await module.start({ categoryHint: "冰箱" });
    runtime.push({
      assistantText: "建议首期聚焦中国大陆家用市场。",
      proposedDecision: {
        key: "market",
        question: "首期市场？",
        selection: "中国大陆家用市场",
        rationale: "官方资料可支撑。",
      },
      unresolvedItems: [],
      resolvedUnresolvedKeys: [],
    });
    await collect(module.runTurn({
      sessionId: session.session.id,
      trigger: "user_message",
      expectedRevision: session.session.revision,
      text: "开启冰箱品类",
    }));
    let view = (await module.get(session.session.id))!;
    view = await module.confirmDecision({
      sessionId: session.session.id,
      decisionId: view.decisions[0]!.id,
      expectedRevision: view.session.revision,
    });
    runtime.push({
      assistantText: "下一项：首期是否只覆盖家用场景？",
      unresolvedItems: [],
      resolvedUnresolvedKeys: [],
    });
    await collect(module.runTurn({
      sessionId: session.session.id,
      trigger: "decision_confirmed",
      decisionId: view.decisions[1]!.id,
      expectedRevision: view.session.revision,
    }));
    const advanced = (await module.get(session.session.id))!;

    expect(advanced.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(advanced.messages.some((message) => message.text === "继续")).toBe(false);
    expect(runtime.inputs.at(-1)?.trigger).toMatchObject({
      type: "decision_confirmed",
      decision: { id: view.decisions[1]!.id, status: "confirmed" },
    });
  });
});

class QueueRuntime implements CategoryInterviewRuntime {
  private readonly outputs: CategoryInterviewRuntimeOutput[] = [];
  private shouldInterrupt = false;
  readonly inputs: Parameters<CategoryInterviewRuntime["run"]>[0][] = [];

  push(output: CategoryInterviewRuntimeOutput) {
    this.outputs.push(output);
  }

  interruptNext() {
    this.shouldInterrupt = true;
  }

  async *run(input: Parameters<CategoryInterviewRuntime["run"]>[0]): AsyncIterable<CategoryInterviewRuntimeEvent> {
    this.inputs.push(input);
    yield { type: "text_delta", delta: "正在形成冰箱调研建议……" };
    if (this.shouldInterrupt) {
      this.shouldInterrupt = false;
      yield { type: "interrupted" };
      return;
    }
    const output = this.outputs.shift();
    if (!output) throw new Error("missing runtime fixture");
    yield { type: "completed", output };
  }
}

async function collect<T>(events: AsyncIterable<T>) {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function deterministic() {
  const prefix = `interview-${randomUUID()}`;
  const counters = new Map<string, number>();
  return {
    now: () => new Date("2026-08-16T08:00:00.000Z"),
    createId: (kind: string) => {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${prefix}-${kind}-${next}`;
    },
  };
}

function briefContent(decisionId: string, categoryLabel = "冰箱"): CategoryResearchBriefContent {
  return {
    category: { code: "refrigerator", label: categoryLabel, market: "CN" },
    objective: "建立支持选购和理解原理的冰箱知识底座。",
    audience: "中国大陆家用消费者",
    priorityScenarios: ["容量与尺寸匹配", "保鲜与制冷方案比较"],
    excludedScope: ["商用冷库"],
    knowledgeNeeds: [{
      id: "need-fridge-specs",
      question: "冰箱关键规格如何影响家庭使用？",
      knowledgeLayers: ["specification", "decision"],
      priority: "must",
    }],
    categoryFramework: {
      attributes: [{
        code: "total_volume_l",
        label: "总容积",
        description: "额定总容积",
        knowledgeLayer: "specification",
        valueKind: "decimal",
        canonicalUnitCode: "L",
        externalMappings: [],
        filterable: true,
        comparable: true,
      }],
      decisionDimensions: [{
        code: "capacity_fit",
        label: "容量匹配",
        description: "按家庭人数和储存习惯判断容量",
        relatedAttributeCodes: ["total_volume_l"],
      }],
      competencyQuestions: ["三口之家如何判断冰箱容量是否合适？"],
    },
    targetPopulation: {
      populationLayers: ["official_current_catalog"],
      targets: [{
        key: "category:refrigerator",
        kind: "category",
        label: "中国大陆在售家用冰箱",
        disposition: "included",
        reason: "先完成品类级真实纵切片。",
      }],
    },
    sourcePolicy: {
      authorityTypes: ["brand_official_site", "official_manual"],
      accessModes: ["public_web", "document"],
      freshnessPolicy: "manual",
      stopConditions: ["login_required", "verification_required", "access_denied"],
    },
    collectionLanes: [{
      id: "official-fridge-web",
      sourceAuthorityType: "brand_official_site",
      accessMode: "public_web",
      targetKeys: ["category:refrigerator"],
      knowledgeLayers: ["identity", "specification", "decision"],
      refreshPolicy: "manual",
      stopConditions: ["login_required", "verification_required", "access_denied"],
    }],
    sourceAssignments: [{
      collectionLaneId: "official-fridge-web",
      factReferenceId: "fact-official-fridge",
      knowledgeNeedIds: ["need-fridge-specs"],
    }],
    acceptanceCriteria: ["保存一条带 URL、时间、哈希和 locator 的真实冰箱原始证据"],
    decisionIds: [decisionId],
    factReferences: [{
      id: "fact-official-fridge",
      label: "品牌官方冰箱资料",
      url: "https://example.com/official-fridge",
      sourceAuthorityType: "brand_official_site",
      observedAt: "2026-08-16T00:00:00.000Z",
    }],
    investigatedFacts: ([
      "brand", "model", "parameter", "component", "mechanism", "source_entrypoint",
    ] as const).map((kind) => ({
      id: `investigated-${kind}`,
      kind,
      statement: `${kind} 前置调查事实`,
      factReferenceIds: ["fact-official-fridge"],
    })),
  };
}
