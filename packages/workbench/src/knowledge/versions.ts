import { knowledgeVersions } from "@domain-analysis/db";
import type { KnowledgeAiReview, KnowledgeDecision, KnowledgeItem, KnowledgeRun } from "@domain-analysis/shared";
import { eq } from "drizzle-orm";
import { assessAdmission } from "./admission";
import { validateArtifact } from "./artifact";
import { assertReviewable } from "./review";
import { asVersion, assertRevision, createId, enqueue, KnowledgeProcessingError, loadBytes, lockPack, lockRun,
  digest, readLatestAiReview, readPackVersions, readRunContent, requireValue, sha256, timestamp, type KnowledgeContext } from "./storage";

export async function buildVersion(context: KnowledgeContext, packId: string, runId: string, expectedRevision: number) {
  return context.db.transaction(async tx => {
    const pack = await lockPack(tx, packId, expectedRevision);
    const run = await lockRun(tx, packId, runId);
    assertReviewable(run.status);
    const content = await readRunContent(tx, runId);
    const aiReview = await readLatestAiReview(tx, runId);
    const admission = assessAdmission(run, content.items, content.decisions, aiReview);
    if (admission.gaps.length) throw new KnowledgeProcessingError("invalid_input", admission.gaps.join("；"));
    const inputHash = versionInputHash(run, content.items, content.decisions, aiReview);
    const versions = await readPackVersions(tx, packId);
    if (versions.some(row => row.status === "building")) throw new KnowledgeProcessingError("conflict", "此知识包已有版本正在生成");
    if (versions.some(row => ["ready", "published"].includes(row.status) && row.runId === runId
      && row.packRevision === pack.revision && row.generation === run.generation
      && row.reviewRevision === run.reviewRevision && row.inputHash === inputHash)) {
      throw new KnowledgeProcessingError("conflict", "当前加工与审核结果已经生成版本");
    }
    const [row] = await tx.insert(knowledgeVersions).values({ id: createId("version"), packId, runId,
      number: (versions[0]?.number ?? 0) + 1, packRevision: pack.revision,
      generation: run.generation, reviewRevision: run.reviewRevision, inputHash, status: "building" }).returning();
    await enqueue(tx, { kind: "build", versionId: row!.id });
    return asVersion(row!);
  });
}

export async function publishVersion(context: KnowledgeContext, packId: string, versionId: string, expectedRevision: number) {
  const version = await ownedVersion(context, packId, versionId);
  const artifact = requireValue(version.artifact, "版本尚无成品");
  const bytes = await loadBytes(context.artifactPath, artifact.sha256);
  if (sha256(bytes) !== artifact.sha256) throw new KnowledgeProcessingError("invalid_input", "成品哈希校验失败");
  await validateArtifact(bytes, artifact.resources, artifact.format, artifact.skillName);
  return context.db.transaction(async tx => {
    const pack = await lockPack(tx, packId, expectedRevision);
    const run = await lockRun(tx, packId, version.runId);
    const [row] = await tx.select().from(knowledgeVersions).where(eq(knowledgeVersions.id, versionId)).for("update");
    if (row?.status === "published") return asVersion(row);
    if (row?.status !== "ready") throw new KnowledgeProcessingError("conflict", "只有校验完成的版本可以发布");
    assertRevision(pack.revision, version.packRevision);
    assertRevision(run.generation, version.generation);
    assertRevision(run.reviewRevision, version.reviewRevision);
    assertReviewable(run.status);
    const content = await readRunContent(tx, run.id);
    const aiReview = await readLatestAiReview(tx, run.id);
    if (versionInputHash(run, content.items, content.decisions, aiReview) !== version.inputHash
      || assessAdmission(run, content.items, content.decisions, aiReview).gaps.length) {
      throw new KnowledgeProcessingError("conflict", "入包审核已更新，请重新生成版本");
    }
    const [published] = await tx.update(knowledgeVersions).set({ status: "published", publishedAt: timestamp() })
      .where(eq(knowledgeVersions.id, versionId)).returning();
    return asVersion(published!);
  });
}

export function versionInputHash(run: KnowledgeRun, items: KnowledgeItem[], decisions: KnowledgeDecision[], aiReview?: KnowledgeAiReview) {
  const currentReview = aiReview?.status === "completed" && aiReview.generation === run.generation
    && aiReview.reviewRevision === run.reviewRevision ? aiReview : undefined;
  return digest({ sourceInputHash: run.inputHash, generation: run.generation, reviewRevision: run.reviewRevision,
    decisions: [...decisions].sort((a, b) => a.revision - b.revision),
    aiRecommendations: currentReview?.recommendations.slice().sort((a, b) => a.issueId.localeCompare(b.issueId)) ?? [],
    derivatives: items.filter(item => item.derivative).map(item => ({ itemId: item.id, derivative: item.derivative }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId)) });
}

export async function readVersionFile(context: KnowledgeContext, packId: string, versionId: string, file?: string) {
  const version = await ownedVersion(context, packId, versionId);
  if (!file && version.status !== "published") throw new KnowledgeProcessingError("conflict", "发布后可下载完整成品包");
  if (!["ready", "published"].includes(version.status)) throw new KnowledgeProcessingError("conflict", "成品尚未就绪");
  const artifact = requireValue(version.artifact);
  const bytes = await loadBytes(context.artifactPath, artifact.sha256);
  if (sha256(bytes) !== artifact.sha256) throw new KnowledgeProcessingError("invalid_input", "成品哈希校验失败");
  if (!file) return { bytes, mediaType: "application/zip",
    filename: `${artifact.skillName ?? packId}-v${version.number}.zip` };
  const resource = artifact.resources.find(row => row.path === file);
  if (!resource && !(artifact.format === "data-package-2" && file === "datapackage.json")) {
    throw new KnowledgeProcessingError("not_found", "预览文件不在版本资源清单中");
  }
  const files = await validateArtifact(bytes, artifact.resources, artifact.format, artifact.skillName);
  return { bytes: requireValue(files[file]), mediaType: resource?.mediatype ?? "application/json",
    filename: file.split("/").at(-1)! };
}

async function ownedVersion(context: KnowledgeContext, packId: string, id: string) {
  const [row] = await context.db.select().from(knowledgeVersions).where(eq(knowledgeVersions.id, id));
  const version = asVersion(requireValue(row));
  if (version.packId !== packId) throw new KnowledgeProcessingError("not_found", "此版本不属于当前知识包");
  return version;
}
