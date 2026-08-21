import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type { RequestQueue } from "@crawlee/core";
import type {
  CrawlPlanSource,
  SourceAccessPolicy,
  SourcePreparation,
  SourceProviderCollectionContext,
  SourceProviderEvent,
  SourceRequestAdmissionPort,
} from "@domain-analysis/shared";
import { request } from "playwright-core";

import { createPacedSessionHttpAccess, type PacedSessionHttpAccess } from "./pacedSessionHttpAccess";
import {
  parseJdCatalogHtml,
  parseJdCatalogImageReferences,
} from "./jdCatalogParser";
import {
  createPersistentCrawleeConfiguration,
  openPersistentRequestQueue,
  requestLockRecoveryWaitMs,
} from "./ephemeralCrawleeConfiguration";
import { SourceAccessError } from "./sourceAccessError";

const providerKey = "jd.catalog-product";
const providerVersion = "2.0.0";
const liveAccessBlockedMessage = "京东 v2 本地门尚未全部通过，真实 HTTP 尚未获准；本轮未访问京东";
const operations = [
  "catalog_pages",
  "store_catalogs",
  "product_details",
  "review_summaries",
  "review_samples",
] as const;

export interface JdCatalogProviderOptions {
  storageDirectory: string;
  openHttpAccess?: (input: { source: CrawlPlanSource; runId: string;
    admission: SourceRequestAdmissionPort;
    accessPolicy: Extract<SourceAccessPolicy, { kind: "paced_http" }> })
    => Promise<PacedSessionHttpAccess> | PacedSessionHttpAccess;
  requestLockSeconds?: number;
}

export interface JdCatalogProvider {
  readonly key: string;
  readonly version: string;
  validate(source: CrawlPlanSource): void;
  prepare(source: CrawlPlanSource): Promise<SourcePreparation>;
  preflight(source: CrawlPlanSource): Promise<void>;
  collect(source: CrawlPlanSource, runId: string, admission: SourceRequestAdmissionPort,
    signal?: AbortSignal, context?: SourceProviderCollectionContext): AsyncIterable<SourceProviderEvent>;
  close(): Promise<void>;
}

export function createJdCatalogProvider(options: JdCatalogProviderOptions): JdCatalogProvider {
  if (!options.storageDirectory.trim()) throw new Error("JD RequestQueue storage 路径不能为空");
  return {
    key: providerKey,
    version: providerVersion,
    validate: validateJdV2Source,
    async prepare(source) {
      validateJdV2Source(source);
      requireLiveAccess(options);
      // WHY：Prepare 固定零请求；第一条 Start 请求同时承担可达性与原始捕获，避免重复探测。
      return { status: "ready", message: "JD v2 显式 HTTP 已配置；Prepare 未发送任何网络请求。" };
    },
    async preflight(source) {
      validateJdV2Source(source);
      requireLiveAccess(options);
    },
    async *collect(source, runId, admission, signal, context) {
      validateJdV2Source(source);
      requireLiveAccess(options);
      yield* collectJdV2(source, runId, admission, options, signal, context);
    },
    async close() {},
  };
}

export function createAnonymousJdHttpAccessFactory() {
  return async ({ runId, admission, accessPolicy }: Parameters<NonNullable<
    JdCatalogProviderOptions["openHttpAccess"]>>[0]) => {
    const requestContext = await request.newContext();
    try {
      const access = createPacedSessionHttpAccess(requestContext, accessPolicy, {
        maximumBytes: 10_000_000,
        requestTimeoutMs: 30_000,
        allowedOrigins: ["https://www.jd.com", "https://mall.jd.com",
          "https://item.jd.com", "https://api.m.jd.com"],
        admission,
        runId,
        gateKey: `${providerKey}@${providerVersion}`,
        providerKey,
        providerVersion,
        responseRestriction: classifyJdResponseRestriction,
      });
      access.close = () => requestContext.dispose();
      return access;
    } catch (error) {
      await requestContext.dispose();
      throw error;
    }
  };
}

export function classifyJdResponseRestriction(response: {
  url: string; status: number; headers: Record<string, string>; body: Buffer;
}) {
  const url = new URL(response.url);
  if (url.hostname === "passport.jd.com") {
    return new SourceAccessError("login_required", "京东响应进入登录入口，已停止访问");
  }
  const text = response.body.subarray(0, 1_000_000).toString("utf8").toLowerCase();
  if (text.includes("risk_handler") || text.includes("验证码") || text.includes("安全验证")) {
    return new SourceAccessError("verification_required", "京东响应要求安全验证，已停止访问");
  }
  const mediaType = (response.headers["content-type"] ?? "").toLowerCase();
  // WHY：京东公共页导航固定包含“请登录”；只有整页登录表单或接口明确返回未登录，才能熔断为登录挑战。
  const isLoginDocument = mediaType.includes("text/html")
    && /<title[^>]*>[^<]{0,80}登录[^<]*<\/title>/.test(text)
    && (text.includes("formlogin") || text.includes("name=\"loginname\"")
      || text.includes("name='loginname'"));
  const isLoginResponse = mediaType.includes("json")
    && /"(?:message|msg)"\s*:\s*"[^"]*(?:请先登录|用户未登录|登录失效)[^"]*"/.test(text);
  if (isLoginDocument || isLoginResponse) {
    return new SourceAccessError("login_required", "京东响应要求登录，已停止访问");
  }
  if (text.includes("访问频繁") || text.includes("请求过于频繁") || text.includes("pc-frequent")) {
    return new SourceAccessError("rate_limited", "京东响应表明访问频繁，已熔断访问");
  }
  return undefined;
}

type JdOperation = typeof operations[number];
type JdWork = { operation: JdOperation; targetKey: string; workKey: string; url: string;
  externalKey: string; parentObjectKey?: string; expectedUnitCount: number };

async function* collectJdV2(
  source: CrawlPlanSource,
  runId: string,
  admission: SourceRequestAdmissionPort,
  options: JdCatalogProviderOptions,
  signal?: AbortSignal,
  context?: SourceProviderCollectionContext,
): AsyncIterable<SourceProviderEvent> {
  const requestLockSeconds = options.requestLockSeconds ?? 60;
  if (context?.resumedFromRunId) {
    // WHY：强杀可能留下预取锁；显式恢复先等 Crawlee 3.18.1 的已验证锁恢复上限，
    // 再用新实例读取持久队列，避免把“暂时取不到”误判成已完成。
    await delay(requestLockRecoveryWaitMs(requestLockSeconds), undefined, { signal });
  }
  const configuration = createPersistentCrawleeConfiguration(options.storageDirectory);
  const queue = await openPersistentRequestQueue(`jd-${context?.queueRunId ?? runId}`,
    configuration, requestLockSeconds);
  const targetByOperation = new Map(source.targets.map((target) => {
    const plan = targetPlan(target);
    return [plan.operation, { ...plan, target }] as const;
  }));
  const capturedOperations = new Set<JdOperation>();
  if (!context?.resumedFromRunId) {
    for (const entry of source.entryUrls) {
      await enqueueWork(queue, admission, runId, workFor("catalog_pages", entry, entry,
        targetByOperation.get("catalog_pages")!.target.key));
    }
  }
  let http: PacedSessionHttpAccess | undefined;
  try {
    http = await options.openHttpAccess!({ source, runId, admission,
      accessPolicy: context?.accessPolicy.kind === "paced_http"
        ? context.accessPolicy : effectiveJdAccessPolicy(source) });
    while (true) {
      const request = await fetchNextWork(queue, signal, requestLockSeconds);
      if (!request) break;
      const work = parseWork(request.userData);
      // WHY：恢复运行复用前序队列，但用户可见工作事实属于新的 Source Run，派发前必须重新对账。
      await admission.ensureCaptureWorkItem({ runId, targetKey: work.targetKey, workKey: work.workKey,
        parentObjectKey: work.parentObjectKey, captureUnit: work.operation,
        expectedUnitCount: work.expectedUnitCount });
      await admission.startCaptureWorkItem({ runId, workKey: work.workKey });
      try {
        const response = await http.get(work.url, { targetKey: work.targetKey, workKey: work.workKey }, signal);
        validateResponseMediaType(work.operation, response.headers);
        assertUsableJdPayload(work, response);
        const captured = captureWork(source, work, response);
        capturedOperations.add(work.operation);
        yield captured.event;
        await enqueueDiscoveries(captured, queue, admission, runId, targetByOperation);
        await admission.finishCaptureWorkItem({ runId, workKey: work.workKey,
          status: "completed", observedUnitCount: 1, terminationReason: "captured" });
        await queue.markRequestHandled(request);
      } catch (error) {
        await admission.finishCaptureWorkItem({ runId, workKey: work.workKey,
          status: "failed", observedUnitCount: 0, terminationReason: boundedMessage(error) });
        throw error;
      }
    }
    await http.onIdle();
    for (const target of source.targets) {
      const operation = targetPlan(target).operation;
      if (capturedOperations.has(operation)) yield { type: "target.completed", targetKey: target.key };
    }
    const missing = operations.filter((operation) => !capturedOperations.has(operation));
    if (missing.length > 0) {
      throw new SourceAccessError("source_abnormal",
        `京东已完成当前可访问捕获，但未发现这些捕获单元：${missing.join(", ")}`);
    }
  } finally {
    if (signal?.aborted) http?.cancel("operator_cancelled");
    await http?.close?.();
    await configuration.getStorageClient().teardown?.();
  }
}

async function enqueueWork(
  queue: RequestQueue,
  admission: SourceRequestAdmissionPort,
  runId: string,
  work: JdWork,
) {
  await admission.ensureCaptureWorkItem({ runId, targetKey: work.targetKey, workKey: work.workKey,
    parentObjectKey: work.parentObjectKey, captureUnit: work.operation,
    expectedUnitCount: work.expectedUnitCount });
  await queue.addRequest({ url: work.url, uniqueKey: work.workKey, userData: work });
}

async function enqueueDiscoveries(
  captured: ReturnType<typeof captureWork>,
  queue: RequestQueue,
  admission: SourceRequestAdmissionPort,
  runId: string,
  targets: Map<JdOperation, { target: CrawlPlanSource["targets"][number]; operation: JdOperation;
    samplesPerProduct?: number }>,
) {
  const add = async (operation: JdOperation, url: string, externalKey: string, parent?: string) => {
    const plan = targets.get(operation)!;
    const expected = operation === "review_samples" ? plan.samplesPerProduct! : 1;
    await enqueueWork(queue, admission, runId,
      workFor(operation, url, externalKey, plan.target.key, parent, expected));
  };
  if (captured.work.operation === "catalog_pages" || captured.work.operation === "store_catalogs") {
    for (const product of parseJdCatalogHtml(captured.text, captured.work.url)) {
      await add("product_details", product.detailUrl, product.externalKey);
    }
  }
}

function captureWork(source: CrawlPlanSource, work: JdWork, response: Awaited<ReturnType<PacedSessionHttpAccess["get"]>>) {
  const text = response.body.toString("utf8");
  const json = work.operation === "review_summaries" || work.operation === "review_samples";
  const contentHash = createHash("sha256").update(response.body).digest("hex");
  const resourceReferences = work.operation === "catalog_pages" || work.operation === "store_catalogs"
    ? parseJdCatalogImageReferences(text, response.finalUrl) : [];
  const event: SourceProviderEvent = { type: "capture", targetKey: work.targetKey,
    snapshot: { idempotencyKey: work.workKey,
      object: { sourceIdentity: source.key, kind: objectKind(work.operation), externalKey: work.externalKey },
      observation: { requestedUrl: work.url, finalUrl: response.finalUrl,
        observedAt: new Date().toISOString(), state: "accessible", httpStatus: response.status,
        responseHeaders: response.headers }, payload: { kind: "inline_text",
        mediaType: json ? "application/json" : "text/html", charset: "utf-8", text,
        bytes: response.body.byteLength, contentHash } }, assets: [], resourceReferences };
  return { event, work, text };
}

function assertUsableJdPayload(
  work: JdWork,
  response: Awaited<ReturnType<PacedSessionHttpAccess["get"]>>,
) {
  if (work.operation !== "product_details") return;
  const text = response.body.toString("utf8");
  const hasSkeleton = /class=["'][^"']*\bskeleton-screen\b[^"']*["']/.test(text);
  const hasEmptyRoot = /<div[^>]+id=["']root["'][^>]*>\s*<\/div>/.test(text);
  if (!hasSkeleton || !hasEmptyRoot) return;
  // WHY：真实匿名详情页只返回客户端骨架，继续排队会把请求预算和频控额度耗在同一种空响应上。
  // 当前阶段不得复制签名、绕过安全挑战或自动登录，因此首个骨架即失败关闭并保留已抓目录快照。
  throw new SourceAccessError("source_abnormal",
    "京东匿名商品详情仅返回客户端骨架；当前缺少获准的登录或安全上下文，已停止后续请求");
}

async function fetchNextWork(queue: RequestQueue, signal: AbortSignal | undefined, requestLockSeconds: number) {
  const deadline = Date.now() + requestLockRecoveryWaitMs(requestLockSeconds);
  while (Date.now() <= deadline) {
    if (signal?.aborted) throw signal.reason ?? new Error("operator_cancelled");
    const request = await queue.fetchNextRequest();
    if (request) return request;
    if (await queue.isFinished()) return null;
    await delay(100, undefined, { signal });
  }
  throw new Error("RequestQueue 锁在恢复等待上限后仍未释放，已失败关闭");
}

function workFor(operation: JdOperation, rawUrl: string, externalKey: string, targetKey: string,
  parentObjectKey?: string, expectedUnitCount = 1): JdWork {
  const url = normalizeGetUrl(rawUrl);
  return { operation, targetKey, url, externalKey, parentObjectKey, expectedUnitCount,
    workKey: `get:${createHash("sha256").update(url).digest("hex")}` };
}

function parseWork(value: unknown): JdWork {
  if (!value || typeof value !== "object") throw new Error("RequestQueue work item 不是对象");
  const work = value as Record<string, unknown>;
  if (!operations.includes(work.operation as JdOperation) || typeof work.targetKey !== "string"
    || typeof work.workKey !== "string" || typeof work.url !== "string" || typeof work.externalKey !== "string"
    || !Number.isInteger(work.expectedUnitCount) || Number(work.expectedUnitCount) < 1
    || (work.parentObjectKey != null && typeof work.parentObjectKey !== "string")) {
    throw new Error("RequestQueue work item contract 无效");
  }
  return work as JdWork;
}

function normalizeGetUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  url.searchParams.sort();
  return url.href;
}

function objectKind(operation: JdOperation) {
  if (operation === "catalog_pages") return "catalog_page";
  if (operation === "store_catalogs") return "store_catalog";
  if (operation === "product_details") return "product";
  return operation === "review_summaries" ? "product_review_summary" : "product_review_samples";
}

function validateResponseMediaType(operation: JdOperation, headers: Record<string, string>) {
  const mediaType = (headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
  const allowed = operation === "review_summaries" || operation === "review_samples"
    ? ["application/json", "application/javascript", "text/plain"]
    : ["text/html", "application/xhtml+xml"];
  if (!allowed.includes(mediaType)) throw new Error(`JD ${operation} 响应媒体类型不支持：${mediaType || "missing"}`);
}

function boundedMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function requireLiveAccess(options: JdCatalogProviderOptions) {
  if (!options.openHttpAccess) throw new SourceAccessError("source_abnormal", liveAccessBlockedMessage);
}

function validateJdV2Source(source: CrawlPlanSource) {
  if (source.provider.key !== providerKey || source.provider.version !== providerVersion) {
    throw new Error(`JD Provider 绑定必须是 ${providerKey}@${providerVersion}`);
  }
  const config = Object.fromEntries(source.provider.configuration.map((item) => [item.key, item.value]));
  const configKeys = source.provider.configuration.map((item) => item.key).sort();
  if (configKeys.join(",") !== "exclude_text,include_text,mode" || config.mode !== "explicit_http"
    || typeof config.include_text !== "string" || typeof config.exclude_text !== "string") {
    throw new Error("JD v2 配置必须且只能包含 mode=explicit_http、include_text 与 exclude_text");
  }
  if (source.sourceKind !== "retailer") throw new Error("JD Provider 只承担零售来源");
  if (source.entryUrls.length === 0 || source.entryUrls.some((value) => !isJdCatalogEntry(value))) {
    throw new Error("JD v2 目录入口必须是无凭证的 www.jd.com HTTPS URL");
  }
  if (source.rawOutputPolicy.retainAssets
    || [...source.rawOutputPolicy.formats].sort().join(",") !== "html,source_json") {
    throw new Error("JD v2 只保留 HTML/source JSON，图片只保存 URL 引用");
  }
  if (source.targets.length !== operations.length) throw new Error("JD v2 必须包含目录、店铺、详情、评价汇总、评价样本五类 target");
  const plans = source.targets.map(targetPlan);
  if (plans.map((plan) => plan.operation).sort().join(",") !== [...operations].sort().join(",")) {
    throw new Error("JD v2 五类 operation 必须各出现一次");
  }
  if (source.targets.some((target) => target.quantity.mode !== "all_available")) {
    throw new Error("JD v2 target 必须按动态工作项声明 all_available");
  }
  if (source.stopPolicy.requestBudget < source.entryUrls.length + 4) {
    throw new Error("JD v2 请求预算不足以覆盖目录与四类后续捕获");
  }
}

function effectiveJdAccessPolicy(source: CrawlPlanSource): Extract<SourceAccessPolicy, { kind: "paced_http" }> {
  return { ...source.accessPolicy, jitterMs: { min: 0, max: 0 },
    batchSize: source.accessPolicy.maxRequestsPerMinute, batchCooldownMs: 60_000 };
}

function targetPlan(target: CrawlPlanSource["targets"][number]) {
  const config = Object.fromEntries(target.providerConfiguration.map((item) => [item.key, item.value]));
  if (!operations.includes(config.operation as typeof operations[number])) {
    throw new Error(`JD v2 target operation 不支持：${target.key}`);
  }
  if (config.operation === "review_samples") {
    const keys = target.providerConfiguration.map((item) => item.key).sort();
    if (keys.join(",") !== "operation,samples_per_product"
      || (config.samples_per_product !== 50 && config.samples_per_product !== 100)) {
      throw new Error("JD 评价样本必须冻结 samples_per_product=50 或 100");
    }
  } else if (target.providerConfiguration.length !== 1) {
    throw new Error(`JD target ${target.key} 只能配置 operation`);
  }
  return { target, operation: config.operation as typeof operations[number],
    samplesPerProduct: typeof config.samples_per_product === "number" ? config.samples_per_product : undefined };
}

function isJdCatalogEntry(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.jd.com" && !url.port
      && !url.username && !url.password;
  } catch {
    return false;
  }
}
