import { createHash } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type {
  CrawlPlanSource,
  SourceProviderCollectionContext,
  SourceProviderEvent,
  SourceRequestAdmissionPort,
} from "@domain-analysis/shared";
import { parseSitemap, RobotsTxtFile } from "@crawlee/utils";
import robotsParser from "robots-parser";

import { createPersistentCrawleeConfiguration, openPersistentRequestQueue } from "./ephemeralCrawleeConfiguration";
import { assertPublicHttpsUrl } from "./publicNetworkPolicy";
import {
  assessExactResponse,
  assessSiteResponse,
  captureEvent,
  extractSiteLinks,
  inaccessible,
  isPageCandidate,
  safeSameOriginUrl,
  sharedPathScore,
  signalMatches,
  supportingAssessment,
} from "./publicWebResourceContent";
import {
  createPublicResourceTransport,
  publicWebUserAgent,
  type PublicRedirectEvent,
  type RawPublicResponse,
} from "./publicResourceTransport";

const providerKey = "public.web-resource";
const providerVersion = "2.0.0";
const maximumAllowedBytes = 25_000_000;
const maximumRobotsBytes = 256_000;

export interface PublicWebResourceProviderOptions {
  request?: (url: URL, maximumBytes: number, signal?: AbortSignal,
    onRedirect?: (event: PublicRedirectEvent) => Promise<void>) => Promise<RawPublicResponse>;
  now?: () => Date;
  queueStorageDirectory?: string;
}

export function createPublicWebResourceProvider(options: PublicWebResourceProviderOptions = {}) {
  const request = options.request ?? createPublicResourceTransport();
  const now = options.now ?? (() => new Date());
  return {
    key: providerKey,
    version: providerVersion,
    validate: validatePublicSource,
    async preflight(source: CrawlPlanSource) { validatePublicSource(source); },
    async *collect(source: CrawlPlanSource, runId: string, admission?: SourceRequestAdmissionPort,
      signal?: AbortSignal, context?: SourceProviderCollectionContext): AsyncIterable<SourceProviderEvent> {
      if (!admission) throw new Error("public.web-resource 必须通过持久请求准入执行");
      const runSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(source.accessPolicy.maximumRunMs)])
        : AbortSignal.timeout(source.accessPolicy.maximumRunMs);
      const configuration = sourceConfiguration(source);
      const targets = source.targets.map((target) => targetPlan(source, target));
      const origins = [...new Set(targets.map((plan) => plan.url.origin))];
      const robots = new Map<string, RobotsDetails>();
      for (const origin of origins) {
        const robotsUrl = new URL("/robots.txt", origin);
        const owner = targets.find((plan) => plan.url.origin === origin);
        if (!owner) throw new Error(`robots.txt 找不到所属 target：${origin}`);
        const response = await requestPersistently(source, runId, admission, owner.target.key,
          `robots:${origin}`, "robots_policy", robotsUrl, maximumRobotsBytes, request, runSignal);
        robots.set(origin, parseRobots(robotsUrl, response));
      }
      for (const plan of targets) {
        const robotsDetails = robots.get(plan.url.origin);
        if (!robotsDetails) throw new Error(`找不到 ${plan.url.origin} 的 robots 决策`);
        if (plan.kind === "site") {
          if (!context) throw new Error("site route 缺少持久采集上下文");
          const storageDirectory = options.queueStorageDirectory;
          if (!storageDirectory) throw new Error("site route 缺少持久 RequestQueue 存储目录");
          yield* collectSiteTarget({ source, runId, admission, plan, robots: robotsDetails,
            maximumBytes: configuration.maximumBytes, maximumPages: configuration.maximumPagesPerTarget,
            request, signal: runSignal, context, storageDirectory, now });
          continue;
        }
        const { target, url } = plan;
        if (!isAllowedByRobots(robotsDetails, url)) {
          yield inaccessible(target.key, url, now(), "access_denied", "robots.txt 不允许访问该资源");
          return;
        }
        const response = await requestPersistently(source, runId, admission, target.key,
          `target:${target.key}`, target.captureUnit, url, configuration.maximumBytes, request, runSignal);
        const assessment = assessExactResponse(source, target, response, url);
        const event = captureEvent(source, target.key, url, response, now(), assessment);
        yield event;
        if (event.snapshot.observation.state !== "accessible") return;
        if (assessment.status !== "accepted") {
          throw new Error(`内容验收未达标：${target.key} ${assessment.reason}`);
        }
        yield { type: "target.completed", targetKey: target.key };
      }
    },
  };
}

async function requestPersistently(
  source: CrawlPlanSource,
  runId: string,
  admission: SourceRequestAdmissionPort,
  targetKey: string,
  workKey: string,
  captureUnit: string,
  url: URL,
  maximumBytes: number,
  request: NonNullable<PublicWebResourceProviderOptions["request"]>,
  signal?: AbortSignal,
) {
  await admission.ensureCaptureWorkItem({ runId, targetKey, workKey, captureUnit, expectedUnitCount: 1 });
  await admission.startCaptureWorkItem({ runId, workKey });
  let currentUrl = url;
  let attempt: Awaited<ReturnType<typeof reserveWhenEligible>> | undefined = await reserveWhenEligible(
    source, runId, admission, targetKey, workKey, currentUrl, signal);
  let redirectParentAttemptId: string | undefined;
  try {
    const response = await request(url, maximumBytes, signal, async (event) => {
      if (event.type === "response") {
        if (!attempt) throw new Error("重定向响应找不到当前请求尝试");
        await admission.finishRequest({ attemptId: attempt.id, state: "completed",
          finalUrl: event.hop.fromUrl.href, httpStatus: event.hop.statusCode });
        redirectParentAttemptId = attempt.id;
        attempt = undefined;
        return;
      }
      currentUrl = event.toUrl;
      attempt = await reserveWhenEligible(source, runId, admission, targetKey, workKey,
        currentUrl, signal, redirectParentAttemptId);
    });
    if (!attempt) throw new Error("重定向后没有预留最终请求尝试");
    const restricted = restrictionReason(response.statusCode);
    await admission.finishRequest({ attemptId: attempt.id,
      state: restricted ? "restricted" : response.statusCode >= 500 ? "failed" : "completed",
      finalUrl: response.finalUrl ?? currentUrl.href,
      httpStatus: response.statusCode, bytes: response.body.byteLength,
      ...(restricted ? { restrictionReason: restricted } : {}) });
    await admission.finishCaptureWorkItem({ runId, workKey,
      status: restricted ? "stopped" : response.statusCode >= 500 ? "failed" : "completed",
      observedUnitCount: restricted || response.statusCode >= 500 ? 0 : 1,
      ...(restricted ? { terminationReason: restricted } : response.statusCode >= 500
        ? { terminationReason: `HTTP ${response.statusCode}` } : {}) });
    return response;
  } catch (error) {
    if (attempt) {
      await admission.finishRequest({ attemptId: attempt.id, state: "failed" }).catch(() => undefined);
    }
    await admission.finishCaptureWorkItem({ runId, workKey, status: "failed", observedUnitCount: 0,
      terminationReason: boundedFailure(error) }).catch(() => undefined);
    throw error;
  }
}

async function reserveWhenEligible(
  source: CrawlPlanSource,
  runId: string,
  admission: SourceRequestAdmissionPort,
  targetKey: string,
  workKey: string,
  url: URL,
  signal?: AbortSignal,
  redirectParentAttemptId?: string,
) {
  while (true) {
    const result = await admission.reserveRequest({ runId, targetKey, workKey,
      gateKey: `${providerKey}@${providerVersion}:${url.origin}`,
      providerKey, providerVersion, policyVersion: source.accessPolicy.version,
      requestedUrl: url.href, ...(redirectParentAttemptId ? { redirectParentAttemptId } : {}),
      minimumIntervalMs: source.accessPolicy.minimumIntervalMs,
      maxRequestsPerMinute: source.accessPolicy.maxRequestsPerMinute });
    if (result.status === "admitted") return result.attempt;
    if (result.status === "blocked") throw new Error(`持久请求 gate 阻止访问：${result.reason}`);
    const waitMs = Math.max(0, new Date(result.retryAt).getTime() - Date.now());
    if (waitMs > 0) await delay(waitMs, undefined, { signal });
  }
}

function restrictionReason(status: number) {
  if (status === 429) return "rate_limited";
  if (status === 401) return "login_required";
  if (status === 403) return "access_denied";
  return undefined;
}

function boundedFailure(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

function validatePublicSource(source: CrawlPlanSource) {
  const configuration = sourceConfiguration(source);
  if (source.provider.key !== providerKey || source.provider.version !== providerVersion) {
    throw new Error(`公共资源 Provider 绑定必须是 ${providerKey}@${providerVersion}`);
  }
  for (const entry of source.entryUrls) assertPublicHttpsUrl(entry);
  const plans = source.targets.map((target) => targetPlan(source, target));
  for (const plan of plans) {
    if (plan.kind === "exact" && (plan.target.quantity.mode !== "target_count"
      || plan.target.quantity.targetCount !== 1)) {
      throw new Error(`exact target ${plan.target.key} 必须声明 target_count=1`);
    }
    if (plan.kind === "site" && plan.target.quantity.mode !== "all_available") {
      throw new Error(`site target ${plan.target.key} 必须声明 all_available`);
    }
  }
  const plannedUrls = plans.map((plan) => plan.url.href);
  if (new Set(plannedUrls).size !== plannedUrls.length) throw new Error("公共资源 target URL 不得重复");
  if (source.entryUrls.length !== plannedUrls.length
    || source.entryUrls.some((entry) => !plannedUrls.includes(new URL(entry).href))) {
    throw new Error("公共资源入口清单中的每个 URL 都必须恰好对应一个计划路由 target");
  }
  const originCount = new Set(plannedUrls.map((value) => new URL(value).origin)).size;
  const siteCount = plans.filter((plan) => plan.kind === "site").length;
  const minimumBudget = (plans.length + originCount + siteCount * (configuration.maximumPagesPerTarget + 4)) * 2;
  if (source.stopPolicy.requestBudget < minimumBudget) {
    throw new Error("公共资源请求预算必须覆盖 robots、sitemap、页面与同源 redirect 上限");
  }
  if (configuration.maximumBytes > maximumAllowedBytes) {
    throw new Error(`公共资源 maximum_bytes 不能超过 ${maximumAllowedBytes}`);
  }
}

function sourceConfiguration(source: CrawlPlanSource) {
  const keys = source.provider.configuration.map((item) => item.key).sort();
  if (keys.join(",") !== "maximum_bytes,maximum_pages_per_target,mode") {
    throw new Error("公共资源 Provider 配置必须且只能包含 mode、maximum_bytes 与 maximum_pages_per_target");
  }
  const values = Object.fromEntries(source.provider.configuration.map((item) => [item.key, item.value]));
  if (values.mode !== "planned_routes") throw new Error("公共资源 Provider 只接受 mode=planned_routes");
  const maximumBytes = Number(values.maximum_bytes);
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) throw new Error("公共资源 Provider 缺少正整数 maximum_bytes");
  const maximumPagesPerTarget = Number(values.maximum_pages_per_target);
  if (!Number.isInteger(maximumPagesPerTarget) || maximumPagesPerTarget < 1 || maximumPagesPerTarget > 100) {
    throw new Error("公共资源 Provider 的 maximum_pages_per_target 必须是 1-100");
  }
  return { maximumBytes, maximumPagesPerTarget };
}

function targetPlan(source: CrawlPlanSource, target: CrawlPlanSource["targets"][number]) {
  const values = Object.fromEntries(target.providerConfiguration.map((item) => [item.key, item.value]));
  if (values.route === "exact" && typeof values.url === "string" && target.providerConfiguration.length === 2) {
    const url = assertPublicHttpsUrl(values.url);
    // WHY：URL 与 URL/ 是同一个公网资源；双方先走 URL 规范化，不能用原始字符串制造假预检失败。
    if (!source.entryUrls.some((entryUrl) => new URL(entryUrl).href === url.href)) {
      throw new Error(`target ${target.key} 的 url 不在来源入口清单中`);
    }
    return { kind: "exact" as const, target, url };
  }
  if (values.route === "site" && typeof values.url === "string" && Array.isArray(values.required_terms)
    && target.providerConfiguration.length === 5) {
    const url = assertPublicHttpsUrl(values.url);
    if (!source.entryUrls.some((entryUrl) => new URL(entryUrl).href === url.href)) {
      throw new Error(`target ${target.key} 的 url 不在来源入口清单中`);
    }
    const maximumDepth = Number(values.maximum_depth);
    const minimumAcceptedPages = Number(values.minimum_accepted_pages);
    const requiredTerms = values.required_terms.map(String).map((value) => value.trim()).filter(Boolean);
    if (!Number.isInteger(maximumDepth) || maximumDepth < 1 || maximumDepth > 3) {
      throw new Error(`target ${target.key} 的 maximum_depth 必须是 1-3`);
    }
    if (!Number.isInteger(minimumAcceptedPages) || minimumAcceptedPages < 1 || minimumAcceptedPages > 100) {
      throw new Error(`target ${target.key} 的 minimum_accepted_pages 必须是 1-100`);
    }
    if (new Set(requiredTerms).size < 2) throw new Error(`target ${target.key} 至少需要两个内容相关信号`);
    return { kind: "site" as const, target, url, requiredTerms, maximumDepth, minimumAcceptedPages };
  }
  throw new Error(`target ${target.key} 必须配置 exact 或有界 site route`);
}

type RobotsDetails = {
  policy: ReturnType<typeof robotsParser> | "blocked";
  sitemapUrls: string[];
};

type SitePlan = {
  kind: "site";
  target: CrawlPlanSource["targets"][number];
  url: URL;
  requiredTerms: string[];
  maximumDepth: number;
  minimumAcceptedPages: number;
};

async function* collectSiteTarget(input: {
  source: CrawlPlanSource;
  runId: string;
  admission: SourceRequestAdmissionPort;
  plan: SitePlan;
  robots: RobotsDetails;
  maximumBytes: number;
  maximumPages: number;
  request: NonNullable<PublicWebResourceProviderOptions["request"]>;
  signal?: AbortSignal;
  context: SourceProviderCollectionContext;
  storageDirectory: string;
  now: () => Date;
}): AsyncIterable<SourceProviderEvent> {
  const configuration = createPersistentCrawleeConfiguration(path.resolve(input.storageDirectory));
  const queueName = `public-${digest(`${input.context.queueRunId}:${input.source.key}:${input.plan.target.key}`)}`;
  const queue = await openPersistentRequestQueue(queueName, configuration, 5);
  let scheduled = 0;
  let accepted = 0;
  try {
    scheduled += await enqueueSiteRequest(queue, input.plan.url, 0, "seed");
    const sitemap = await loadSitemapCandidates(input);
    for (const event of sitemap.events) yield event;
    for (const url of rankSitemapCandidates(sitemap.urls, input.plan).slice(0, Math.floor(input.maximumPages / 2))) {
      scheduled += await enqueueSiteRequest(queue, url, 1, "sitemap");
    }
    let processed = 0;
    let idlePolls = 0;
    while (processed < input.maximumPages) {
      const queued = await queue.fetchNextRequest();
      if (!queued) {
        if (await queue.isFinished()) break;
        if (idlePolls >= 100) throw new Error("持久 RequestQueue 在锁恢复窗口内没有可领取工作");
        idlePolls += 1;
        await delay(100, undefined, { signal: input.signal });
        continue;
      }
      idlePolls = 0;
      const url = assertPublicHttpsUrl(queued.url);
      const route = parseQueueRoute(queued.userData);
      if (url.origin !== input.plan.url.origin) throw new Error(`site route 发现了跨源 URL：${url.href}`);
      if (!isAllowedByRobots(input.robots, url)) {
        await queue.markRequestHandled(queued);
        processed += 1;
        continue;
      }
      const workKey = `page:${digest(url.href)}`;
      let response: RawPublicResponse;
      try {
        response = await requestPersistently(input.source, input.runId, input.admission,
          input.plan.target.key, workKey, input.plan.target.captureUnit, url,
          input.maximumBytes, input.request, input.signal);
      } catch (error) {
        // WHY：失败页仍是未完成工作；立即归还队列可让负责人显式继续时直接领取，
        // 不必等待 Crawlee 的双锁恢复窗口，也不会把失败误记成已处理。
        await queue.reclaimRequest(queued);
        throw error;
      }
      const assessment = assessSiteResponse(response, input.plan);
      const event = captureEvent(input.source, input.plan.target.key, url, response, input.now(), assessment);
      yield event;
      if (event.snapshot.observation.state !== "accessible") {
        await queue.reclaimRequest(queued);
        return;
      }
      if (assessment.status === "accepted") accepted += 1;
      if (route.depth < input.plan.maximumDepth && scheduled < input.maximumPages) {
        for (const link of extractSiteLinks(response, url, input.plan.requiredTerms)) {
          if (scheduled >= input.maximumPages) break;
          scheduled += await enqueueSiteRequest(queue, link, route.depth + 1, "html");
        }
      }
      await queue.markRequestHandled(queued);
      processed += 1;
    }
  } finally {
    await configuration.getStorageClient().teardown?.();
  }
  if (accepted < input.plan.minimumAcceptedPages) {
    throw new Error(`内容验收未达标：计划至少 ${input.plan.minimumAcceptedPages} 页，实际 ${accepted} 页`);
  }
  yield { type: "target.completed", targetKey: input.plan.target.key };
}

async function loadSitemapCandidates(input: Parameters<typeof collectSiteTarget>[0]) {
  const events: Array<Extract<SourceProviderEvent, { type: "capture" }>> = [];
  const pageUrls = new Set<string>();
  const pending = [...input.robots.sitemapUrls];
  if (pending.length === 0) pending.push(new URL("/sitemap.xml", input.plan.url.origin).href);
  const seen = new Set<string>();
  while (pending.length > 0 && seen.size < 4) {
    const sitemapUrl = assertPublicHttpsUrl(pending.shift()!);
    if (sitemapUrl.origin !== input.plan.url.origin || seen.has(sitemapUrl.href)) continue;
    seen.add(sitemapUrl.href);
    const response = await requestPersistently(input.source, input.runId, input.admission,
      input.plan.target.key, `sitemap:${digest(sitemapUrl.href)}`, "sitemap", sitemapUrl,
      maximumRobotsBytes, input.request, input.signal);
    if (response.statusCode < 200 || response.statusCode >= 300) continue;
    events.push(captureEvent(input.source, input.plan.target.key, sitemapUrl, response, input.now(),
      supportingAssessment("sitemap_raw", "sitemap 只支撑 URL 分母，不计入内容完成数")));
    const text = Buffer.from(response.body).toString("utf8");
    for await (const item of parseSitemap([{ type: "raw", content: text, depth: 0 }], undefined,
      { emitNestedSitemaps: true, maxDepth: 0, sitemapRetries: 0, reportNetworkErrors: false })) {
      const candidate = safeSameOriginUrl(item.loc, input.plan.url.origin);
      if (!candidate) continue;
      if (item.originSitemapUrl === null) pending.push(candidate.href);
      else if (pageUrls.size < input.maximumPages * 20) pageUrls.add(candidate.href);
    }
  }
  return { events, urls: [...pageUrls].map((url) => new URL(url)) };
}

function rankSitemapCandidates(urls: URL[], plan: SitePlan) {
  return urls.filter(isPageCandidate).map((url) => ({ url,
    score: signalMatches(url.href, plan.requiredTerms).length * 10 + sharedPathScore(url, plan.url) }))
    .filter((item) => item.score > 0).sort((left, right) => right.score - left.score)
    .map((item) => item.url);
}

async function enqueueSiteRequest(queue: Awaited<ReturnType<typeof openPersistentRequestQueue>>,
  url: URL, depth: number, discoveredBy: "seed" | "sitemap" | "html") {
  const result = await queue.addRequest({ url: url.href, uniqueKey: `page:${url.href}`,
    userData: { depth, discoveredBy } });
  return result.wasAlreadyPresent || result.wasAlreadyHandled ? 0 : 1;
}

function parseQueueRoute(value: Record<string, unknown>) {
  const depth = Number(value.depth);
  const discoveredBy = value.discoveredBy;
  if (!Number.isInteger(depth) || depth < 0 || depth > 3
    || (discoveredBy !== "seed" && discoveredBy !== "sitemap" && discoveredBy !== "html")) {
    throw new Error("持久 RequestQueue 包含无效 route metadata");
  }
  return { depth, discoveredBy };
}

function parseRobots(url: URL, response: RawPublicResponse) {
  if (response.statusCode === 404) return { policy: robotsParser(url.href, ""), sitemapUrls: [] };
  if (response.statusCode === 401 || response.statusCode === 403) {
    return { policy: "blocked" as const, sitemapUrls: [] };
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`robots.txt 返回 HTTP ${response.statusCode}`);
  }
  const content = Buffer.from(response.body).toString("utf8");
  const sitemapUrls = RobotsTxtFile.from(url.href, content).getSitemaps({ enqueueStrategy: "same-origin" })
    .flatMap((value) => safeSameOriginUrl(value, url.origin) ? [new URL(value).href] : []);
  return { policy: robotsParser(url.href, content), sitemapUrls };
}

function isAllowedByRobots(details: RobotsDetails, url: URL) {
  return details.policy !== "blocked" && details.policy.isAllowed(url.href, publicWebUserAgent) !== false;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}
