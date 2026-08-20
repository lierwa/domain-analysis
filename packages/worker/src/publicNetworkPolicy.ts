import { lookup as systemLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

import type { OptionsInit } from "got";

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["100::", 64],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blockedAddresses.addSubnet(network, prefix, "ipv6");

export function assertPublicHttpsUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("公共资源只允许 HTTPS");
  if (url.username || url.password) throw new Error("公共资源 URL 不得包含凭证");
  if (url.port && url.port !== "443") throw new Error("公共资源只允许 HTTPS 443 端口");
  const literal = stripIpv6Brackets(url.hostname);
  const family = isIP(literal);
  if (family) assertPublicAddress(literal, family);
  return url;
}

export function assertPublicAddress(address: string, family = isIP(address)) {
  if (family !== 4 && family !== 6) throw new Error(`DNS 返回了无效地址：${address}`);
  if (blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6")) {
    throw new Error(`公共资源解析到了非公网地址：${address}`);
  }
}

export function createPublicDnsLookup(
  lookup: typeof systemLookup = systemLookup,
): NonNullable<OptionsInit["dnsLookup"]> {
  return (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      try {
        const values = addresses as LookupAddress[];
        if (values.length === 0) throw new Error(`DNS 没有返回地址：${hostname}`);
        for (const value of values) assertPublicAddress(value.address, value.family);
        const selected = values[0]!;
        // WHY：校验后返回同一个解析结果给连接层，避免先校验、再二次解析产生 DNS rebinding 窗口。
        callback(null, selected.address, selected.family);
      } catch (policyError) {
        callback(toLookupError(policyError), "", 0);
      }
    });
  };
}

function stripIpv6Brackets(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function toLookupError(error: unknown) {
  const policyError = new Error(error instanceof Error ? error.message : String(error)) as NodeJS.ErrnoException;
  policyError.code = "EACCES";
  return policyError;
}
