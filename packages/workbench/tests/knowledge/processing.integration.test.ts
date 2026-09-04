import { knowledgeItems, knowledgeRuns, sourceCollectionRuns, sourceSnapshots } from "@domain-analysis/db";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { createKnowledgeProcessingModule } from "../../src";
import { executeAiReview, startAiReview } from "../../src/knowledge/aiReview";
import { digest, sha256, storeBytes } from "../../src/knowledge/storage";
import type { KnowledgeContext } from "../../src/knowledge/storage";
import { fixture } from "./fixture";

const suite = process.env.POSTGRES_DATABASE_URL ? describe.sequential : describe.skip;
suite("知识加工持久化契约", () => {
  let env: Awaited<ReturnType<typeof fixture>> | undefined;
  afterEach(async () => { await env?.clear(); env = undefined; });

  it("批次只在每个来源的最新执行全部完成时可选", async () => {
    env = await fixture();
    const previous = (await env.db.select().from(sourceCollectionRuns)
      .where(eq(sourceCollectionRuns.id, env.sourceRunId)))[0]!;
    await env.db.insert(sourceCollectionRuns).values({ ...previous, id: `${env.sourceRunId}-retry`,
      status: "failed", resumedFromRunId: env.sourceRunId, startedAt: new Date(Date.now() + 1000).toISOString(),
      finishedAt: new Date(Date.now() + 1000).toISOString(), terminationReason: "fixture failure" });
    await expect(env.sources.readProcessingBatch({ taskId: env.taskId, batchId: env.batchId }))
      .rejects.toThrow("全部来源最新执行均完成");
  });

  it("校验批次归属与原料字节，整个加工链保持原始快照不变", async () => {
    env = await fixture();
    const before = digest(await env.db.select().from(sourceSnapshots).where(eq(sourceSnapshots.runId, env.sourceRunId)));
    const batch = await env.sources.readProcessingBatch({ taskId: env.taskId, batchId: env.batchId });
    expect(batch.total).toBe(2); expect(batch.inputs).toHaveLength(2);
    expect(batch.inputs.every(input => input.availability === "ready" && input.format === "html")).toBe(true);
    await expect(env.sources.readProcessingInput({ ...batch.inputs[0]!.ref, taskId: "another-task" })).rejects.toThrow("身份");
    await expect(env.sources.readProcessingInput({ ...batch.inputs[0]!.ref, sha256: "0".repeat(64) })).rejects.toThrow("哈希");
    const pack = await env.create(); const run = await env.processing.start(pack.id, pack.revision);
    expect(run.sourceRevision).toBe(pack.selectionRevision);
    await env.processing.execute({ kind: "extract", runId: run.id, generation: run.generation });
    const view = await env.processing.run(pack.id, run.id);
    expect(view.run.status).toBe("completed"); expect(view.admission.accepted).toBe(4);
    expect(view.admission).toMatchObject({ autoAccepted: 4, quarantined: 0, openIssues: 0 });
    expect(digest(await env.db.select().from(sourceSnapshots).where(eq(sourceSnapshots.runId, env.sourceRunId)))).toBe(before);
  });

  it("并发开始只提交一个加工记录与队列命令，过期审核不能覆盖最新决定", async () => {
    env = await fixture(); const pack = await env.create();
    const results = await Promise.allSettled([env.processing.start(pack.id, pack.revision), env.processing.start(pack.id, pack.revision)]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    const view = await env.processing.get(pack.id); expect(view.runs).toHaveLength(1);
    const run = view.runs[0]!;
    const jobs = await env.db.$client.query("select id from graphile_worker.jobs where task_identifier='execute_knowledge_processing' and key=$1", [`extract:${run.id}:1`]);
    expect(jobs.rows).toHaveLength(1);
    await env.processing.execute({ kind: "extract", runId: run.id, generation: 1 });
    const content = await env.processing.run(pack.id, run.id);
    const review = { expectedRevision: 0, candidateIds: [content.items[0]!.result!.candidates[0]!.id], decision: "accepted" as const, reason: "已核对原文" };
    await env.processing.review(pack.id, run.id, review);
    await expect(env.processing.review(pack.id, run.id, review)).rejects.toThrow("已更新");
  });

  it("一次 AI 预审覆盖全部语义问题并绑定当前问题修订", async () => {
    env = await fixture(); const pack = await env.create(); const run = await env.processing.start(pack.id, pack.revision);
    await env.processing.execute({ kind: "extract", runId: run.id, generation: 1 });
    const before = await env.processing.run(pack.id, run.id);
    const item = before.items[0]!;
    await env.db.update(knowledgeItems).set({ input: { ...item.input, format: "text" } }).where(eq(knowledgeItems.id, item.id));
    const received: unknown[] = [];
    const processing = createKnowledgeProcessingModule(env.db, env.sources, { ...env.options, aiReviewer: {
      identity: { model: "fixture-reviewer", reasoningEffort: "low" },
      async review(input) { received.push(input); return input.issues.map(issue => ({ protocol: "automatic-review-2" as const, issueId: issue.id,
        recommendation: "accept" as const, confidence: "high" as const,
        candidateIds: issue.candidateIds, rationale: "候选与知识包范围一致" })); },
      async close() {},
    } });
    const review = await processing.startAiReview(pack.id, run.id, 0);
    await processing.execute({ kind: "ai_review", reviewId: review.id });
    const view = await processing.run(pack.id, run.id);
    expect(received).toHaveLength(1);
    expect(view.aiReview).toMatchObject({ status: "completed", model: "fixture-reviewer", reviewRevision: 0 });
    expect(view.aiReview?.recommendations).toHaveLength(1);
    expect((received[0] as { issues: Array<{ code: string }> }).issues.map(issue => issue.code)).toEqual(["unstructured_content"]);
    expect((await processing.startAiReview(pack.id, run.id, 0)).id).toBe(review.id);
  });

  it("加工完成后自动排队语义判断，不要求用户逐项启动", async () => {
    env = await fixture(); const pack = await env.create();
    const processing = createKnowledgeProcessingModule(env.db, env.sources, { ...env.options, aiReviewer: {
      identity: { model: "fixture-reviewer", reasoningEffort: "low" },
      async review(input) { return input.issues.map(issue => ({ protocol: "automatic-review-2" as const, issueId: issue.id,
        recommendation: "accept" as const, confidence: "high" as const,
        candidateIds: issue.candidateIds, rationale: "候选属于知识包范围" })); },
      async close() {},
    } });
    const run = await processing.start(pack.id, pack.revision);
    const [item] = await env.db.select().from(knowledgeItems).where(eq(knowledgeItems.runId, run.id));
    await env.db.update(knowledgeItems).set({ input: { ...item!.input, format: "text" } }).where(eq(knowledgeItems.id, item!.id));

    await processing.execute({ kind: "extract", runId: run.id, generation: 1 });
    let view = await processing.run(pack.id, run.id);
    expect(view.aiReview?.status).toBe("queued");
    await processing.execute({ kind: "ai_review", reviewId: view.aiReview!.id });
    view = await processing.run(pack.id, run.id);
    expect(view.aiReview?.status).toBe("completed");
    expect(view.admission.openIssues).toBe(0);
  });

  it("自动生成图片副本后再做一轮视觉验收", async () => {
    env = await fixture(); const pack = await env.create(); const run = await env.processing.start(pack.id, pack.revision);
    await env.processing.execute({ kind: "extract", runId: run.id, generation: 1 });
    const [stored] = await env.db.select().from(knowledgeItems).where(eq(knowledgeItems.runId, run.id));
    const imageId = digest("automatic-image");
    const input = { ...stored!.input, format: "image" as const, mediaType: "image/png" };
    const result = { ...stored!.result!, candidates: [{ id: imageId, kind: "image" as const, label: "商品图片", text: "",
      locator: "full image", contentHash: input.ref.sha256 }] };
    await env.db.update(knowledgeItems).set({ input, result, derivative: null }).where(eq(knowledgeItems.id, stored!.id));
    const calls: string[][] = [];
    const derivativeBytes = Buffer.from("processed-image");
    const derivativeSha = sha256(derivativeBytes);
    const context: KnowledgeContext = { db: env.db, sources: env.sources, artifactPath: env.options.artifactPath,
      processor: {
        async version() { return "fixture"; },
        async capabilities() { return { imageProcessing: true, ocr: false, aiReview: false, pdf: "review" as const, detail: "fixture" }; },
        async extract() { throw new Error("本测试不执行提取"); },
        async prepareAutomatic(actualInput, _bytes, action) { await storeBytes(env!.options.artifactPath, derivativeBytes);
          return { sha256: derivativeSha, bytes: derivativeBytes.length, width: 10, height: 10,
          originalSha256: actualInput.ref.sha256, method: "opencv-copy" as const, boundaryCuts: [], outsideMaskChangedPixels: 0,
          automation: { action, confidence: "high" as const, candidateIds: [] } }; },
      },
      aiReviewer: { identity: { model: "fixture-reviewer", reasoningEffort: "low" },
        async review(actual) { calls.push(actual.issues.map(issue => issue.code)); return actual.issues.map(issue => ({
          protocol: "automatic-review-2" as const, issueId: issue.id, recommendation: "accept" as const,
          confidence: "high" as const, candidateIds: issue.candidateIds, imageAction: "keep" as const,
          maskCandidateIds: [], rationale: issue.code === "image_requires_review" ? "副本无修补痕迹" : "原图无需修改",
        })); }, async close() {} },
    };

    const review = await startAiReview(context, pack.id, run.id, 0);
    await executeAiReview(context, review.id);
    const view = await env.processing.run(pack.id, run.id);

    expect(view.aiReview?.error).toBeUndefined();
    expect(view.aiReview).toMatchObject({ status: "completed" });
    expect(calls).toEqual([["image_requires_processing"], ["image_requires_review"]]);
    expect(view.aiReview?.recommendations).toHaveLength(2);
    expect(view.admission).toMatchObject({ images: 1, openIssues: 0 });
    expect(view.items.find(item => item.id === stored!.id)).toMatchObject({ derivative: { sha256: derivativeSha, automation: { action: "keep" } },
      result: { candidates: [{ contentHash: derivativeSha }] } });
  });

  it("关联歧义传播到已批准内容，发布前重新检查，历史成品在后续失败后仍可下载", async () => {
    env = await fixture(); const pack = await env.create(); const run = await env.processing.start(pack.id, pack.revision);
    await env.processing.execute({ kind: "extract", runId: run.id, generation: 1 });
    let view = await env.processing.run(pack.id, run.id);
    const ids = view.items.flatMap(row => row.result!.candidates.map(candidate => candidate.id));
    await env.processing.review(pack.id, run.id, { expectedRevision: 0, candidateIds: ids, decision: "accepted", reason: "逐条核对来源原文" });
    const current = await env.processing.get(pack.id);
    const version = await env.processing.buildVersion(pack.id, run.id, current.pack.revision);
    await env.processing.execute({ kind: "build", versionId: version.id });
    expect((await env.processing.get(pack.id)).versions[0]!.status).toBe("ready");
    await expect(env.processing.readVersionFile(pack.id, version.id)).rejects.toThrow("发布后");
    await env.processing.publishVersion(pack.id, version.id, current.pack.revision);
    const first = await env.processing.readVersionFile(pack.id, version.id);
    const files = unzipSync(first.bytes); expect(files[`${current.pack.skillName}/SKILL.md`]).toBeDefined();
    expect(files[`${current.pack.skillName}/assets/data/catalog.json`]).toBeDefined();
    await expect(env.processing.buildVersion(pack.id, run.id, current.pack.revision)).rejects.toThrow("已经生成版本");
    await env.processing.review(pack.id, run.id, { expectedRevision: 1, candidateIds: [ids[0]!], factKey: "共同事实", decision: "pending", reason: "新增依据存在歧义" });
    await env.processing.review(pack.id, run.id, { expectedRevision: 2, candidateIds: [ids[1]!], factKey: "共同事实", decision: "accepted", reason: "关联到同一事实" });
    const second = await env.processing.buildVersion(pack.id, run.id, current.pack.revision);
    await env.processing.execute({ kind: "build", versionId: second.id });
    view = await env.processing.run(pack.id, run.id);
    expect(view.admission.candidates.find(row => row.candidateId === ids[1])?.admitted).toBe(false);
    await env.processing.review(pack.id, run.id, { expectedRevision: 3, candidateIds: [ids[2]!], decision: "pending", reason: "发布前出现新依据" });
    await expect(env.processing.publishVersion(pack.id, second.id, current.pack.revision)).rejects.toThrow("已更新");
    const interrupted = await env.processing.buildVersion(pack.id, run.id, current.pack.revision);
    await env.processing.review(pack.id, run.id, { expectedRevision: 4, candidateIds: [ids[3]!], decision: "pending", reason: "建包期间更新审核" });
    await env.processing.execute({ kind: "build", versionId: interrupted.id });
    expect((await env.processing.get(pack.id)).versions[0]!.status).toBe("failed");
    expect(sha256((await env.processing.readVersionFile(pack.id, version.id)).bytes)).toBe(sha256(first.bytes));
    await expect(env.processing.readVersionFile("another-pack", version.id)).rejects.toThrow("不属于");
    await expect(env.processing.readVersionFile(pack.id, version.id, "../source.html")).rejects.toThrow("资源清单");
  });

  it("排队停止、进程中断与部分失败保留已完成结果，重试使用同一冻结输入", async () => {
    env = await fixture(); const pack = await env.create();
    let run = await env.processing.start(pack.id, pack.revision);
    await env.processing.stop(pack.id, run.id);
    await env.processing.execute({ kind: "extract", runId: run.id, generation: 1 });
    expect((await env.processing.run(pack.id, run.id)).items.every(row => row.status === "pending")).toBe(true);
    run = await env.processing.retry(pack.id, run.id, 1);
    const source = env.sources; let calls = 0;
    const partial = createKnowledgeProcessingModule(env.db, { ...source, readProcessingInput: async ref => {
      calls++; if (calls === 2) throw new Error("模拟磁盘暂时不可读"); return source.readProcessingInput(ref);
    } }, env.options);
    await partial.execute({ kind: "extract", runId: run.id, generation: 2 });
    let view = await partial.run(pack.id, run.id);
    expect(view.run.status).toBe("partial"); expect(view.items.filter(row => row.status === "completed")).toHaveLength(1);
    const inputHash = view.run.inputHash;
    run = await env.processing.retry(pack.id, run.id, 2);
    await env.processing.execute({ kind: "extract", runId: run.id, generation: 3 });
    view = await env.processing.run(pack.id, run.id);
    expect(view.run).toMatchObject({ status: "completed", inputHash });
    expect(view.items.map(row => row.attempts.length).sort()).toEqual([1, 2]);
    await env.db.update(knowledgeRuns).set({ status: "running" }).where(eq(knowledgeRuns.id, run.id));
    expect(await env.processing.recoverInterrupted()).toContain(run.id);
    expect((await env.processing.run(pack.id, run.id)).run.status).toBe("stopped");
  });
});
