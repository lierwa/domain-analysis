import { describe, expect, it } from "vitest";

import {
  categoryInterviewRuntimeOutputSchema,
  categoryInterviewViewSchema,
  interviewTimelineEventSchema,
  interviewTurnRequestSchema,
} from "../src/category-interview";

const now = "2026-08-16T08:00:00.000Z";

describe("category interview contracts", () => {
  it("keeps normalized messages, decisions, unresolved items and brief versions separate", () => {
    const view = categoryInterviewViewSchema.parse({
      session: {
        id: "session-fridge",
        categoryHint: "冰箱",
        phase: "brief_ready",
        turnState: "idle",
        revision: 4,
        createdAt: now,
        updatedAt: now,
      },
      messages: [{
        id: "message-1",
        sessionId: "session-fridge",
        sequence: 1,
        role: "user",
        text: "开启冰箱品类",
        deliveryStatus: "completed",
        createdAt: now,
      }],
      decisions: [{
        id: "decision-1",
        sessionId: "session-fridge",
        key: "market",
        question: "首期研究哪个市场？",
        selection: "中国大陆家用市场",
        rationale: "官方资料和样本可得性最好。",
        status: "confirmed",
        sourceMessageId: "message-1",
        createdAt: now,
        confirmedAt: now,
      }],
      unresolvedItems: [{
        id: "unresolved-1",
        sessionId: "session-fridge",
        key: "future-commercial-market",
        description: "商用制冷是否进入后续批次",
        owner: "user",
        status: "open",
        createdAt: now,
      }],
      briefs: [{
        id: "brief-1",
        sessionId: "session-fridge",
        version: 1,
        status: "draft",
        contentHash: "a".repeat(64),
        content: briefContent(),
        createdAt: now,
      }],
    });

    expect(view.messages[0]?.role).toBe("user");
    expect(view.decisions[0]?.status).toBe("confirmed");
    expect(view.briefs[0]?.status).toBe("draft");
  });

  it("exposes at most one owner question per runtime result", () => {
    const output = categoryInterviewRuntimeOutputSchema.parse({
      assistantText: "建议首期聚焦中国大陆家用市场。",
      question: {
        key: "market",
        text: "首期是否按中国大陆家用市场推进？",
        recommendation: "按中国大陆家用市场推进",
        rationale: "能用公开官方资料完成第一条真实纵切片。",
      },
    });

    expect(output.question?.key).toBe("market");
    expect(categoryInterviewRuntimeOutputSchema.parse({
      assistantText: "继续采访。",
      question: null,
      proposedDecision: null,
      unresolvedItems: null,
      resolvedUnresolvedKeys: null,
      briefCandidate: null,
    })).toMatchObject({ unresolvedItems: [], resolvedUnresolvedKeys: [] });
    expect(() => categoryInterviewRuntimeOutputSchema.parse({
      assistantText: "invalid",
      question: [
        { key: "market", text: "市场？", recommendation: "中国", rationale: "可得" },
        { key: "depth", text: "深度？", recommendation: "中等", rationale: "可控" },
      ],
    })).toThrow();
  });

  it("uses a discriminated typed timeline instead of inferring state from text", () => {
    const event = interviewTimelineEventSchema.parse({
      type: "interview.state.changed",
      sessionId: "session-fridge",
      turnId: "turn-1",
      revision: 4,
      phase: "brief_ready",
      turnState: "idle",
    });

    expect(event.type).toBe("interview.state.changed");
    expect(() => interviewTimelineEventSchema.parse({
      type: "assistant.delta",
      sessionId: "session-fridge",
      turnId: "turn-1",
      delta: "",
    })).toThrow();
  });

  it("separates user answers from decision-confirmed continuation actions", () => {
    expect(interviewTurnRequestSchema.parse({
      trigger: "user_message",
      expectedRevision: 2,
      text: "中国大陆家用市场",
    }).trigger).toBe("user_message");
    expect(interviewTurnRequestSchema.parse({
      trigger: "decision_confirmed",
      expectedRevision: 3,
      decisionId: "decision-confirmed-1",
    }).trigger).toBe("decision_confirmed");
    expect(() => interviewTurnRequestSchema.parse({
      expectedRevision: 3,
      text: "继续",
    })).toThrow();
  });

  it("requires sourced investigation facts before a brief can be created", () => {
    const valid = briefContent();
    expect(categoryInterviewRuntimeOutputSchema.parse({
      assistantText: "前置调查已完成。",
      briefCandidate: valid,
    }).briefCandidate?.investigatedFacts).toHaveLength(6);

    expect(() => categoryInterviewRuntimeOutputSchema.parse({
      assistantText: "不能把空来源任务书当作完成。",
      briefCandidate: { ...valid, factReferences: [], investigatedFacts: [] },
    })).toThrow();
    expect(() => categoryInterviewRuntimeOutputSchema.parse({
      assistantText: "不能引用不存在的来源。",
      briefCandidate: {
        ...valid,
        investigatedFacts: valid.investigatedFacts.map((fact, index) => index === 0
          ? { ...fact, factReferenceIds: ["fact-missing"] }
          : fact),
      },
    })).toThrow();
  });
});

function briefContent() {
  return {
    category: { code: "refrigerator", label: "冰箱", market: "CN" },
    objective: "建立支持选购与理解原理的冰箱知识底座。",
    audience: "中国大陆家用消费者",
    priorityScenarios: ["容量与尺寸匹配", "保鲜与制冷方案比较"],
    excludedScope: ["商用冷库"],
    knowledgeNeeds: [{
      id: "need-specs",
      question: "冰箱的关键规格如何影响家庭使用？",
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
        reason: "先建立品类级真实纵切片，再扩展品牌和型号。",
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
      knowledgeNeedIds: ["need-specs"],
    }],
    acceptanceCriteria: ["至少保存一条可定位、带 URL/时间/哈希的真实冰箱原始证据"],
    decisionIds: ["decision-1"],
    factReferences: [factReference()],
    investigatedFacts: investigatedFacts(),
  };
}

function factReference() {
  return {
    id: "fact-official-fridge",
    label: "品牌官方冰箱资料",
    url: "https://example.com/official-fridge",
    sourceAuthorityType: "brand_official_site",
    observedAt: now,
  };
}

function investigatedFacts() {
  return ["brand", "model", "parameter", "component", "mechanism", "source_entrypoint"].map((kind) => ({
    id: `investigated-${kind}`,
    kind,
    statement: `${kind} 前置调查事实`,
    factReferenceIds: ["fact-official-fridge"],
  }));
}
