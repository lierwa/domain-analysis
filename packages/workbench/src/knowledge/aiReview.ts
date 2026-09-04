import { knowledgeAiReviews, knowledgeItems, knowledgeRuns } from "@domain-analysis/db";
import { knowledgeAiRecommendationSchema, type KnowledgeAiRecommendation,
  type KnowledgeItem, type KnowledgeReviewIssue } from "@domain-analysis/shared";
import { and, eq } from "drizzle-orm";
import { assessAdmission, candidateIndex } from "./admission";
import { asAiReview, createId, digest, KnowledgeProcessingError, loadBytes, lockRun,
  enqueue, readPack, readRun, readRunContent, timestamp, type KnowledgeContext } from "./storage";

const aiIssueCodes = new Set<KnowledgeReviewIssue["code"]>([
  "unstructured_content", "ocr_requires_review", "image_requires_processing",
  "image_requires_review", "conflicting_values",
]);

export async function startAiReview(context: KnowledgeContext, packId: string, runId: string, expectedRevision: number) {
  if (!context.aiReviewer) throw new KnowledgeProcessingError("unavailable", "当前没有配置自动判断运行时");
  const run = await readRun(context.db, packId, runId);
  if (run.status !== "completed") throw new KnowledgeProcessingError("conflict", "加工完成后才能进行自动判断");
  const content = await readRunContent(context.db, runId);
  const issues = assessAdmission(run, content.items, content.decisions).issues.filter(issue =>
    issue.status === "open" && aiIssueCodes.has(issue.code));
  if (!issues.length) throw new KnowledgeProcessingError("invalid_input", "当前没有适合自动判断的问题");
  const issueFingerprint = fingerprint(issues, content.items);
  const [existingRow] = await context.db.select().from(knowledgeAiReviews).where(and(
    eq(knowledgeAiReviews.runId, runId), eq(knowledgeAiReviews.issueFingerprint, issueFingerprint)));
  const existing = existingRow ? asAiReview(existingRow) : undefined;
  if (existing?.issueFingerprint === issueFingerprint && existing.status !== "failed"
    && existing.generation === run.generation && existing.reviewRevision === run.reviewRevision) return existing;
  return context.db.transaction(async tx => {
    const locked = await lockRun(tx, packId, runId, expectedRevision);
    if (locked.generation !== run.generation) throw new KnowledgeProcessingError("conflict", "加工记录已更新，请刷新后继续");
    const [row] = existing?.issueFingerprint === issueFingerprint
      ? await tx.update(knowledgeAiReviews).set({ status: "queued", startedAt: null, finishedAt: null, error: null,
        generation: run.generation, reviewRevision: run.reviewRevision, recommendations: [] })
        .where(eq(knowledgeAiReviews.id, existing.id)).returning()
      : await tx.insert(knowledgeAiReviews).values({ id: createId("ai-review"), runId,
        issueFingerprint, generation: run.generation, reviewRevision: run.reviewRevision, status: "queued",
        model: context.aiReviewer!.identity.model, reasoningEffort: context.aiReviewer!.identity.reasoningEffort,
        recommendations: [] }).returning();
    const review = asAiReview(row!);
    await enqueue(tx, { kind: "ai_review", reviewId: review.id });
    return review;
  });
}

export async function executeAiReview(context: KnowledgeContext, reviewId: string) {
  const [started] = await context.db.update(knowledgeAiReviews).set({ status: "running", startedAt: timestamp(), error: null })
    .where(and(eq(knowledgeAiReviews.id, reviewId), eq(knowledgeAiReviews.status, "queued"))).returning();
  if (!started || !context.aiReviewer) return;
  const review = asAiReview(started);
  try {
    const run = await readRunById(context, review.runId);
    const [pack, content] = await Promise.all([readPack(context.db, run.packId), readRunContent(context.db, run.id)]);
    const issues = assessAdmission(run, content.items, content.decisions).issues.filter(issue =>
      issue.status === "open" && aiIssueCodes.has(issue.code));
    if (fingerprint(issues, content.items) !== review.issueFingerprint) {
      throw new KnowledgeProcessingError("conflict", "待判断问题已经变化，请重新运行自动判断");
    }
    const recommendations: KnowledgeAiRecommendation[] = [];
    await reviewIssueBatches(context, pack, issues, content.items, review.id, recommendations);
    const [latestRun] = await context.db.select().from(knowledgeRuns).where(eq(knowledgeRuns.id, run.id));
    if (!latestRun || latestRun.reviewRevision !== review.reviewRevision || latestRun.generation !== review.generation) {
      throw new KnowledgeProcessingError("conflict", "自动判断期间问题已更新，请重新运行");
    }
    const finalized = await applyAutomaticImages(context, content.items, issues, recommendations);
    recommendations.splice(0, recommendations.length, ...finalized);
    const qualityIssues = assessAdmission(run, content.items, content.decisions,
      { ...review, status: "completed", recommendations, finishedAt: timestamp() }).issues.filter(issue =>
      issue.status === "open" && issue.code === "image_requires_review"
      && !recommendations.some(value => value.issueId === issue.id));
    await reviewIssueBatches(context, pack, qualityIssues, content.items, review.id, recommendations);
    const [finalRun] = await context.db.select().from(knowledgeRuns).where(eq(knowledgeRuns.id, run.id));
    if (!finalRun || finalRun.reviewRevision !== review.reviewRevision || finalRun.generation !== review.generation) {
      throw new KnowledgeProcessingError("conflict", "自动判断期间问题已更新，请重新运行");
    }
    await context.db.update(knowledgeAiReviews).set({ status: "completed", recommendations, finishedAt: timestamp() })
      .where(eq(knowledgeAiReviews.id, review.id));
  } catch (error) {
    await context.db.update(knowledgeAiReviews).set({ status: "failed", finishedAt: timestamp(),
      error: error instanceof Error ? error.message.slice(0, 2_000) : "自动判断失败" })
      .where(eq(knowledgeAiReviews.id, review.id));
  }
}

async function reviewIssueBatches(context: KnowledgeContext, pack: { name: string; scope: string },
  issues: KnowledgeReviewIssue[], items: KnowledgeItem[], reviewId: string, recommendations: KnowledgeAiRecommendation[]) {
  for (const batch of issueBatches(issues)) {
    const input = await buildInput(context, pack, batch, items);
    recommendations.push(...await context.aiReviewer!.review(input));
    await context.db.update(knowledgeAiReviews).set({ recommendations }).where(eq(knowledgeAiReviews.id, reviewId));
  }
}

function issueBatches(issues: KnowledgeReviewIssue[]) {
  const batches: KnowledgeReviewIssue[][] = [];
  let current: KnowledgeReviewIssue[] = [];
  let imageItems = new Set<string>();
  for (const issue of issues) {
    const nextImages = new Set([...imageItems, ...issue.itemIds]);
    if (current.length && (current.length >= 32 || nextImages.size > 16)) {
      batches.push(current); current = []; imageItems = new Set();
    }
    current.push(issue);
    for (const id of issue.itemIds) imageItems.add(id);
  }
  if (current.length) batches.push(current);
  return batches;
}

async function readRunById(context: KnowledgeContext, runId: string) {
  const [row] = await context.db.select().from(knowledgeRuns).where(eq(knowledgeRuns.id, runId));
  if (!row) throw new KnowledgeProcessingError("not_found", "加工记录不存在");
  return readRun(context.db, row.packId, runId);
}

async function buildInput(context: KnowledgeContext, pack: { name: string; scope: string },
  issues: KnowledgeReviewIssue[], items: KnowledgeItem[]) {
  const index = candidateIndex(items);
  const attachments: Array<{ type: "image"; url: string }> = [];
  const imageSlots = new Map<string, number>();
  async function attach(hash: string, mediaType: string, bytes: Promise<Uint8Array>) {
    const existing = imageSlots.get(hash);
    if (existing) return existing;
    const slot = attachments.length + 1;
    attachments.push({ type: "image", url: `data:${mediaType};base64,${Buffer.from(await bytes).toString("base64")}` });
    imageSlots.set(hash, slot);
    return slot;
  }
  const prepared = [];
  for (const issue of issues) {
    const slots: string[] = [];
    for (const item of items.filter(row => issue.itemIds.includes(row.id) && row.input.format === "image")) {
      const original = await attach(item.input.ref.sha256, item.input.mediaType,
        context.sources.readProcessingInput(item.input.ref).then(value => value.bytes));
      slots.push(`image-${original}: ${item.input.subjectName} 原图`);
      if (item.derivative) {
        const derivative = await attach(item.derivative.sha256, "image/png", loadBytes(context.artifactPath, item.derivative.sha256));
        slots.push(`image-${derivative}: ${item.input.subjectName} 处理副本`);
      }
    }
    const evidenceIds = new Set(issue.candidateIds);
    if (issue.code === "image_requires_processing") {
      for (const item of items.filter(row => issue.itemIds.includes(row.id))) {
        for (const candidate of item.result?.candidates ?? []) {
          if (candidate.kind === "text" && candidate.locator.startsWith("OCR line ")) evidenceIds.add(candidate.id);
        }
      }
    }
    prepared.push({ ...issue, humanRequired: issue.code === "conflicting_values",
      candidates: [...evidenceIds].flatMap(id => {
        const value = index.get(id);
        return value ? [{ id, subject: value.item.input.subjectName, label: value.candidate.label,
          text: value.candidate.text, locator: value.candidate.locator, sourceUrl: value.item.input.url,
          confidence: value.candidate.confidence, box: value.candidate.box }] : [];
      }), imageSlots: slots });
  }
  return { pack, issues: prepared, attachments };
}

async function applyAutomaticImages(context: KnowledgeContext, items: KnowledgeItem[], issues: KnowledgeReviewIssue[],
  values: KnowledgeAiRecommendation[]) {
  const recommendations = new Map(values.map(value => [value.issueId, knowledgeAiRecommendationSchema.parse(value)]));
  for (const issue of issues.filter(value => value.code === "image_requires_processing")) {
    const recommendation = recommendations.get(issue.id);
    if (recommendation?.protocol !== "automatic-review-2" || recommendation.confidence !== "high"
      || !["keep", "remove_watermark"].includes(recommendation.imageAction ?? "")) continue;
    const item = items.find(value => issue.itemIds.includes(value.id) && value.input.format === "image");
    if (!item) throw new KnowledgeProcessingError("invalid_input", "AI 图片判断没有对应原件");
    const candidates = item.result?.candidates ?? [];
    const masks = (recommendation.maskCandidateIds ?? []).map(id => {
      const candidate = candidates.find(value => value.id === id && value.kind === "text");
      if (!candidate) throw new KnowledgeProcessingError("invalid_input", "AI 去水印引用了范围外 OCR 坐标");
      return candidate;
    });
    try {
      const { bytes } = await context.sources.readProcessingInput(item.input.ref);
      const derivative = await context.processor.prepareAutomatic(item.input, bytes,
        recommendation.imageAction as "keep" | "remove_watermark", masks, AbortSignal.timeout(120_000));
      const result = item.result ? { ...item.result, candidates: item.result.candidates.map(candidate =>
        issue.candidateIds.includes(candidate.id) && candidate.kind === "image"
          ? { ...candidate, contentHash: derivative.sha256 } : candidate) } : undefined;
      // WHY：处理副本的哈希成为图片内容版本；旧副本上的人工决定不能自动继承到新像素。
      item.derivative = derivative; item.result = result;
      await context.db.update(knowledgeItems).set({ derivative, result }).where(eq(knowledgeItems.id, item.id));
    } catch (error) {
      // WHY：批量产线不能因一张图的安全处理门失败而卡住；失败图自动隔离并保留原件供审计。
      recommendations.set(issue.id, { ...recommendation, recommendation: "exclude", confidence: "low",
        imageAction: "exclude", maskCandidateIds: [], rationale: `图片自动处理失败，已隔离：${error instanceof Error ? error.message : "未知错误"}` });
    }
  }
  return values.map(value => recommendations.get(value.issueId) ?? value);
}

function fingerprint(issues: KnowledgeReviewIssue[], items: KnowledgeItem[]) {
  const index = candidateIndex(items);
  return digest({ protocol: "automatic-review-2", issues: issues.map(issue => ({ id: issue.id,
    candidates: issue.candidateIds.map(id => [id, index.get(id)?.candidate.contentHash]),
    derivatives: issue.itemIds.map(id => items.find(item => item.id === id)?.derivative?.sha256 ?? null) })) });
}
