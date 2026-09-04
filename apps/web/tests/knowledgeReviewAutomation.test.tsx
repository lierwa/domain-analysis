/** @vitest-environment jsdom */

import type { KnowledgeRunView } from "@domain-analysis/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeReview } from "../src/pages/knowledge/KnowledgeReview";

afterEach(cleanup);

describe("知识加工自动分流", () => {
  it("OCR 与图片加工只显示批量结果，不暴露逐行勾选和手工遮罩工具", () => {
    render(<KnowledgeReview view={view()} action={vi.fn()} busy={false} />);

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText("20 行 OCR 文字")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /图片自动处理 图片尚未形成合格副本/ }));
    expect(screen.queryByLabelText("绘制水印字形遮罩")).toBeNull();
    expect(screen.queryByLabelText("导入字形遮罩")).toBeNull();
  });

  it("已处理问题展示当前准入结果，不重复展示历史 AI 建议", () => {
    const current = view();
    current.issues = current.issues.map(issue => ({ ...issue, status: "resolved" }));
    current.admission.candidates = current.issues[0]!.candidateIds.map((candidateId, index) => ({
      candidateId, decision: index < 5 ? "accepted" : "excluded", admitted: index < 5,
      automatic: true, reason: "当前处置", factKeys: [], dependsOn: [],
    }));
    current.aiReview = { id: "old-review", runId: current.run.id, issueFingerprint: hash("9"),
      generation: 1, reviewRevision: 0, status: "completed", model: "fixture", reasoningEffort: "low",
      recommendations: [{ issueId: current.issues[0]!.id, recommendation: "accept", confidence: "high",
        candidateIds: current.issues[0]!.candidateIds, rationale: "过期建议" }], createdAt: at, finishedAt: at };

    render(<KnowledgeReview view={current} action={vi.fn()} busy={false} />);

    expect(screen.getByText((_, element) => element?.textContent === "5 行入包")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "15 行自动隔离")).toBeTruthy();
    expect(screen.queryByText(/过期建议/)).toBeNull();
    expect(screen.queryByText(/自动判断完成/)).toBeNull();
  });

  it("展示当前自动判断的处置依据", () => {
    const current = view();
    current.issues = current.issues.map(issue => ({ ...issue, status: "resolved" }));
    current.aiReview = { id: "current-review", runId: current.run.id, issueFingerprint: hash("9"),
      generation: 1, reviewRevision: 0, status: "completed", model: "fixture", reasoningEffort: "low",
      recommendations: [{ protocol: "automatic-review-2", issueId: current.issues[0]!.id,
        recommendation: "exclude", confidence: "high", candidateIds: [], rationale: "站点水印和残缺文字已隔离" }],
      createdAt: at, finishedAt: at };

    render(<KnowledgeReview view={current} action={vi.fn()} busy={false} />);

    expect(screen.getByText(/站点水印和残缺文字已隔离/)).toBeTruthy();
  });
});

const hash = (char: string) => char.repeat(64);
const idHash = (value: number) => value.toString(16).padStart(64, "0");
const at = "2026-09-04T00:00:00.000Z";

function view(): KnowledgeRunView {
  const ocr = Array.from({ length: 20 }, (_, index) => ({
    id: idHash(index + 2), kind: "text" as const,
    label: "图片文字", text: `OCR ${index + 1}`, locator: `OCR line ${index + 1}`,
    contentHash: hash(((index + 3) % 10).toString()), confidence: 0.95,
    box: [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][],
  }));
  const image = { id: hash("1"), kind: "image" as const, label: "商品图片", text: "",
    locator: "full image", contentHash: hash("a") };
  const input = { ref: { taskId: "task", runId: "source-run", snapshotId: "snapshot", assetId: "asset", sha256: hash("a") },
    key: hash("b"), providerKey: "fixture", subjectKey: "model", subjectName: "测试型号", label: "商品图片",
    url: "https://example.com/image.png", format: "image" as const, mediaType: "image/png", bytes: 100,
    capturedAt: at, availability: "ready" as const };
  return {
    run: { id: "run", packId: "pack", sourceRevision: 1, inputs: [input], settings: { ocr: true, budgetSeconds: 120, requiredInputKeys: [] },
      inputHash: hash("c"), toolVersion: "fixture", llmCalls: 0, llmTokens: 0, generation: 1, reviewRevision: 0,
      stage: "review", status: "completed", stopRequested: false, createdAt: at },
    items: [{ id: "item", runId: "run", input, status: "completed", attempts: [],
      result: { toolVersion: "fixture", cacheKey: hash("d"), reused: false, candidates: [image, ...ocr], notes: [] } }],
    decisions: [],
    versionInputHash: hash("8"),
    admission: { candidates: [], accepted: 0, images: 0, autoAccepted: 0, reviewAccepted: 0,
      excluded: 0, openIssues: 2, quarantined: 21, gaps: [] },
    issues: [{ id: hash("e"), code: "ocr_requires_review", title: "图片文字需要核对", summary: "OCR 从图片中识别出 20 行文字",
      action: "自动核对", status: "open", itemIds: ["item"], candidateIds: ocr.map(row => row.id) },
    { id: hash("f"), code: "image_requires_processing", title: "图片尚未形成合格副本", summary: "图片只有原件",
      action: "自动处理", status: "open", itemIds: ["item"], candidateIds: [image.id] }],
  };
}
