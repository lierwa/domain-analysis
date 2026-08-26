import type {
  CategoryInterviewDraftCoverage,
  CategoryInterviewRuntimeOutput,
  CategoryInterviewView,
  InterviewMessageTimelinePart,
} from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import { prepareInterviewTurn } from "../src/categoryInterviewTurnPolicy";

describe("采访草案完成门", () => {
  it("没有品类范围搜索凭证时不能把调查判为完成", () => {
    const output = draftOutput();
    output.draftMarkdown = [
      "# 微波炉数据抓取采访范围草案",
      "",
      "- [京东微波炉目录](https://www.jd.com/chanpin/485051.html)",
      "- [美的微波炉产品页](https://event.midea.cn/next/item_search/searchlist_w?category_id=10036)",
      "- [松下中国微波炉产品页](https://consumer.panasonic.cn/product/cooking-appliances/microwave-ovens/household-microwave-ovens.html)",
    ].join("\n");

    expect(() => prepareInterviewTurn(
      interviewView(), output, "2026-08-20T00:00:01.000Z", (kind) => kind, "message-user",
      [],
    )).toThrow("草案品类范围调查尚未完成");
  });

  it("品类范围依据来自已完成搜索且写入草案时才能进入待确认", () => {
    const coverage = completeCoverage();
    const output = draftOutput();
    output.draftCoverage = coverage;
    output.draftMarkdown = coverageMarkdown(coverage);

    const result = prepareInterviewTurn(
      interviewView(), output, "2026-08-20T00:00:01.000Z", (kind) => kind, "message-user",
      completedSearch(coverage),
    );

    expect(result.nextPhase).toBe("task_ready");
  });

  it("不能用未实际搜索到的入口伪造草案覆盖", () => {
    const coverage = completeCoverage();
    const output = draftOutput();
    output.draftCoverage = coverage;
    output.draftMarkdown = coverageMarkdown(coverage);
    const searched = completedSearch(coverage);
    const activity = searched[0]?.type === "activity" ? searched[0].activity : undefined;
    if (!activity?.urls) throw new Error("测试搜索活动缺少 URL");
    activity.urls = activity.urls.filter((url) => url !== coverage.scopeEvidenceUrls[0]);

    expect(() => prepareInterviewTurn(
      interviewView(), output, "2026-08-20T00:00:01.000Z", (kind) => kind, "message-user",
      searched,
    )).toThrow("草案覆盖凭证必须来自本会话已完成的网页搜索");
  });

  it("覆盖凭证中的入口必须真实出现在 Markdown 草案", () => {
    const coverage = completeCoverage();
    const output = draftOutput();
    output.draftCoverage = coverage;
    output.draftMarkdown = "# 电视抓取范围\n- 品类范围：已调查";

    expect(() => prepareInterviewTurn(
      interviewView(), output, "2026-08-20T00:00:01.000Z", (kind) => kind, "message-user",
      completedSearch(coverage),
    )).toThrow("草案覆盖凭证必须真实写入 Markdown");
  });

  it("系统负责的来源调查未解决时不能生成可确认草案", () => {
    const view = interviewView();
    view.unresolvedItems.push({
      id: "unresolved-standard", sessionId: view.session.id, key: "sources.standard",
      description: "尚未找到适用国家标准入口", owner: "system", status: "open",
      createdAt: "2026-08-20T00:00:00.000Z",
    });

    expect(() => prepareInterviewTurn(
      view, draftOutput(), "2026-08-20T00:00:01.000Z", (kind) => kind, "message-user",
      [],
    )).toThrow("系统负责的来源与内容调查尚未完成");
  });

  it("本轮刚声明的系统调查未决项也不能与完整草案同时出现", () => {
    const output = draftOutput();
    output.unresolvedItems = [{
      key: "sources.technical", description: "尚未找到权威技术原理入口", owner: "system",
    }];

    expect(() => prepareInterviewTurn(
      interviewView(), output, "2026-08-20T00:00:01.000Z", (kind) => kind, "message-user",
      [],
    )).toThrow("系统负责的来源与内容调查尚未完成");
  });
});

function draftOutput(): CategoryInterviewRuntimeOutput {
  return {
    assistantText: "调查完成，形成草案。", draftMarkdown: "# 电视抓取范围",
    unresolvedItems: [], resolvedUnresolvedKeys: [],
  };
}

function interviewView(): CategoryInterviewView {
  return {
    session: {
      id: "session-tv", initialRequest: "抓中国大陆当前在售家用电视，排除商用、二手和停售型号",
      phase: "active", turnState: "idle", revision: 1,
      createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z",
    },
    messages: [{
      id: "message-user", sessionId: "session-tv", sequence: 1, role: "user",
      text: "抓中国大陆当前在售家用电视，排除商用、二手和停售型号",
      deliveryStatus: "completed", createdAt: "2026-08-20T00:00:00.000Z",
    }],
    decisions: [{
      id: "decision-lifecycle", sessionId: "session-tv", key: "catalog.lifecycle-scope",
      question: "首期是否纳入停售型号？",
      options: [
        { label: "仅当前在售", description: "边界清晰。", recommended: true },
        { label: "包含停售型号", description: "历史覆盖更广。", recommended: false },
      ],
      selection: "仅当前在售", rationale: "负责人已明确排除停售型号。", status: "confirmed",
      sourceMessageId: "message-user", createdAt: "2026-08-20T00:00:00.000Z",
      confirmedAt: "2026-08-20T00:00:00.000Z",
    }],
    unresolvedItems: [], taskDrafts: [],
  };
}

function completeCoverage(): CategoryInterviewDraftCoverage {
  return {
    scopeEvidenceUrls: [
      "https://www.crta.com.cn/upload/default/66860b634af7e.pdf",
      "https://tv.zol.com.cn/959/9596733.html",
    ],
  };
}

function coverageMarkdown(coverage: CategoryInterviewDraftCoverage) {
  return [
    "# 电视抓取范围",
    ...coverage.scopeEvidenceUrls.map((url) => `- 品类范围依据：${url}`),
  ].join("\n");
}

function completedSearch(coverage: CategoryInterviewDraftCoverage): InterviewMessageTimelinePart[] {
  return [{
    type: "activity",
    activity: {
      id: "search-coverage", kind: "web_search", label: "搜索品类范围依据",
      urls: Object.values(coverage).flat(), status: "completed",
    },
  }];
}
