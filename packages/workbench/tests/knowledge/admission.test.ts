import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { knowledgeAiReviewSchema, knowledgeInputSchema, knowledgePackSchema, knowledgeRunSchema, type KnowledgeCandidate,
  type KnowledgeDecision, type KnowledgeItem } from "@domain-analysis/shared";
import { afterEach, describe, expect, it } from "vitest";
import { assessAdmission } from "../../src/knowledge/admission";
import { createArtifact, validateArtifact } from "../../src/knowledge/artifact";
import { digest, sha256, storeBytes } from "../../src/knowledge/storage";

const at = "2026-09-03T00:00:00.000Z";
const textInput = knowledgeInputSchema.parse({ ref: { taskId: "task", runId: "source-run", snapshotId: "snapshot", sha256: digest("raw") },
  key: digest("text-input"), providerKey: "fixture", subjectKey: "model", subjectName: "测试型号", label: "参数页", url: "https://example.com/model",
  format: "html", mediaType: "text/html", bytes: 100, capturedAt: at, availability: "ready" });
const imageInput = knowledgeInputSchema.parse({ ...textInput, key: digest("image-input"), label: "商品图片", format: "image", mediaType: "image/png",
  ref: { ...textInput.ref, snapshotId: "image-snapshot", assetId: "excluded-image-source-asset", sha256: digest("image") } });
const pack = knowledgePackSchema.parse({ id: "knowledge-test-pack", name: "有界成品", scope: "单型号资料", revision: 1, selectionRevision: 1,
  skillName: "bounded-knowledge", selection: [{ taskId: "task", batchId: "source-batch" }],
  settings: { ocr: false, budgetSeconds: 30, requiredInputKeys: [] }, createdAt: at, updatedAt: at });
const run = knowledgeRunSchema.parse({ id: "knowledge-run", packId: pack.id, sourceRevision: 1, inputs: [textInput, imageInput], settings: pack.settings,
  inputHash: digest("inputs"), toolVersion: "fixture-1", llmCalls: 0, llmTokens: 0, generation: 1, reviewRevision: 1,
  stage: "review", status: "completed", stopRequested: false, createdAt: at });
const field = (name: string, text: string, kind: "text" | "image" = "text"): KnowledgeCandidate =>
  ({ id: digest(name), kind, text, label: name, locator: `#${name}`, contentHash: digest(text) });
const safe = field("保留字段", "23 L，标准环境");
const uncertain = field("菜单数量", "58 个");
const summary = field("关联描述", "支持 58 个自动菜单");
const photo = field("性能图片", "", "image");
const ocr = field("图片文字", "尚待确认的文字");
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function items(): KnowledgeItem[] {
  const result = (candidates: KnowledgeCandidate[]) => ({ toolVersion: "fixture-1", cacheKey: digest(candidates), reused: false, candidates, notes: [] });
  return [{ id: "text-item", runId: run.id, input: textInput, status: "completed", attempts: [], result: result([safe, uncertain, summary]) },
    { id: "image-item", runId: run.id, input: imageInput, status: "completed", attempts: [], result: result([{ ...photo, contentHash: sha256(imageBytes) }, ocr]),
      derivative: { sha256: sha256(imageBytes), bytes: imageBytes.length, width: 1, height: 1, originalSha256: imageInput.ref.sha256,
        maskSha256: digest("mask"), method: "opencv-telea", boundaryCuts: [], outsideMaskChangedPixels: 0 } }];
}
function review(rows: KnowledgeItem[], candidates: KnowledgeCandidate[], revision: number, fields: Partial<KnowledgeDecision> = {}): KnowledgeDecision {
  const actual = rows.flatMap(row => row.result!.candidates);
  return { id: `review-${revision}`, runId: run.id, revision, candidateIds: candidates.map(row => row.id), decision: "accepted", reason: "核对测试资料",
    dependsOn: [], visualApproved: true, contentApproved: true, humanSeconds: 10, contentHashes: Object.fromEntries(candidates.map(row =>
      [row.id, actual.find(value => value.id === row.id)!.contentHash])), createdAt: at, ...fields };
}

describe("知识包内容与图片准入", () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

  it("歧义隔离传播到关联描述和效果合格图片，所有消费文件使用同一准入结果", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-artifact-"));
    const rows = items(); await storeBytes(root, imageBytes);
    const decisions = [review(rows, [uncertain], 1, { decision: "excluded", factKey: "菜单规格" }),
      review(rows, [summary], 2, { dependsOn: [uncertain.id] }),
      review(rows, [photo], 3, { decision: "excluded" }), review(rows, [ocr], 4, { decision: "excluded" })];
    const built = await createArtifact({ pack, run, items: rows, decisions, number: 1, artifactPath: root });
    expect(built.artifact).toMatchObject({ accepted: 1, images: 0, quarantined: 4 });
    const files = await validateArtifact(built.zip, built.artifact.resources, built.artifact.format, built.artifact.skillName);
    expect(files["bounded-knowledge/SKILL.md"]).toBeDefined();
    expect(files["bounded-knowledge/scripts/query.mjs"]).toBeDefined();
    expect(files["bounded-knowledge/assets/data/catalog.json"]).toBeDefined();
    const contents = Object.values(files).map(value => Buffer.from(value).toString("utf8")).join("\n");
    expect(contents).not.toContain("58"); expect(contents).not.toContain(imageInput.ref.assetId);
    expect(Object.keys(files).some(name => name.endsWith(".png"))).toBe(false);
    const again = await createArtifact({ pack, run, items: rows, decisions, number: 1, artifactPath: root });
    expect(sha256(again.zip)).toBe(sha256(built.zip));
  });

  it("待审图片保持隔离但不阻止可用文字建包，只有内容、效果与副本哈希全部通过才导出", () => {
    const rows = items();
    const approvedText = review(rows, [safe, ocr], 1);
    expect(assessAdmission(run, rows, [approvedText])).toMatchObject({ images: 0, gaps: [], openIssues: 1 });
    const visualOnly = review(rows, [photo], 2, { contentApproved: false });
    expect(assessAdmission(run, rows, [approvedText, visualOnly]).images).toBe(0);
    const approvedImage = review(rows, [photo], 3);
    expect(assessAdmission(run, rows, [approvedText, approvedImage])).toMatchObject({ images: 1, gaps: [] });
    rows[1]!.result!.candidates[0]!.contentHash = digest("another-derivative");
    expect(assessAdmission(run, rows, [approvedText, approvedImage]).images).toBe(0);
  });

  it("自动判断整组采用可靠 OCR，并在第二次视觉验收后准入自动生成的图片副本", () => {
    const rows = items();
    const imageItem = rows[1]!;
    delete imageItem.derivative;
    const acceptedOcr = imageItem.result!.candidates[1]!;
    Object.assign(acceptedOcr, { locator: "OCR line 1", confidence: 0.98,
      box: [[10, 10], [50, 10], [50, 24], [10, 24]] });
    const watermark: KnowledgeCandidate = { ...field("站点标识", "来源站点"), locator: "OCR line 2", confidence: 0.99,
      box: [[80, 80], [120, 80], [120, 96], [80, 96]] };
    imageItem.result!.candidates.push(watermark);
    const pending = assessAdmission(run, rows, []);
    const ocrIssue = pending.issues.find(issue => issue.code === "ocr_requires_review")!;
    const imageIssue = pending.issues.find(issue => issue.code === "image_requires_processing")!;
    const aiReview = knowledgeAiReviewSchema.parse({ id: "ai-review", runId: run.id, issueFingerprint: digest("issues"),
      generation: 1, reviewRevision: 1, status: "completed", model: "fixture", reasoningEffort: "low",
      recommendations: [{ protocol: "automatic-review-2", issueId: ocrIssue.id, recommendation: "accept", confidence: "high",
        candidateIds: [acceptedOcr.id], rationale: "原图与识别结果一致" },
      { protocol: "automatic-review-2", issueId: imageIssue.id, recommendation: "accept", confidence: "high", candidateIds: [photo.id],
        imageAction: "keep", maskCandidateIds: [], rationale: "原图清晰且无水印" }], createdAt: at, finishedAt: at });
    imageItem.derivative = { sha256: sha256(imageBytes), bytes: imageBytes.length, width: 1, height: 1,
      originalSha256: imageInput.ref.sha256, method: "opencv-copy", boundaryCuts: [], outsideMaskChangedPixels: 0,
      automation: { action: "keep", confidence: "high", candidateIds: [] } };

    const awaitingVisualCheck = assessAdmission(run, rows, [], aiReview);
    expect(awaitingVisualCheck).toMatchObject({ images: 0, openIssues: 1 });
    const qualityIssue = awaitingVisualCheck.issues.find(issue => issue.code === "image_requires_review")!;
    const completedReview = knowledgeAiReviewSchema.parse({ ...aiReview, recommendations: [...aiReview.recommendations,
      { protocol: "automatic-review-2", issueId: qualityIssue.id, recommendation: "accept", confidence: "high",
        candidateIds: [photo.id], imageAction: "keep", maskCandidateIds: [], rationale: "副本无修补痕迹且内容完整" }] });
    const admission = assessAdmission(run, rows, [], completedReview);
    expect(admission.candidates.find(row => row.candidateId === acceptedOcr.id)).toMatchObject({ admitted: true, automatic: true });
    expect(admission.candidates.find(row => row.candidateId === watermark.id)).toMatchObject({ admitted: false, decision: "excluded" });
    expect(admission.candidates.find(row => row.candidateId === photo.id)).toMatchObject({ admitted: true, automatic: true });
    expect(admission).toMatchObject({ images: 1, openIssues: 0, gaps: [] });

    const legacyReview = knowledgeAiReviewSchema.parse({ ...completedReview,
      recommendations: completedReview.recommendations.map(({ protocol: _protocol, ...value }) => value) });
    expect(assessAdmission(run, rows, [], legacyReview).candidates.find(row => row.candidateId === acceptedOcr.id))
      .toMatchObject({ decision: "pending", admitted: false });
    const stale = assessAdmission({ ...run, reviewRevision: 2 }, rows, [], aiReview);
    expect(stale.candidates.find(row => row.candidateId === acceptedOcr.id)).toMatchObject({ decision: "pending", admitted: false });
    expect(stale).toMatchObject({ openIssues: 2 });
  });

  it("导出包含真实合格图片并校验全部资源，后续移除输入不残留旧文件", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-artifact-"));
    const rows = items(); await storeBytes(root, imageBytes);
    const decisions = [review(rows, [safe, photo], 1), review(rows, [ocr], 2, { decision: "excluded" })];
    const built = await createArtifact({ pack, run, items: rows, decisions, number: 1, artifactPath: root });
    const files = await validateArtifact(built.zip, built.artifact.resources, built.artifact.format, built.artifact.skillName);
    const photoFile = Object.entries(files).find(([name]) => name.endsWith(".png"))!;
    expect(sha256(photoFile[1])).toBe(sha256(imageBytes));
    await expect(validateArtifact(built.zip, built.artifact.resources.map(resource => ({ ...resource, bytes: 0 })),
      built.artifact.format, built.artifact.skillName)).rejects.toThrow("校验失败");
    const changed = await createArtifact({ pack, run, items: [rows[0]!], decisions, number: 2, artifactPath: root, previous: built.artifact });
    expect(changed.artifact).toMatchObject({ images: 0, changes: { added: 0, modified: 0, removed: 1 } });
    expect(changed.artifact.resources.some(row => row.path === photoFile[0])).toBe(false);
  });
});
