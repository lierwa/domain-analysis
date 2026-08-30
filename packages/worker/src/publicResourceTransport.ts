import { lookup as systemLookup, type LookupAddress } from "node:dns";
import type { IncomingMessage } from "node:http";
import { Agent, request as httpsRequest, type AgentOptions } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

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
  const proxyAvailable = hasHttpsProxy(proxyEnv);

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
    return downloadWithHttps({ url: initialUrl, maximumBytes, signal, agent,
      lookup: proxyAvailable ? undefined : pinnedLookup(addresses, validateUrl), validateUrl, onRedirect });
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
  input: { maximumBytes: number; agent?: Agent; signal?: AbortSignal; headers?: Record<string, string>;
    lookup?: LookupFunction },
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
    const request = httpsRequest(url, { agent: input.agent, signal: input.signal, lookup: input.lookup,
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

async function downloadWithHttps(input: {
  url: URL;
  maximumBytes: number;
  signal?: AbortSignal;
  agent: Agent;
  lookup?: LookupFunction;
  validateUrl: (url: URL) => Promise<void>;
  onRedirect?: (event: PublicRedirectEvent) => Promise<void>;
}) {
  const headers = { accept: "*/*", "accept-encoding": "identity", "user-agent": publicWebUserAgent };
  const request = (url: URL) => requestHttps(url, { agent: input.agent, signal: input.signal,
    lookup: input.lookup, maximumBytes: input.maximumBytes, headers });
  const first = await request(input.url);
  if (!isRedirectStatus(first.statusCode)) return { ...first, finalUrl: input.url.href };

  const location = first.headers.location;
  if (!location) throw new Error(`公共资源重定向缺少目标 URL：HTTP ${first.statusCode}`);
  const toUrl = normalizePublicRedirectUrl(input.url, new URL(location, input.url));
  await input.onRedirect?.({ type: "response", hop: { fromUrl: input.url, toUrl,
    statusCode: first.statusCode, headers: first.headers } });
  await input.validateUrl(toUrl);
  await input.onRedirect?.({ type: "request", toUrl });

  // WHY：只手工执行一个经过同 origin 与公网地址校验的 canonical 跳转；Node HTTPS 不会暗中追加请求，
  // 因而 Crawl Plan 的请求预算、重定向事实和原始字节仍保持可审计。
  const second = await request(toUrl);
  if (isRedirectStatus(second.statusCode)) throw new Error("公共资源重定向超过 1 次");
  return { ...second, finalUrl: toUrl.href };
}

function isRedirectStatus(statusCode: number) {
  return statusCode === 301 || statusCode === 302 || statusCode === 303
    || statusCode === 307 || statusCode === 308;
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
