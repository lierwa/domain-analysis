import { BlockList, isIP } from "node:net";

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();
const fakeIpAddresses = new BlockList();
fakeIpAddresses.addSubnet("198.18.0.0", 15, "ipv4");
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["100::", 64],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");

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
  const blocked = family === 4
    ? blockedIpv4Addresses.check(address, "ipv4")
    : blockedIpv6Addresses.check(address, "ipv6");
  if (blocked) {
    throw new Error(`公共资源解析到了非公网地址：${address}`);
  }
}

export function isFakeIpAddress(address: string) {
  return isIP(address) === 4 && fakeIpAddresses.check(address, "ipv4");
}

function stripIpv6Brackets(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}
