import { knowledgeItems, knowledgePacks, knowledgeRuns, type WorkbenchDb } from "@domain-analysis/db";
import { knowledgePackCreateSchema, knowledgeSelectionRequestSchema, knowledgeRunViewSchema,
  type KnowledgeBatchRef, type KnowledgeInput } from "@domain-analysis/shared";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { ProcessingInputReader } from "./sourceDatasetProcessingInputs";
import { assessAdmission } from "./knowledge/admission";
import { startAiReview } from "./knowledge/aiReview";
import type { KnowledgeAiReviewer } from "./knowledge/aiReviewer";
import { createKnowledgeProcessor, type KnowledgeProcessorOptions } from "./knowledge/processor";
import { recordReview } from "./knowledge/review";
import { buildVersion, publishVersion, readVersionFile, versionInputHash } from "./knowledge/versions";
import { executeKnowledgeCommand, recoverKnowledgeProcessing } from "./knowledge/execution";
import { asPack, asRun, createId, digest, enqueue, KnowledgeProcessingError, lockPack, lockRun,
  loadBytes, readLatestAiReview, readPack, readPackVersions, readRun, readRunContent, requireValue, timestamp, type KnowledgeContext } from "./knowledge/storage";

export type KnowledgeProcessingModule = ReturnType<typeof createKnowledgeProcessingModule>;
export type KnowledgeProcessingOptions = KnowledgeProcessorOptions & { aiReviewer?: KnowledgeAiReviewer };
export { KnowledgeProcessingError } from "./knowledge/storage";

export function createKnowledgeProcessingModule(db: WorkbenchDb, sources: ProcessingInputReader,
  options: KnowledgeProcessingOptions) {
  const context: KnowledgeContext = { db, sources, artifactPath: options.artifactPath,
    processor: createKnowledgeProcessor(options), aiReviewer: options.aiReviewer };
  return {
    async capabilities() { return { ...(await context.processor.capabilities()), aiReview: !!context.aiReviewer }; },
    list: async () => (await db.select().from(knowledgePacks).orderBy(desc(knowledgePacks.updatedAt))).map(asPack),
    async create(value: z.input<typeof knowledgePackCreateSchema>) {
      const input = knowledgePackCreateSchema.parse(value);
      const capabilities = await context.processor.capabilities();
      const [row] = await db.insert(knowledgePacks).values({ id: createId("pack"), ...input,
        selection: [], settings: { ocr: capabilities.ocr, budgetSeconds: 120, requiredInputKeys: [] } }).returning();
      return asPack(row!);
    },
    async get(packId: string) {
      const [pack, runs, versions] = await Promise.all([readPack(db, packId),
        db.select().from(knowledgeRuns).where(eq(knowledgeRuns.packId, packId)).orderBy(desc(knowledgeRuns.createdAt)),
        readPackVersions(db, packId)]);
      return { pack, runs: runs.map(asRun), versions };
    },
    async select(packId: string, value: z.input<typeof knowledgeSelectionRequestSchema>) {
      const input = knowledgeSelectionRequestSchema.parse(value);
      if (new Set(input.selection.map(row => row.batchId)).size !== input.selection.length
        || new Set(input.selection.map(row => row.taskId)).size !== 1) {
        throw new KnowledgeProcessingError("invalid_input", "当前知识包须选择同一抓取任务下的不重复批次");
      }
      await resolveInputs(context, input.selection);
      const capabilities = await context.processor.capabilities();
      return db.transaction(async tx => {
        const pack = await lockPack(tx, packId, input.expectedRevision);
        const [row] = await tx.update(knowledgePacks).set({ skillName: input.skillName,
          selection: [...input.selection].sort((a, b) => a.batchId.localeCompare(b.batchId)),
          settings: { ocr: capabilities.ocr, budgetSeconds: 120, requiredInputKeys: [] },
          revision: pack.revision + 1, selectionRevision: pack.selectionRevision + 1,
          updatedAt: timestamp() }).where(eq(knowledgePacks.id, packId)).returning();
        return asPack(row!);
      });
    },
    start: (packId: string, expectedRevision: number) => startRun(context, packId, expectedRevision),
    async run(packId: string, runId: string) {
      const run = await readRun(db, packId, runId);
      const content = await readRunContent(db, runId);
      const latestAiReview = await readLatestAiReview(db, runId);
      const aiReview = latestAiReview?.generation === run.generation
        && latestAiReview.reviewRevision === run.reviewRevision ? latestAiReview : undefined;
      const assessed = assessAdmission(run, content.items, content.decisions, aiReview);
      const { issues, ...admission } = assessed;
      return knowledgeRunViewSchema.parse({ run, ...content, admission, issues,
        versionInputHash: versionInputHash(run, content.items, content.decisions, aiReview), aiReview });
    },
    async stop(packId: string, runId: string) {
      return db.transaction(async tx => {
        const run = await lockRun(tx, packId, runId);
        if (!["queued", "running"].includes(run.status)) return run;
        const [row] = await tx.update(knowledgeRuns).set({ stopRequested: true,
          ...(run.status === "queued" ? { status: "stopped" as const, finishedAt: timestamp() } : {}) })
          .where(eq(knowledgeRuns.id, runId)).returning();
        return asRun(row!);
      });
    },
    retry: (packId: string, runId: string, expectedGeneration: number) => retryRun(context, packId, runId, expectedGeneration),
    review: (packId: string, runId: string, value: Parameters<typeof recordReview>[3]) => recordReview(context, packId, runId, value),
    startAiReview: (packId: string, runId: string, expectedRevision: number) =>
      startAiReview(context, packId, runId, expectedRevision),
    async readImage(packId: string, runId: string, itemId: string) {
      await readRun(db, packId, runId);
      const { items } = await readRunContent(db, runId);
      const item = requireValue(items.find(row => row.id === itemId));
      return loadBytes(context.artifactPath, requireValue(item.derivative, "图片尚未处理").sha256);
    },
    buildVersion: (packId: string, runId: string, expectedRevision: number) => buildVersion(context, packId, runId, expectedRevision),
    publishVersion: (packId: string, versionId: string, expectedRevision: number) => publishVersion(context, packId, versionId, expectedRevision),
    readVersionFile: (packId: string, versionId: string, file?: string) => readVersionFile(context, packId, versionId, file),
    execute: (command: unknown) => executeKnowledgeCommand(context, command),
    recoverInterrupted: () => recoverKnowledgeProcessing(context),
  };
}

async function resolveInputs(context: KnowledgeContext, selection: KnowledgeBatchRef[]) {
  const byKey = new Map<string, KnowledgeInput>();
  for (const ref of selection) {
    const batch = await context.sources.readProcessingBatch(ref);
    for (const input of batch.inputs) byKey.set(input.key, input);
  }
  if (byKey.size > 20_000) throw new KnowledgeProcessingError("invalid_input", "单次加工最多包含 20000 份已准入原件");
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function startRun(context: KnowledgeContext, packId: string, expectedRevision: number) {
  const initial = await readPack(context.db, packId);
  const inputs = await resolveInputs(context, initial.selection);
  const toolVersion = await context.processor.version();
  if (!inputs.length) throw new KnowledgeProcessingError("invalid_input", "请先选择加工原料");
  if (initial.settings.ocr && !(await context.processor.capabilities()).ocr) {
    throw new KnowledgeProcessingError("unavailable", "请配置本地 OCR 模型后开始加工");
  }
  return context.db.transaction(async tx => {
    const pack = await lockPack(tx, packId, expectedRevision);
    // WHY：原料校验在事务外执行；进入提交点后再次核对同一份草稿，避免选料竞态。
    if (pack.revision !== initial.revision) throw new KnowledgeProcessingError("conflict", "选料已更新，请重新开始加工");
    const [active] = await tx.select().from(knowledgeRuns).where(and(eq(knowledgeRuns.packId, packId),
      inArray(knowledgeRuns.status, ["queued", "running"])));
    if (active) throw new KnowledgeProcessingError("conflict", "此知识包已有加工正在执行");
    const [row] = await tx.insert(knowledgeRuns).values({ id: createId("run"), packId, sourceRevision: pack.selectionRevision,
      inputs, settings: pack.settings, toolVersion, inputHash: digest({ inputs, settings: pack.settings, toolVersion }), stage: "extract", status: "queued" }).returning();
    const run = asRun(row!);
    await tx.insert(knowledgeItems).values(inputs.map(input => ({ id: createId("item"), runId: run.id,
      inputKey: input.key, input, status: "pending" as const, attempts: [] })));
    await enqueue(tx, { kind: "extract", runId: run.id, generation: 1 });
    return run;
  });
}

async function retryRun(context: KnowledgeContext, packId: string, runId: string, expectedGeneration: number) {
  return context.db.transaction(async tx => {
    const pack = await lockPack(tx, packId);
    const run = await lockRun(tx, packId, runId);
    if (run.generation !== expectedGeneration || !["partial", "failed", "stopped"].includes(run.status)) {
      throw new KnowledgeProcessingError("conflict", "当前加工记录已更新或无需重试");
    }
    const [active] = await tx.select().from(knowledgeRuns).where(and(eq(knowledgeRuns.packId, packId),
      inArray(knowledgeRuns.status, ["queued", "running"])));
    if (active) throw new KnowledgeProcessingError("conflict", "此知识包已有加工正在执行");
    await tx.update(knowledgeItems).set({ status: "pending", error: null }).where(and(
      eq(knowledgeItems.runId, runId), ne(knowledgeItems.status, "completed")));
    const [row] = await tx.update(knowledgeRuns).set({ generation: run.generation + 1, status: "queued", stage: "extract",
      stopRequested: false, error: null, startedAt: null, finishedAt: null }).where(eq(knowledgeRuns.id, runId)).returning();
    await tx.update(knowledgePacks).set({ revision: pack.revision + 1, updatedAt: timestamp() }).where(eq(knowledgePacks.id, packId));
    await enqueue(tx, { kind: "extract", runId, generation: run.generation + 1 });
    return asRun(row!);
  });
}
