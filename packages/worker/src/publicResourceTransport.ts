import { lookup as systemLookup, type LookupAddress } from "node:dns";
import type { IncomingMessage } from "node:http";
import {
  Agent,
  request as httpsRequest,
  type AgentOptions,
  type RequestOptions,
} from "node:https";
import { isIP } from "node:net";
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
}

export type PublicAddressLookup = (hostname: string, signal?: AbortSignal) => Promise<LookupAddress[]>;

export interface PinnedHttpsRequestInput {
  url: URL;
  address: string;
  maximumBytes: number;
  signal?: AbortSignal;
  agent: Agent;
}

export interface PublicResourceTransportOptions {
  lookup?: PublicAddressLookup;
  resolveViaDoh?: PublicAddressLookup;
  requestPinned?: (input: PinnedHttpsRequestInput) => Promise<RawPublicResponse>;
  proxyEnv?: NodeJS.ProcessEnv;
}

export function createPublicResourceTransport(options: PublicResourceTransportOptions = {}) {
  const proxyEnv = publicProxyEnvironment(options.proxyEnv ?? process.env);
  // WHY：Node 24.5+ 官方 Agent 已能读取代理环境；类型包仍锁在 Node 20，窄 cast 只补版本声明差异。
  const agent = new Agent({ proxyEnv } as AgentOptions);
  const lookup = options.lookup ?? lookupAll;
  const resolveViaDoh = options.resolveViaDoh
    ?? ((hostname: string, signal?: AbortSignal) => resolveGooglePublicDns(hostname, agent, signal));
  const requestPinned = options.requestPinned ?? requestPinnedHttps;

  return async (url: URL, maximumBytes: number, signal?: AbortSignal) => {
    assertPublicHttpsUrl(url.href);
    const address = await resolvePublicTarget(url.hostname, lookup, resolveViaDoh,
      hasHttpsProxy(proxyEnv), signal);
    return requestPinned({ url, address, maximumBytes, signal, agent });
  };
}

export function pinnedHttpsRequestOptions(
  url: URL,
  address: string,
  agent?: Agent,
  signal?: AbortSignal,
): RequestOptions {
  return {
    protocol: "https:",
    hostname: address,
    port: 443,
    servername: url.hostname,
    method: "GET",
    path: `${url.pathname}${url.search}`,
    ...(agent ? { agent } : {}),
    ...(signal ? { signal } : {}),
    headers: { host: url.host, "user-agent": publicWebUserAgent, accept: "*/*" },
  };
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

async function resolvePublicTarget(
  hostname: string,
  lookup: PublicAddressLookup,
  resolveViaDoh: PublicAddressLookup,
  proxyAvailable: boolean,
  signal?: AbortSignal,
) {
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    assertPublicAddress(hostname, literalFamily);
    return hostname;
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
  return addresses[0]!.address;
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

async function requestPinnedHttps(input: PinnedHttpsRequestInput) {
  // WHY：安全校验过的公网 IP 必须就是本次连接地址；原域名仅保留给 Host/SNI，避免二次 DNS rebinding。
  return requestHttps(input.url, {
    options: pinnedHttpsRequestOptions(input.url, input.address, input.agent, input.signal),
    maximumBytes: input.maximumBytes,
  });
}

function requestHttps(
  url: URL,
  input: { maximumBytes: number; options?: RequestOptions; agent?: Agent;
    signal?: AbortSignal; headers?: Record<string, string> },
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
    const request = input.options
      ? httpsRequest(input.options, onResponse)
      : httpsRequest(url, { agent: input.agent, signal: input.signal,
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
