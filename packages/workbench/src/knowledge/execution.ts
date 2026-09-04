import { knowledgeItems, knowledgeRuns, knowledgeVersions } from "@domain-analysis/db";
import { knowledgeCommandSchema, type KnowledgeCommand, type KnowledgeItem, type KnowledgeRun } from "@domain-analysis/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { createArtifact } from "./artifact";
import { executeAiReview, startAiReview } from "./aiReview";
import { asRun, asVersion, KnowledgeProcessingError, lockPack, lockRun, readPack, readPackVersions,
  readLatestAiReview, readRunContent, storeBytes, timestamp, type KnowledgeContext } from "./storage";
import { versionInputHash } from "./versions";

export async function executeKnowledgeCommand(context: KnowledgeContext, value: unknown) {
  const command = knowledgeCommandSchema.parse(value);
  const id = command.kind === "extract" ? command.runId
    : command.kind === "build" ? command.versionId : command.reviewId;
  const lease = await acquireLease(context, id);
  if (!lease) return;
  try {
    if (command.kind === "extract") await executeExtraction(context, command);
    else if (command.kind === "build") await executeBuild(context, command.versionId);
    else await executeAiReview(context, command.reviewId);
  } finally { lease.release(true); }
}

async function executeExtraction(context: KnowledgeContext, command: Extract<KnowledgeCommand, { kind: "extract" }>) {
  const [started] = await context.db.update(knowledgeRuns).set({ status: "running", startedAt: timestamp(), error: null })
    .where(and(eq(knowledgeRuns.id, command.runId), eq(knowledgeRuns.generation, command.generation),
      eq(knowledgeRuns.status, "queued"))).returning();
  if (!started) return;
  const run = asRun(started);
  const stopping = new AbortController();
  const polling = setInterval(() => {
    void context.db.select({ stop: knowledgeRuns.stopRequested }).from(knowledgeRuns).where(eq(knowledgeRuns.id, run.id))
      .then(rows => { if (rows[0]?.stop) stopping.abort(); }).catch(() => stopping.abort());
  }, 500);
  try {
    if (run.toolVersion !== await context.processor.version()) throw new KnowledgeProcessingError("conflict", "加工工具版本已更新，请按当前批次重新加工");
    const { items } = await readRunContent(context.db, run.id);
    for (const item of items.filter(row => row.status !== "completed")) {
      if (stopping.signal.aborted) break;
      // WHY：预算限制单份异常原件，不能让一个固定总时长截断整批生产。
      const itemSignal = AbortSignal.any([stopping.signal,
        AbortSignal.timeout(run.settings.budgetSeconds * 1_000)]);
      await executeItem(context, run, item, itemSignal);
    }
    const content = await readRunContent(context.db, run.id);
    const complete = content.items.filter(row => row.status === "completed").length;
    const status = stopping.signal.aborted ? "stopped" : complete === content.items.length ? "completed" : complete > 0 ? "partial" : "failed";
    await context.db.update(knowledgeRuns).set({ status, stage: "review", finishedAt: timestamp(),
      error: stopping.signal.aborted ? "本次加工已停止；已完成结果保留，可继续处理剩余原料" : null })
      .where(eq(knowledgeRuns.id, run.id));
    if (status === "completed" && context.aiReviewer) await queueAutomaticReview(context, run);
  } catch {
    await context.db.update(knowledgeRuns).set({ status: "failed", stage: "review", finishedAt: timestamp(),
      error: "加工执行中断；已保存的原料结果可在重试时继续使用" }).where(eq(knowledgeRuns.id, run.id));
  } finally { clearInterval(polling); }
}

async function queueAutomaticReview(context: KnowledgeContext, run: KnowledgeRun) {
  try {
    await startAiReview(context, run.packId, run.id, run.reviewRevision);
  } catch (error) {
    if (error instanceof KnowledgeProcessingError && error.code === "invalid_input") return;
    await context.db.update(knowledgeRuns).set({ error: "自动判断未能启动；原料加工结果已保留" })
      .where(eq(knowledgeRuns.id, run.id));
  }
}

async function executeItem(context: KnowledgeContext, run: KnowledgeRun, item: KnowledgeItem, signal: AbortSignal) {
  const startedAt = timestamp();
  await context.db.update(knowledgeItems).set({ status: "running", error: null }).where(eq(knowledgeItems.id, item.id));
  try {
    const { bytes } = await context.sources.readProcessingInput(item.input.ref);
    signal.throwIfAborted();
    const result = await context.processor.extract(item.input, bytes, run.settings, signal);
    signal.throwIfAborted();
    const finishedAt = timestamp();
    await context.db.update(knowledgeItems).set({ status: "completed", result, attempts: [...item.attempts,
      { startedAt, finishedAt, status: "completed", seconds: elapsed(startedAt, finishedAt) }] })
      .where(eq(knowledgeItems.id, item.id));
  } catch (error) {
    const finishedAt = timestamp();
    const message = error instanceof KnowledgeProcessingError ? error.message : signal.aborted
      ? "达到处理预算或收到停止请求" : "原料处理失败，请检查原件格式与本地处理环境";
    await context.db.update(knowledgeItems).set({ status: "failed", error: message, attempts: [...item.attempts,
      { startedAt, finishedAt, status: signal.aborted ? "stopped" : "failed", seconds: elapsed(startedAt, finishedAt), error: message }] })
      .where(eq(knowledgeItems.id, item.id));
  }
}

async function executeBuild(context: KnowledgeContext, versionId: string) {
  const [row] = await context.db.select().from(knowledgeVersions).where(eq(knowledgeVersions.id, versionId));
  if (!row || row.status !== "building") return;
  const version = asVersion(row);
  await context.db.update(knowledgeVersions).set({ startedAt: timestamp() }).where(eq(knowledgeVersions.id, versionId));
  try {
    const pack = await readPack(context.db, version.packId);
    const [runRow] = await context.db.select().from(knowledgeRuns).where(eq(knowledgeRuns.id, version.runId));
    if (!runRow) throw new KnowledgeProcessingError("not_found", "加工记录不存在");
    const run = asRun(runRow);
    const content = await readRunContent(context.db, run.id);
    const aiReview = await readLatestAiReview(context.db, run.id);
    if (versionInputHash(run, content.items, content.decisions, aiReview) !== version.inputHash) {
      throw new KnowledgeProcessingError("conflict", "自动判断结果已更新，请按当前内容重新生成版本");
    }
    const versions = await readPackVersions(context.db, pack.id);
    const previous = versions.find(value => value.number < version.number && value.status === "published")?.artifact;
    const { zip, artifact } = await createArtifact({ pack, run, ...content, aiReview,
      number: version.number, artifactPath: context.artifactPath, previous });
    await storeBytes(context.artifactPath, zip);
    await context.db.transaction(async tx => {
      const latestPack = await lockPack(tx, pack.id);
      const latest = await lockRun(tx, pack.id, run.id);
      const latestContent = await readRunContent(tx, run.id);
      const latestAiReview = await readLatestAiReview(tx, run.id);
      if (latestPack.revision !== version.packRevision || latest.reviewRevision !== version.reviewRevision
        || latest.generation !== version.generation
        || versionInputHash(latest, latestContent.items, latestContent.decisions, latestAiReview) !== version.inputHash) {
        throw new KnowledgeProcessingError("conflict", "选料或审核已更新，请按当前内容重新生成版本");
      }
      await tx.update(knowledgeVersions).set({ status: "ready", artifact }).where(eq(knowledgeVersions.id, version.id));
    });
  } catch (error) {
    await context.db.update(knowledgeVersions).set({ status: "failed", error: error instanceof KnowledgeProcessingError
      ? error.message : "版本生成失败，请检查本地成品存储与资源完整性" }).where(eq(knowledgeVersions.id, versionId));
  }
}

export async function recoverKnowledgeProcessing(context: KnowledgeContext) {
  const [runs, versions] = await Promise.all([
    context.db.select().from(knowledgeRuns).where(inArray(knowledgeRuns.status, ["running"])),
    context.db.select().from(knowledgeVersions).where(and(eq(knowledgeVersions.status, "building"), isNotNull(knowledgeVersions.startedAt))),
  ]);
  const recovered: string[] = [];
  for (const row of [...runs, ...versions]) {
    const lease = await acquireLease(context, row.id);
    if (!lease) continue;
    try {
      // WHY：只收敛没有存活执行者的记录；数据库会在进程退出时释放会话锁。
      if ("stage" in row) {
        await context.db.update(knowledgeRuns).set({ status: "stopped", stage: "review", finishedAt: timestamp(),
          error: "加工进程已退出；可继续处理剩余原料" }).where(and(eq(knowledgeRuns.id, row.id), eq(knowledgeRuns.status, "running")));
        recovered.push(row.id);
      }
      else {
        await context.db.update(knowledgeVersions).set({ status: "failed", error: "建包进程已退出，请重新生成此版本" })
          .where(and(eq(knowledgeVersions.id, row.id), eq(knowledgeVersions.status, "building")));
        recovered.push(row.id);
      }
    } finally { lease.release(true); }
  }
  return recovered;
}

async function acquireLease(context: KnowledgeContext, id: string) {
  const client = await context.db.$client.connect();
  try {
    const result = await client.query<{ acquired: boolean }>("select pg_try_advisory_lock(hashtext($1),hashtext($2)) acquired", ["knowledge-processing", id]);
    if (result.rows[0]?.acquired) return client;
    client.release(true);
    return undefined;
  } catch (error) { client.release(true); throw error; }
}
function elapsed(start: string, finish: string) { return (Date.parse(finish) - Date.parse(start)) / 1_000; }
