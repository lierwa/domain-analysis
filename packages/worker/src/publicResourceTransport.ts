import { lookup as systemLookup, type LookupAddress } from "node:dns";
import type { IncomingMessage } from "node:http";
import { Agent, request as httpsRequest, type AgentOptions } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

import { ProxyConfiguration } from "@crawlee/core";
import { HttpCrawler } from "@crawlee/http";

import { createEphemeralCrawleeConfiguration } from "./ephemeralCrawleeConfiguration";
import { assertPublicAddress, assertPublicHttpsUrl, isFakeIpAddress } from "./publicNetworkPolicy";

export const publicWebUserAgent = "DomainAnalysisBot/0.1";
const googleDohEndpoint = "https://dns.google/resolve";
const requestTimeoutMs = 30_000;
const maximumDohBytes = 64_000;

export interface RawPublicResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array<ArrayBuffer>;
  finalUrl?: string;
}

export type PublicAddressLookup = (hostname: string, signal?: AbortSignal) => Promise<LookupAddress[]>;

export interface PublicRedirectHop {
  fromUrl: URL;
  toUrl: URL;
  statusCode: number;
  headers: Record<string, string>;
}

export type PublicRedirectEvent =
  | { type: "response"; hop: PublicRedirectHop }
  | { type: "request"; toUrl: URL };

export interface PublicResourceTransportOptions {
  lookup?: PublicAddressLookup;
  resolveViaDoh?: PublicAddressLookup;
  proxyEnv?: NodeJS.ProcessEnv;
}

export function normalizePublicRedirectUrl(fromUrl: URL, toUrl: URL) {
  const sameHttpsHost = fromUrl.protocol === "https:" && toUrl.hostname === fromUrl.hostname
    && (fromUrl.port === "" || fromUrl.port === "443")
    && (toUrl.port === "" || toUrl.port === "80");
  if (!sameHttpsHost || toUrl.protocol !== "http:") return toUrl;
  // WHY：部分公开站点用 HTTP 作为同主机 canonical Location，但 HTTPS 资源仍可直接读取。
  // 只升级同主机默认端口，保留跨 origin、非默认端口和凭证跳转的拒绝边界。
  const secureUrl = new URL(toUrl.href);
  secureUrl.protocol = "https:";
  secureUrl.port = "";
  return secureUrl;
}

export function createPublicResourceTransport(options: PublicResourceTransportOptions = {}) {
  const proxyEnv = publicProxyEnvironment(options.proxyEnv ?? process.env);
  // WHY：Node 24.5+ 官方 Agent 已能读取代理环境；类型包仍锁在 Node 20，窄 cast 只补版本声明差异。
  const agent = new Agent({ proxyEnv } as AgentOptions);
  const lookup = options.lookup ?? lookupAll;
  const resolveViaDoh = options.resolveViaDoh
    ?? ((hostname: string, signal?: AbortSignal) => resolveGooglePublicDns(hostname, agent, signal));
  const proxyUrl = proxyEnv.https_proxy ?? proxyEnv.HTTPS_PROXY;

  return async (url: URL, maximumBytes: number, signal?: AbortSignal,
    onRedirect?: (event: PublicRedirectEvent) => Promise<void>) => {
    const initialUrl = assertPublicHttpsUrl(url.href);
    const addresses = new Map<string, LookupAddress>();
    const validateUrl = async (candidate: URL) => {
      assertPublicHttpsUrl(candidate.href);
      if (candidate.origin !== initialUrl.origin) throw new Error("公共资源重定向不能跨 origin");
      const address = await resolvePublicTarget(candidate.hostname, lookup, resolveViaDoh,
        hasHttpsProxy(proxyEnv), signal);
      addresses.set(candidate.hostname, address);
    };
    await validateUrl(initialUrl);
    return downloadWithCrawlee({ url: initialUrl, maximumBytes, signal, proxyUrl,
      addresses, validateUrl, onRedirect });
  };
}

export async function preflightPublicResourceEnvironment(
  options: PublicResourceTransportOptions = {},
) {
  const proxyEnv = publicProxyEnvironment(options.proxyEnv ?? process.env);
  const agent = new Agent({ proxyEnv } as AgentOptions);
  const lookup = options.lookup ?? lookupAll;
  const resolveViaDoh = options.resolveViaDoh
    ?? ((hostname: string, signal?: AbortSignal) => resolveGooglePublicDns(hostname, agent, signal));
  const proxyAvailable = hasHttpsProxy(proxyEnv);
  let systemAddresses: LookupAddress[];
  try {
    systemAddresses = await lookup("dns.google");
  } catch {
    throw new Error("公共网络环境 DNS 检查失败");
  }
  const fakeIpEnvironment = systemAddresses.length > 0
    && systemAddresses.every((value) => isFakeIpAddress(value.address));
  try {
    // WHY：预检只访问公共 DNS 基础设施，不触达 Crawl Plan 来源；这样可在创建 Batch 前识别整批共享的网络错误。
    await resolvePublicTarget("dns.google", async () => systemAddresses, resolveViaDoh, proxyAvailable);
    if (proxyAvailable && !fakeIpEnvironment) {
      selectPublicAddress("dns.google", await resolveViaDoh("dns.google"));
    }
  } catch (error) {
    if (error instanceof Error && error.message === "检测到 Fake-IP DNS，但没有配置受信任 HTTPS 代理") {
      throw error;
    }
    // 代理 URL 可能含凭证；环境错误只返回可操作类别，不回显底层连接串。
    throw new Error("公共网络环境检查失败，请检查 DNS 与受信任 HTTPS 代理配置");
  }
}

export async function readBoundedBody(stream: Readable, maximumBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
    total += chunk.byteLength;
    if (total > maximumBytes) {
      stream.destroy();
      throw new Error(`来源响应超过最大字节：${maximumBytes}`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function resolvePublicTarget(
  hostname: string,
  lookup: PublicAddressLookup,
  resolveViaDoh: PublicAddressLookup,
  proxyAvailable: boolean,
  signal?: AbortSignal,
): Promise<LookupAddress> {
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    assertPublicAddress(hostname, literalFamily);
    return { address: hostname, family: literalFamily };
  }
  const systemAddresses = await lookup(hostname, signal);
  if (systemAddresses.length === 0) throw new Error(`DNS 没有返回地址：${hostname}`);
  if (systemAddresses.every((value) => isFakeIpAddress(value.address))) {
    // WHY：Fake-IP 只是本机代理的占位地址，既不能直接放过 SSRF 校验，也不能作为真实连接目标。
    // 只有部署环境已显式配置 HTTPS 代理时，才经可信 DoH 取得并固定实际公网 IP。
    if (!proxyAvailable) throw new Error("检测到 Fake-IP DNS，但没有配置受信任 HTTPS 代理");
    const publicAddresses = await resolveViaDoh(hostname, signal);
    return selectPublicAddress(hostname, publicAddresses);
  }
  return selectPublicAddress(hostname, systemAddresses);
}

function selectPublicAddress(hostname: string, addresses: LookupAddress[]) {
  if (addresses.length === 0) throw new Error(`DNS 没有返回地址：${hostname}`);
  for (const value of addresses) assertPublicAddress(value.address, value.family);
  return addresses[0]!;
}

async function resolveGooglePublicDns(hostname: string, agent: Agent, signal?: AbortSignal) {
  const ipv4 = await queryGooglePublicDns(hostname, "A", 4, agent, signal);
  if (ipv4.length > 0) return ipv4;
  return queryGooglePublicDns(hostname, "AAAA", 6, agent, signal);
}

async function queryGooglePublicDns(
  hostname: string,
  type: "A" | "AAAA",
  family: 4 | 6,
  agent: Agent,
  signal?: AbortSignal,
) {
  const url = new URL(googleDohEndpoint);
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", type);
  url.searchParams.set("edns_client_subnet", "0.0.0.0/0");
  const response = await requestHttps(url, { agent, signal, maximumBytes: maximumDohBytes,
    headers: { accept: "application/dns-json", "user-agent": publicWebUserAgent } });
  if (response.statusCode !== 200) throw new Error(`可信 DoH 返回 HTTP ${response.statusCode}`);
  const payload = parseDohResponse(response.body);
  if (payload.Status !== 0 || payload.TC) throw new Error(`可信 DoH 查询失败：DNS status ${payload.Status}`);
  return (payload.Answer ?? []).flatMap((answer) => answer.type === (family === 4 ? 1 : 28)
    ? [{ address: answer.data, family } satisfies LookupAddress] : []);
}

function parseDohResponse(body: Uint8Array<ArrayBuffer>) {
  const value = JSON.parse(Buffer.from(body).toString("utf8")) as unknown;
  if (!value || typeof value !== "object") throw new Error("可信 DoH 返回了无效 JSON");
  const candidate = value as { Status?: unknown; TC?: unknown;
    Answer?: Array<{ type?: unknown; data?: unknown }> };
  if (!Number.isInteger(candidate.Status) || typeof candidate.TC !== "boolean") {
    throw new Error("可信 DoH 返回缺少 DNS 状态");
  }
  const answers = Array.isArray(candidate.Answer) ? candidate.Answer.flatMap((answer) =>
    Number.isInteger(answer.type) && typeof answer.data === "string"
      ? [{ type: answer.type as number, data: answer.data }] : []) : undefined;
  return { Status: candidate.Status as number, TC: candidate.TC, Answer: answers };
}

function requestHttps(
  url: URL,
  input: { maximumBytes: number; agent?: Agent; signal?: AbortSignal; headers?: Record<string, string> },
): Promise<RawPublicResponse> {
  return new Promise((resolve, reject) => {
    const onResponse = async (response: IncomingMessage) => {
      try {
        const body = Uint8Array.from(await readBoundedBody(response, input.maximumBytes));
        resolve({ statusCode: response.statusCode ?? 0,
          headers: normalizeHeaders(response.headers), body });
      } catch (error) {
        reject(error);
      }
    };
    const request = httpsRequest(url, { agent: input.agent, signal: input.signal,
      method: "GET", headers: input.headers }, onResponse);
    request.setTimeout(requestTimeoutMs, () => request.destroy(new Error("公共资源请求超时")));
    request.on("error", reject);
    request.end();
  });
}

function lookupAll(hostname: string, _signal?: AbortSignal) {
  return new Promise<LookupAddress[]>((resolve, reject) => {
    systemLookup(hostname, { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
}

function publicProxyEnvironment(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"]
    .flatMap((key) => env[key] ? [[key, env[key]!]] : []));
}

function hasHttpsProxy(env: Record<string, string>) {
  return Boolean(env.https_proxy ?? env.HTTPS_PROXY);
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(Object.entries(headers).flatMap(([key, value]) => value === undefined
    ? [] : [[key.toLowerCase(), Array.isArray(value) ? value.join(", ") : value]]));
}

async function downloadWithCrawlee(input: {
  url: URL;
  maximumBytes: number;
  signal?: AbortSignal;
  proxyUrl?: string;
  addresses: Map<string, LookupAddress>;
  validateUrl: (url: URL) => Promise<void>;
  onRedirect?: (event: PublicRedirectEvent) => Promise<void>;
}) {
  let response: RawPublicResponse | undefined;
  let failure: Error | undefined;
  let currentUrl = input.url;
  const crawler = new HttpCrawler({
    minConcurrency: 1,
    maxConcurrency: 1,
    maxRequestsPerCrawl: 1,
    maxRequestRetries: 0,
    maxSessionRotations: 0,
    useSessionPool: false,
    retryOnBlocked: false,
    navigationTimeoutSecs: 30,
    requestHandlerTimeoutSecs: 30,
    additionalMimeTypes: ["*/*"],
    // WHY：锁定的 Crawlee 3.18.1 会把 Node 不支持的 GBK 等正文先转成 UTF-8，导致 Source Snapshot
    // 丢失源站原字节。这里选一个 Node 原生支持的编码以关闭该转码分支；真正编码仍由响应头与 HTML
    // meta 交给内容层判定。升级 Crawlee 时必须重跑 ZOL/Sony/TCL 三编码门。
    forceResponseEncoding: "utf8",
    ...(input.proxyUrl ? { proxyConfiguration: new ProxyConfiguration({ proxyUrls: [input.proxyUrl] }) } : {}),
    preNavigationHooks: [async (_context, gotOptions) => {
      gotOptions.followRedirect = true;
      // WHY：一个规范化跳转足以覆盖真实官网的 canonical/robots 重定向；更多跳转必须回到新计划，
      // 不能让成熟客户端的默认上限暗中扩大已确认请求预算。
      gotOptions.maxRedirects = 1;
      gotOptions.headers = { ...gotOptions.headers, accept: "*/*", "accept-encoding": "identity",
        "user-agent": publicWebUserAgent };
      if (input.signal) gotOptions.signal = input.signal;
      if (!input.proxyUrl) gotOptions.dnsLookup = pinnedLookup(input.addresses, input.validateUrl);
      gotOptions.hooks ??= {};
      gotOptions.hooks.beforeRedirect ??= [];
      gotOptions.hooks.beforeRedirect.push(async (redirectOptions, redirectResponse) => {
        if (!redirectOptions.url) throw new Error("公共资源重定向缺少目标 URL");
        const rawToUrl = new URL(redirectOptions.url.toString());
        const toUrl = normalizePublicRedirectUrl(currentUrl, rawToUrl);
        await input.onRedirect?.({ type: "response", hop: { fromUrl: currentUrl, toUrl,
          statusCode: redirectResponse.statusCode,
          headers: normalizeHeaders(redirectResponse.headers) } });
        await input.validateUrl(toUrl);
        // WHY：只在已验证为同主机 HTTPS 等价地址后改写客户端下一跳，避免 got 实际连接到 HTTP。
        (redirectOptions as { url?: URL }).url = toUrl;
        await input.onRedirect?.({ type: "request", toUrl });
        currentUrl = toUrl;
      });
    }],
    requestHandler: async ({ body, request: crawleeRequest, response: crawleeResponse }) => {
      const bytes = Buffer.from(body);
      if (bytes.byteLength > input.maximumBytes) {
        throw new Error(`来源响应超过最大字节：${input.maximumBytes}`);
      }
      response = { statusCode: crawleeResponse.statusCode ?? 0,
        headers: normalizeHeaders(crawleeResponse.headers), body: Uint8Array.from(bytes),
        finalUrl: crawleeRequest.loadedUrl ?? currentUrl.href };
    },
    failedRequestHandler: async (_context, error) => {
      failure = new Error(error instanceof Error ? error.message : "Crawlee 公共资源请求失败");
    },
  }, createEphemeralCrawleeConfiguration());
  try {
    await crawler.run([input.url.href]);
  } finally {
    await crawler.teardown();
  }
  if (failure) throw failure;
  if (!response) throw new Error("Crawlee 公共资源请求没有返回响应");
  return response;
}

function pinnedLookup(
  addresses: Map<string, LookupAddress>,
  validateUrl: (url: URL) => Promise<void>,
): LookupFunction {
  return (hostname, options, callback) => {
    const finish = async () => {
      let selected = addresses.get(hostname);
      if (!selected) {
        await validateUrl(new URL(`https://${hostname}/`));
        selected = addresses.get(hostname);
      }
      if (!selected) throw new Error(`DNS 没有返回地址：${hostname}`);
      if (typeof options === "object" && options.all) {
        // WHY：got-scraping 会请求 lookup(all=true)；必须遵守 Node DNS 重载，否则客户端会读到 undefined 地址。
        (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, [selected]);
        return;
      }
      callback(null, selected.address, selected.family);
    };
    finish().catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (typeof options === "object" && options.all) {
        (callback as unknown as (error: Error, addresses: LookupAddress[]) => void)(failure, []);
        return;
      }
      callback(failure, "", 4);
    });
  };
}
