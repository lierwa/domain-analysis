import { randomUUID } from "node:crypto";

import type { WorkbenchDb } from "@domain-analysis/db";
import {
  sourceAccessGateStates,
  sourceCaptureWorkItems,
  sourceCollectionRuns,
  sourceCollectionTargetRuns,
  sourceRequestAttempts,
} from "@domain-analysis/db";
import {
  sourceAccessGateStateSchema,
  sourceCaptureWorkItemSchema,
  sourceRequestAttemptSchema,
  type SourceRequestAdmission,
  type SourceRequestAdmissionPort,
} from "@domain-analysis/shared";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import { SourceDatasetError } from "./sourceDatasetError";
import { acquireSourceExecutionLease } from "./sourceExecutionLease";
import { normalizeRun } from "./sourceDatasetNormalization";

type WorkbenchTransaction = Parameters<Parameters<WorkbenchDb["transaction"]>[0]>[0];

export function createSourceRequestAdmission(
  db: WorkbenchDb,
  now: () => Date = () => new Date(),
): SourceRequestAdmissionPort {
  return {
    ensureCaptureWorkItem: (input) => ensureCaptureWorkItem(db, input),
    startCaptureWorkItem: (input) => startCaptureWorkItem(db, now, input),
    finishCaptureWorkItem: (input) => finishCaptureWorkItem(db, now, input),
    reserveRequest: (input) => reserveRequest(db, now, input),
    finishRequest: (input) => finishRequest(db, now, input),
    getAccessGate: (gateKey) => getAccessGate(db, gateKey),
  };
}

export async function acquireSourceRunLease(db: WorkbenchDb, runId: string) {
  const lease = await acquireSourceExecutionLease(db, "source-run-lease", runId,
    "Source Run 仍由活动执行进程持有，不能继续");
  const run = await db.query.sourceCollectionRuns.findFirst({ where: eq(sourceCollectionRuns.id, runId) });
  if (run) return lease;
  await lease.release();
  throw new SourceDatasetError("run_not_found", `来源运行不存在：${runId}`);
}

export async function prepareSourceRunForResume(db: WorkbenchDb, runId: string) {
  const existing = await db.query.sourceCollectionRuns.findFirst({ where: eq(sourceCollectionRuns.id, runId) });
  if (!existing) throw new SourceDatasetError("run_not_found", `来源运行不存在：${runId}`);
  if (existing.status === "failed" || existing.status === "stopped") return normalizeRun(existing);
  if (existing.status === "completed") throw new SourceDatasetError("invalid_state", "已完成 Source Run 不能继续");
  const lease = await acquireSourceRunLease(db, runId);
  try {
    return await db.transaction(async (transaction) => {
      const run = await transaction.query.sourceCollectionRuns.findFirst({ where: eq(sourceCollectionRuns.id, runId) });
      if (!run || run.status !== "running") {
        throw new SourceDatasetError("invalid_state", "Source Run 状态已变化，请刷新后重试");
      }
      const at = new Date().toISOString();
      const attempts = await transaction.select({ gateKey: sourceRequestAttempts.gateKey })
        .from(sourceRequestAttempts).where(and(eq(sourceRequestAttempts.runId, runId),
          eq(sourceRequestAttempts.state, "started")));
      const gateKeys = [...new Set(attempts.map((attempt) => attempt.gateKey))];
      await transaction.update(sourceRequestAttempts).set({ state: "cancelled", finishedAt: at,
        restrictionReason: "request_outcome_unknown" }).where(and(eq(sourceRequestAttempts.runId, runId),
        eq(sourceRequestAttempts.state, "started")));
      if (gateKeys.length > 0) await transaction.update(sourceAccessGateStates).set({ circuitState: "open",
        blockedAt: at, blockedReason: "request_outcome_unknown", manualResumeRequired: true, updatedAt: at })
        .where(inArray(sourceAccessGateStates.key, gateKeys));
      await transaction.update(sourceCaptureWorkItems).set({ status: "stopped", finishedAt: at,
        terminationReason: "execution_process_lost" }).where(and(eq(sourceCaptureWorkItems.runId, runId),
        or(eq(sourceCaptureWorkItems.status, "pending"), eq(sourceCaptureWorkItems.status, "running"))));
      await transaction.update(sourceCollectionTargetRuns).set({ status: "stopped", finishedAt: at,
        terminationReason: "execution_process_lost" }).where(and(eq(sourceCollectionTargetRuns.runId, runId),
        or(eq(sourceCollectionTargetRuns.status, "pending"), eq(sourceCollectionTargetRuns.status, "running"))));
      const changed = await transaction.update(sourceCollectionRuns).set({ status: "stopped", finishedAt: at,
        terminationReason: "execution_process_lost", failureCategory: "execution_process_lost" })
        .where(and(eq(sourceCollectionRuns.id, runId),
        eq(sourceCollectionRuns.status, "running"))).returning();
      if (changed.length !== 1) throw new SourceDatasetError("invalid_state", "Source Run 恢复准备失败");
      return normalizeRun(changed[0]!);
    });
  } finally { await lease.release(); }
}

async function startCaptureWorkItem(
  db: WorkbenchDb,
  now: () => Date,
  input: Parameters<SourceRequestAdmissionPort["startCaptureWorkItem"]>[0],
) {
  return db.transaction(async (transaction) => {
    const work = await transaction.query.sourceCaptureWorkItems.findFirst({ where: and(
      eq(sourceCaptureWorkItems.runId, input.runId), eq(sourceCaptureWorkItems.workKey, input.workKey),
    ) });
    if (!work) throw new SourceDatasetError("invalid_state", `捕获工作项不存在：${input.workKey}`);
    await requireRunningTarget(transaction, input.runId, work.targetKey);
    const changed = await transaction.update(sourceCaptureWorkItems).set({ status: "running",
      startedAt: now().toISOString() }).where(and(eq(sourceCaptureWorkItems.id, work.id),
      eq(sourceCaptureWorkItems.status, "pending"))).returning();
    if (changed.length !== 1) throw new SourceDatasetError("invalid_state", `捕获工作项不能启动：${input.workKey}`);
    return normalizeWorkItem(changed[0]!);
  });
}

async function finishCaptureWorkItem(
  db: WorkbenchDb,
  now: () => Date,
  input: Parameters<SourceRequestAdmissionPort["finishCaptureWorkItem"]>[0],
) {
  if (!Number.isInteger(input.observedUnitCount) || input.observedUnitCount < 0) {
    throw new SourceDatasetError("invalid_state", "捕获工作项 observed 数量必须是非负整数");
  }
  return db.transaction(async (transaction) => {
    const work = await transaction.query.sourceCaptureWorkItems.findFirst({ where: and(
      eq(sourceCaptureWorkItems.runId, input.runId), eq(sourceCaptureWorkItems.workKey, input.workKey),
    ) });
    if (!work) throw new SourceDatasetError("invalid_state", `捕获工作项不存在：${input.workKey}`);
    await requireRunningTarget(transaction, input.runId, work.targetKey);
    if (input.status === "completed" && work.expectedUnitCount != null
      && work.expectedUnitCount !== input.observedUnitCount) {
      throw new SourceDatasetError("invalid_state", `捕获工作项数量未对账：${input.workKey}`);
    }
    const changed = await transaction.update(sourceCaptureWorkItems).set({ status: input.status,
      observedUnitCount: input.observedUnitCount, finishedAt: now().toISOString(),
      terminationReason: input.terminationReason }).where(and(eq(sourceCaptureWorkItems.id, work.id),
      eq(sourceCaptureWorkItems.status, "running"))).returning();
    if (changed.length !== 1) throw new SourceDatasetError("invalid_state", `捕获工作项不能结束：${input.workKey}`);
    return normalizeWorkItem(changed[0]!);
  });
}

export async function loadSourceRequestState(db: WorkbenchDb, runId: string) {
  const [workRows, attemptRows] = await Promise.all([
    db.select().from(sourceCaptureWorkItems).where(eq(sourceCaptureWorkItems.runId, runId))
      .orderBy(asc(sourceCaptureWorkItems.createdAt)),
    db.select().from(sourceRequestAttempts).where(eq(sourceRequestAttempts.runId, runId))
      .orderBy(asc(sourceRequestAttempts.startedAt)),
  ]);
  const gateKeys = [...new Set(attemptRows.map((row) => row.gateKey))];
  const gateRows = gateKeys.length > 0
    ? await db.select().from(sourceAccessGateStates).where(inArray(sourceAccessGateStates.key, gateKeys))
    : [];
  return { workItems: workRows.map(normalizeWorkItem), requestAttempts: attemptRows.map(normalizeAttempt),
    accessGates: gateRows.map(normalizeGate) };
}

async function ensureCaptureWorkItem(
  db: WorkbenchDb,
  input: Parameters<SourceRequestAdmissionPort["ensureCaptureWorkItem"]>[0],
) {
  return db.transaction(async (transaction) => {
    await requireRunningTarget(transaction, input.runId, input.targetKey);
    await transaction.insert(sourceCaptureWorkItems).values({
      id: `source-work-${randomUUID()}`,
      runId: input.runId,
      targetKey: input.targetKey,
      workKey: input.workKey,
      parentObjectKey: input.parentObjectKey,
      captureUnit: input.captureUnit,
      expectedUnitCount: input.expectedUnitCount,
      status: "pending",
    }).onConflictDoNothing();
    const row = await transaction.query.sourceCaptureWorkItems.findFirst({ where: and(
      eq(sourceCaptureWorkItems.runId, input.runId), eq(sourceCaptureWorkItems.workKey, input.workKey),
    ) });
    if (!row || row.targetKey !== input.targetKey || row.captureUnit !== input.captureUnit
      || (row.parentObjectKey ?? undefined) !== input.parentObjectKey
      || (row.expectedUnitCount ?? undefined) !== input.expectedUnitCount) {
      throw new SourceDatasetError("invalid_state", `捕获工作项定义冲突：${input.workKey}`);
    }
    return normalizeWorkItem(row);
  });
}

async function reserveRequest(
  db: WorkbenchDb,
  now: () => Date,
  input: Parameters<SourceRequestAdmissionPort["reserveRequest"]>[0],
): Promise<SourceRequestAdmission> {
  validateAdmissionInput(input);
  return db.transaction(async (transaction) => {
    await lockProvider(transaction, input.providerKey, input.providerVersion);
    await lockGate(transaction, input.gateKey);
    const run = await requireRunningTarget(transaction, input.runId, input.targetKey);
    const runPolicy = run.accessPolicy;
    if (runPolicy.kind !== "paced_http") {
      throw new SourceDatasetError("invalid_state", "请求准入策略与 Source Run 冻结策略不一致");
    }
    const lanePolicy = input.requestLane === "asset" ? runPolicy.assetPolicy : runPolicy;
    if (!lanePolicy || runPolicy.version !== input.policyVersion
      || lanePolicy.minimumIntervalMs !== input.minimumIntervalMs
      || lanePolicy.maxRequestsPerMinute !== input.maxRequestsPerMinute) {
      throw new SourceDatasetError("invalid_state", "请求准入策略与 Source Run 冻结策略不一致");
    }
    const work = await transaction.query.sourceCaptureWorkItems.findFirst({ where: and(
      eq(sourceCaptureWorkItems.runId, input.runId), eq(sourceCaptureWorkItems.workKey, input.workKey),
    ) });
    if (!work || work.targetKey !== input.targetKey) {
      throw new SourceDatasetError("invalid_state", `捕获工作项不存在：${input.workKey}`);
    }
    await ensureGate(transaction, input);
    const existingGate = await transaction.query.sourceAccessGateStates.findFirst({
      where: eq(sourceAccessGateStates.key, input.gateKey),
    });
    if (!existingGate) throw new SourceDatasetError("invalid_state", `请求 gate 创建失败：${input.gateKey}`);
    const admissionTime = now();
    const gate = await alignGatePolicy(transaction, existingGate, input, admissionTime);
    const blockedGate = await transaction.query.sourceAccessGateStates.findFirst({ where: and(
      eq(sourceAccessGateStates.providerKey, input.providerKey),
      eq(sourceAccessGateStates.providerVersion, input.providerVersion),
      eq(sourceAccessGateStates.circuitState, "open"),
    ) });
    if (blockedGate || gate.circuitState === "open") return {
      status: "blocked", reason: blockedGate?.blockedReason ?? gate.blockedReason ?? "circuit_open",
      manualResumeRequired: blockedGate?.manualResumeRequired ?? gate.manualResumeRequired,
    };
    const lineageIds = await loadRunLineageIds(transaction, run);
    const attempted = await transaction.select({ count: sql<number>`count(*)::int` })
      .from(sourceRequestAttempts).where(inArray(sourceRequestAttempts.runId, lineageIds));
    if (!run.requestBudget || attempted[0]!.count >= run.requestBudget) {
      return { status: "blocked", reason: "request_budget_exhausted", manualResumeRequired: false };
    }
    const deferred = deferredAdmission(gate, admissionTime, input.maxRequestsPerMinute);
    if (deferred) return deferred;
    const attempt = await insertAttempt(transaction, input, admissionTime);
    const window = currentWindow(gate, admissionTime);
    await transaction.update(sourceAccessGateStates).set({
      lastAttemptAt: admissionTime.toISOString(),
      nextEligibleAt: new Date(admissionTime.getTime() + input.minimumIntervalMs).toISOString(),
      windowStartedAt: window.startedAt,
      windowRequestCount: window.count + 1,
      updatedAt: admissionTime.toISOString(),
    }).where(eq(sourceAccessGateStates.key, input.gateKey));
    return { status: "admitted", attempt };
  });
}

async function loadRunLineageIds(
  transaction: WorkbenchTransaction,
  run: typeof sourceCollectionRuns.$inferSelect,
) {
  const ids = [run.id];
  let parentId = run.resumedFromRunId;
  while (parentId) {
    if (ids.includes(parentId)) throw new SourceDatasetError("invalid_state", "Source Run 恢复链形成循环");
    const parent = await transaction.query.sourceCollectionRuns.findFirst({
      where: eq(sourceCollectionRuns.id, parentId),
    });
    if (!parent || parent.requestBudget !== run.requestBudget) {
      throw new SourceDatasetError("invalid_state", "Source Run 恢复链不存在或请求预算不一致");
    }
    ids.push(parent.id);
    parentId = parent.resumedFromRunId;
  }
  return ids;
}

async function finishRequest(
  db: WorkbenchDb,
  now: () => Date,
  input: Parameters<SourceRequestAdmissionPort["finishRequest"]>[0],
) {
  if (input.state === "restricted" && !input.restrictionReason) {
    throw new SourceDatasetError("invalid_state", "受限请求必须记录 restriction reason");
  }
  return db.transaction(async (transaction) => {
    const existing = await transaction.query.sourceRequestAttempts.findFirst({
      where: eq(sourceRequestAttempts.id, input.attemptId),
    });
    if (!existing) throw new SourceDatasetError("invalid_state", `请求尝试不存在：${input.attemptId}`);
    const gate = await transaction.query.sourceAccessGateStates.findFirst({
      where: eq(sourceAccessGateStates.key, existing.gateKey),
    });
    if (!gate) throw new SourceDatasetError("invalid_state", `请求 gate 不存在：${existing.gateKey}`);
    await lockProvider(transaction, gate.providerKey, gate.providerVersion);
    await lockGate(transaction, existing.gateKey);
    const finishedAt = now().toISOString();
    const changed = await transaction.update(sourceRequestAttempts).set({ ...input, finishedAt })
      .where(and(eq(sourceRequestAttempts.id, input.attemptId), eq(sourceRequestAttempts.state, "started")))
      .returning();
    if (changed.length !== 1) throw new SourceDatasetError("invalid_state", `请求尝试已经结束：${input.attemptId}`);
    if (input.state === "restricted") {
      // WHY：首个明确限制是整个 Provider 身份的停止事实；持久开路防止另一进程或重启后继续打源站。
      await transaction.update(sourceAccessGateStates).set({ circuitState: "open", blockedAt: finishedAt,
        blockedReason: input.restrictionReason, manualResumeRequired: true, updatedAt: finishedAt })
        .where(and(eq(sourceAccessGateStates.providerKey, gate.providerKey),
          eq(sourceAccessGateStates.providerVersion, gate.providerVersion)));
    }
    return normalizeAttempt(changed[0]!);
  });
}

async function getAccessGate(db: WorkbenchDb, gateKey: string) {
  const row = await db.query.sourceAccessGateStates.findFirst({
    where: eq(sourceAccessGateStates.key, gateKey),
  });
  return row ? normalizeGate(row) : null;
}

async function requireRunningTarget(transaction: WorkbenchTransaction, runId: string, targetKey: string) {
  const run = await transaction.query.sourceCollectionRuns.findFirst({ where: eq(sourceCollectionRuns.id, runId) });
  const target = await transaction.query.sourceCollectionTargetRuns.findFirst({ where: and(
    eq(sourceCollectionTargetRuns.runId, runId), eq(sourceCollectionTargetRuns.targetKey, targetKey),
  ) });
  if (!run || run.status !== "running" || !target || target.status !== "running") {
    throw new SourceDatasetError("invalid_state", "来源运行或 target 不存在，或未处于运行状态");
  }
  return run;
}

async function ensureGate(
  transaction: WorkbenchTransaction,
  input: Parameters<SourceRequestAdmissionPort["reserveRequest"]>[0],
) {
  await transaction.insert(sourceAccessGateStates).values({ key: input.gateKey,
    providerKey: input.providerKey, providerVersion: input.providerVersion,
    policyVersion: input.policyVersion, circuitState: "closed",
    windowRequestCount: 0, manualResumeRequired: false }).onConflictDoNothing();
}

async function insertAttempt(
  transaction: WorkbenchTransaction,
  input: Parameters<SourceRequestAdmissionPort["reserveRequest"]>[0],
  startedAt: Date,
) {
  const row = { id: `source-request-${randomUUID()}`, runId: input.runId,
    targetKey: input.targetKey, workKey: input.workKey, gateKey: input.gateKey,
    requestedUrl: input.requestedUrl, origin: new URL(input.requestedUrl).origin,
    redirectParentAttemptId: input.redirectParentAttemptId, startedAt: startedAt.toISOString(),
    state: "started" as const };
  await transaction.insert(sourceRequestAttempts).values(row);
  return sourceRequestAttemptSchema.parse(row);
}

function deferredAdmission(
  gate: typeof sourceAccessGateStates.$inferSelect,
  at: Date,
  maxRequestsPerMinute: number,
): Extract<SourceRequestAdmission, { status: "deferred" }> | null {
  if (gate.nextEligibleAt && new Date(gate.nextEligibleAt).getTime() > at.getTime()) {
    return { status: "deferred", reason: "minimum_interval", retryAt: normalizeTimestamp(gate.nextEligibleAt) };
  }
  const window = currentWindow(gate, at);
  if (window.count >= maxRequestsPerMinute) {
    return { status: "deferred", reason: "rate_window",
      retryAt: new Date(new Date(window.startedAt).getTime() + 60_000).toISOString() };
  }
  return null;
}

function currentWindow(gate: typeof sourceAccessGateStates.$inferSelect, at: Date) {
  if (!gate.windowStartedAt || at.getTime() - new Date(gate.windowStartedAt).getTime() >= 60_000) {
    return { startedAt: at.toISOString(), count: 0 };
  }
  return { startedAt: normalizeTimestamp(gate.windowStartedAt), count: gate.windowRequestCount };
}

async function alignGatePolicy(
  transaction: WorkbenchTransaction,
  gate: typeof sourceAccessGateStates.$inferSelect,
  input: Parameters<SourceRequestAdmissionPort["reserveRequest"]>[0],
  at: Date,
) {
  if (gate.providerKey !== input.providerKey || gate.providerVersion !== input.providerVersion) {
    throw new SourceDatasetError("invalid_state", `请求 gate 身份或策略冲突：${input.gateKey}`);
  }
  if (gate.policyVersion === input.policyVersion) return gate;
  const active = await transaction.select({ count: sql<number>`count(*)::int` })
    .from(sourceRequestAttempts).where(and(eq(sourceRequestAttempts.gateKey, input.gateKey),
      eq(sourceRequestAttempts.state, "started")));
  if (gate.circuitState !== "closed" || gate.manualResumeRequired || active[0]!.count > 0) {
    throw new SourceDatasetError("invalid_state", `请求 gate 身份或策略冲突：${input.gateKey}`);
  }
  const inheritedNext = Math.max(
    gate.nextEligibleAt ? new Date(gate.nextEligibleAt).getTime() : 0,
    gate.lastAttemptAt ? new Date(gate.lastAttemptAt).getTime() + input.minimumIntervalMs : 0,
  );
  // WHY：计划可增量升级限速版本，但不能借换版本清空旧请求时间；更严格的新间隔从上次真实请求继续计算。
  const updated = await transaction.update(sourceAccessGateStates).set({
    policyVersion: input.policyVersion,
    nextEligibleAt: inheritedNext > 0 ? new Date(inheritedNext).toISOString() : null,
    updatedAt: at.toISOString(),
  }).where(eq(sourceAccessGateStates.key, input.gateKey)).returning();
  if (!updated[0]) throw new SourceDatasetError("invalid_state", `请求 gate 策略升级失败：${input.gateKey}`);
  return updated[0];
}

function validateAdmissionInput(input: Parameters<SourceRequestAdmissionPort["reserveRequest"]>[0]) {
  new URL(input.requestedUrl);
  if (!Number.isInteger(input.minimumIntervalMs) || input.minimumIntervalMs <= 0
    || !Number.isInteger(input.maxRequestsPerMinute) || input.maxRequestsPerMinute <= 0) {
    throw new SourceDatasetError("invalid_state", "请求准入策略必须是正整数");
  }
}

async function lockGate(transaction: WorkbenchTransaction, gateKey: string) {
  // WHY：行尚未创建时无法 FOR UPDATE；事务 advisory lock 让多个进程共享同一 gate 串行判定且断连自动释放。
  await transaction.execute(sql`select pg_advisory_xact_lock(
    hashtext('source-access-gate'), hashtext(${gateKey})
  )`);
}

async function lockProvider(transaction: WorkbenchTransaction, providerKey: string, providerVersion: string) {
  // WHY：HTML 与图片使用独立节奏 gate，但共享同一个 Provider 身份的访问限制事实。
  await transaction.execute(sql`select pg_advisory_xact_lock(
    hashtext('source-access-provider'), hashtext(${`${providerKey}@${providerVersion}`})
  )`);
}

function normalizeWorkItem(row: typeof sourceCaptureWorkItems.$inferSelect) {
  return sourceCaptureWorkItemSchema.parse({ ...row,
    parentObjectKey: row.parentObjectKey ?? undefined,
    expectedUnitCount: row.expectedUnitCount ?? undefined,
    createdAt: normalizeTimestamp(row.createdAt),
    startedAt: row.startedAt ? normalizeTimestamp(row.startedAt) : undefined,
    finishedAt: row.finishedAt ? normalizeTimestamp(row.finishedAt) : undefined,
    terminationReason: row.terminationReason ?? undefined });
}

function normalizeAttempt(row: typeof sourceRequestAttempts.$inferSelect) {
  return sourceRequestAttemptSchema.parse({ ...row,
    redirectParentAttemptId: row.redirectParentAttemptId ?? undefined,
    startedAt: normalizeTimestamp(row.startedAt),
    finishedAt: row.finishedAt ? normalizeTimestamp(row.finishedAt) : undefined,
    finalUrl: row.finalUrl ?? undefined, httpStatus: row.httpStatus ?? undefined,
    bytes: row.bytes ?? undefined, restrictionReason: row.restrictionReason ?? undefined });
}

function normalizeGate(row: typeof sourceAccessGateStates.$inferSelect) {
  return sourceAccessGateStateSchema.parse({ ...row,
    lastAttemptAt: row.lastAttemptAt ? normalizeTimestamp(row.lastAttemptAt) : undefined,
    nextEligibleAt: row.nextEligibleAt ? normalizeTimestamp(row.nextEligibleAt) : undefined,
    windowStartedAt: row.windowStartedAt ? normalizeTimestamp(row.windowStartedAt) : undefined,
    blockedAt: row.blockedAt ? normalizeTimestamp(row.blockedAt) : undefined,
    blockedReason: row.blockedReason ?? undefined,
    updatedAt: normalizeTimestamp(row.updatedAt) });
}

function normalizeTimestamp(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
