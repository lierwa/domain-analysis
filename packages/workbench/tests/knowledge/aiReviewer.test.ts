import { describe, expect, it } from "vitest";
import { parseKnowledgeAiReviewOutput, type KnowledgeAiReviewInput } from "../../src/knowledge/aiReviewer";

const issueId = "a".repeat(64);
const candidateId = "b".repeat(64);
const input: KnowledgeAiReviewInput = {
  pack: { name: "测试知识包", scope: "测试范围" },
  issues: [{ id: issueId, code: "ocr_requires_review", title: "OCR 自动核验", summary: "核验图片文字",
    action: "批量判断", status: "open", itemIds: ["image-item"], candidateIds: [candidateId], humanRequired: false,
    candidates: [{ id: candidateId, subject: "测试型号", label: "图片文字", text: "800 W", locator: "OCR line 1",
      sourceUrl: "https://example.com/model", confidence: 0.98, box: [[1, 1], [20, 1], [20, 8], [1, 8]] }],
    imageSlots: ["image-1: 测试型号 原图"] }],
  attachments: [],
};

describe("知识内容自动判断输出边界", () => {
  it("把结构化输出中的不适用 null 收窄为内部可选字段", () => {
    const result = parseKnowledgeAiReviewOutput(input, JSON.stringify({ recommendations: [{
      protocol: "automatic-review-2", issueId, recommendation: "accept", confidence: "high",
      candidateIds: [candidateId], imageAction: null, maskCandidateIds: null, rationale: "原图与识别结果一致",
    }] }));

    expect(result[0]).toMatchObject({ issueId, candidateIds: [candidateId], maskCandidateIds: [] });
    expect(result[0]!.imageAction).toBeUndefined();
  });

  it("仍然拒绝不属于当前问题的候选 ID", () => {
    expect(() => parseKnowledgeAiReviewOutput(input, JSON.stringify({ recommendations: [{
      protocol: "automatic-review-2", issueId, recommendation: "accept", confidence: "high",
      candidateIds: ["c".repeat(64)], imageAction: null, maskCandidateIds: null, rationale: "错误引用",
    }] }))).toThrow("范围外候选");
  });

  it("图片采用结论必须包含图片候选，避免副本绕过自动验收", () => {
    const imageInput: KnowledgeAiReviewInput = { ...input, issues: [{ ...input.issues[0]!,
      code: "image_requires_review", title: "图片副本需要验收", summary: "对照原图与副本" }] };
    expect(() => parseKnowledgeAiReviewOutput(imageInput, JSON.stringify({ recommendations: [{
      protocol: "automatic-review-2", issueId, recommendation: "accept", confidence: "high",
      candidateIds: [], imageAction: "keep", maskCandidateIds: null, rationale: "副本合格",
    }] }))).toThrow("缺少图片候选");
  });
});
